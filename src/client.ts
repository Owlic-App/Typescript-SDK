import {
  OwlicAPIError,
  OwlicConnectionError,
  OwlicError,
  OwlicTimeoutError,
  RateLimitError,
  apiErrorFromResponse,
} from './errors';
import { Trainers } from './resources/trainers';
import { TrainingActions } from './resources/trainingActions';
import { TrainingPrograms } from './resources/trainingPrograms';
import type { ApiCaller, Health, HttpMethod, QueryParams, RequestOptions, WhoAmI } from './types';

export interface OwlicOptions {
  /**
   * Owlic API key (`owlic_sk_…`), created from the Owlic dashboard.
   * Defaults to the `OWLIC_API_KEY` environment variable. Optional: a keyless
   * client can still call the open endpoints (`health()`); authenticated
   * methods then throw a helpful error at call time.
   */
  apiKey?: string;
  /**
   * API base URL. Defaults to the `OWLIC_BASE_URL` environment variable,
   * then `https://api.owlic.fr`.
   */
  baseUrl?: string;
  /** Request timeout in milliseconds (per attempt, covers the body read). Default: 30 000. */
  timeout?: number;
  /**
   * How many times a failed request is retried. Default: 2. Retries apply to
   * 429 (the API rejects rate-limited calls before processing them, so this is
   * safe for writes too, except quota exhaustion which is never retried), and
   * — for idempotent methods only (GET/HEAD/PUT/DELETE) — to timeouts,
   * connection errors and 5xx. POSTs are never replayed after a timeout/5xx:
   * the API has no idempotency keys, so a replay could duplicate the resource.
   */
  maxRetries?: number;
  /** Custom `fetch` implementation (testing, proxies, instrumentation…). */
  fetch?: typeof globalThis.fetch;
  /** Headers sent with every request (keys are case-insensitive). */
  defaultHeaders?: Record<string, string>;
  /**
   * API keys are SECRETS: using this SDK with a key in a browser exposes it to
   * every visitor. Only set this to true if you fully understand the
   * consequences. (A keyless client — e.g. for `health()` — is always allowed.)
   */
  dangerouslyAllowBrowser?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.owlic.fr';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8_000;
/** 429 backoff must outlast the API's fixed 10s per-IP rate-limit window. */
const RATE_LIMIT_BACKOFF_BASE_MS = 5_000;
const RATE_LIMIT_MAX_BACKOFF_MS = 20_000;
/** Beyond this server-requested wait, fail fast instead of blocking the caller. */
const MAX_HONORED_RETRY_AFTER_MS = 60_000;

function readEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  return process.env[name]?.trim() || undefined;
}

function isBrowserLike(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.document !== 'undefined' &&
    typeof navigator !== 'undefined'
  );
}

/** Abortable sleep: resolves after `ms`, rejects immediately on `signal` abort. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new OwlicError('Request aborted.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** Case-insensitive header merge: later sources override earlier ones. */
function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      merged[key.toLowerCase()] = value;
    }
  }
  return merged;
}

/**
 * Owlic public API client.
 *
 * ```ts
 * import { Owlic } from '@owlic/sdk';
 *
 * const owlic = new Owlic({ apiKey: process.env.OWLIC_API_KEY });
 *
 * const me = await owlic.whoami();
 * const trainers = await owlic.trainers.list();
 * const action = await owlic.trainingActions.create({
 *   title: 'Formation Excel avancé',
 *   requiresQualiopiCompliance: true,
 * });
 * ```
 */
export class Owlic implements ApiCaller {
  /** `/v1/trainers*` */
  readonly trainers: Trainers;
  /** `/v1/training-programs*` */
  readonly trainingPrograms: TrainingPrograms;
  /** `/v1/training-actions*` (reads + Qualiopi workflow writes) */
  readonly trainingActions: TrainingActions;

  readonly baseUrl: string;

  #apiKey: string | undefined;
  #timeout: number;
  #maxRetries: number;
  #fetch: typeof globalThis.fetch;
  #defaultHeaders: Record<string, string>;

  constructor(options: OwlicOptions = {}) {
    this.#apiKey = options.apiKey ?? readEnv('OWLIC_API_KEY');
    if (this.#apiKey && isBrowserLike() && options.dangerouslyAllowBrowser !== true) {
      throw new OwlicError(
        'The Owlic SDK must not run with an API key in a browser: the key would be visible to ' +
          'every visitor. Call the API from your backend instead. If you really know what you ' +
          'are doing, pass { dangerouslyAllowBrowser: true }.'
      );
    }

    this.baseUrl = (options.baseUrl ?? readEnv('OWLIC_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    // Bind the global fetch: browser/edge implementations are brand-checked and
    // throw "Illegal invocation" when invoked with a foreign `this` (here, the
    // Owlic instance via `this.#fetch(...)`). A user-supplied fetch is used as-is.
    const globalFetch =
      typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined;
    const fetchImpl = options.fetch ?? globalFetch;
    if (typeof fetchImpl !== 'function') {
      throw new OwlicError(
        'No fetch implementation available. Use Node.js >= 18 or pass one via new Owlic({ fetch }).'
      );
    }
    this.#fetch = fetchImpl;
    this.#defaultHeaders = options.defaultHeaders ?? {};

    this.trainers = new Trainers(this);
    this.trainingPrograms = new TrainingPrograms(this);
    this.trainingActions = new TrainingActions(this);
  }

  /** Identify the calling API key — useful to test authentication. */
  async whoami(options?: RequestOptions): Promise<WhoAmI> {
    return this.request<WhoAmI>('GET', '/v1/whoami', { options });
  }

  /**
   * Health check (no API key required — works on a keyless client). Returns
   * the payload for both 200 (healthy) and 503 (database unreachable) instead
   * of throwing — inspect `status`/`database` to tell them apart.
   */
  async health(options?: RequestOptions): Promise<Health> {
    return this.request<Health>('GET', '/health', { options, acceptStatuses: [503], auth: false });
  }

  /**
   * Perform a raw API call (escape hatch for endpoints the SDK does not wrap
   * yet). Handles auth, retries, timeout and error mapping like every other
   * method; returns the parsed JSON body.
   */
  async request<T>(
    method: HttpMethod,
    path: string,
    init: {
      query?: QueryParams;
      body?: unknown;
      options?: RequestOptions;
      /** Non-2xx statuses whose JSON body is returned instead of thrown (e.g. 503 for /health). */
      acceptStatuses?: readonly number[];
      /** Set to false for open endpoints; defaults to true (requires an API key). */
      auth?: boolean;
    } = {}
  ): Promise<T> {
    const requiresAuth = init.auth !== false;
    if (requiresAuth && !this.#apiKey) {
      throw new OwlicError(
        "Missing Owlic API key. Pass it explicitly (new Owlic({ apiKey: 'owlic_sk_…' })) " +
          'or set the OWLIC_API_KEY environment variable.'
      );
    }
    const maxRetries = init.options?.maxRetries ?? this.#maxRetries;
    let attempt = 0;
    for (;;) {
      try {
        return await this.#requestOnce<T>(method, path, init, requiresAuth);
      } catch (error) {
        if (attempt >= maxRetries || !this.#isRetryable(error, method) || init.options?.signal?.aborted) {
          throw error;
        }
        await sleep(this.#retryDelay(error, attempt), init.options?.signal);
        attempt += 1;
      }
    }
  }

  #isRetryable(error: unknown, method: HttpMethod): boolean {
    // 429 is safe to retry for ANY method: both API rate limiters (per-IP and
    // per-key) reject the request BEFORE it reaches a handler, so nothing was
    // processed. Exceptions: quota exhaustion (USAGE_EXCEEDED) is not
    // transient, and a server-requested wait beyond our cap should fail fast.
    if (error instanceof RateLimitError) {
      if (error.code === 'USAGE_EXCEEDED') return false;
      if (error.retryAfter !== undefined && error.retryAfter > MAX_HONORED_RETRY_AFTER_MS) return false;
      return true;
    }
    // Timeouts, connection errors and 5xx may have reached the server: only
    // idempotent methods are safe to replay (no idempotency keys on this API —
    // replaying a POST could duplicate the created resource).
    const isIdempotent = method === 'GET' || method === 'PUT' || method === 'DELETE';
    if (!isIdempotent) return false;
    if (error instanceof OwlicConnectionError || error instanceof OwlicTimeoutError) return true;
    if (error instanceof OwlicAPIError) return error.status >= 500;
    return false;
  }

  #retryDelay(error: unknown, attempt: number): number {
    if (error instanceof RateLimitError) {
      if (error.retryAfter !== undefined) return error.retryAfter;
      // No Retry-After header (this API never sends one): back off enough to
      // clear the 10s fixed per-IP window instead of re-failing inside it.
      const backoff = Math.min(2 ** attempt * RATE_LIMIT_BACKOFF_BASE_MS, RATE_LIMIT_MAX_BACKOFF_MS);
      return backoff / 2 + Math.random() * (backoff / 2);
    }
    const backoff = Math.min(2 ** attempt * 500, MAX_BACKOFF_MS);
    return backoff / 2 + Math.random() * (backoff / 2);
  }

  async #requestOnce<T>(
    method: HttpMethod,
    path: string,
    init: {
      query?: QueryParams;
      body?: unknown;
      options?: RequestOptions;
      acceptStatuses?: readonly number[];
    },
    requiresAuth: boolean
  ): Promise<T> {
    const url = this.#buildUrl(path, init.query);
    const baseHeaders: Record<string, string> = { accept: 'application/json' };
    if (requiresAuth && this.#apiKey) baseHeaders.authorization = `Bearer ${this.#apiKey}`;
    if (init.body !== undefined) baseHeaders['content-type'] = 'application/json';
    // Case-insensitive merge, user headers win (matching the RequestOptions doc).
    const headers = mergeHeaders(baseHeaders, this.#defaultHeaders, init.options?.headers);

    const controller = new AbortController();
    const timeoutMs = init.options?.timeout ?? this.#timeout;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const outerSignal = init.options?.signal;
    const forwardAbort = () => controller.abort(outerSignal?.reason);
    if (outerSignal) {
      if (outerSignal.aborted) {
        clearTimeout(timeoutId);
        throw outerSignal.reason instanceof Error ? outerSignal.reason : new OwlicError('Request aborted.');
      }
      outerSignal.addEventListener('abort', forwardAbort, { once: true });
    }

    let response: Response;
    let parsed: unknown;
    let parseFailed = false;
    // The timer and abort forwarding must stay armed until the BODY is read:
    // a server can send headers promptly then stall the body, and fetch only
    // cancels an in-flight body read if controller.abort() is actually called.
    try {
      try {
        response = await this.#fetch(url, {
          method,
          headers,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) {
          throw new OwlicTimeoutError(`Request to ${method} ${path} timed out after ${timeoutMs}ms.`, {
            cause: error,
          });
        }
        if (outerSignal?.aborted) throw error;
        throw new OwlicConnectionError(`Could not reach the Owlic API (${method} ${path}).`, { cause: error });
      }

      try {
        parsed = response.status === 204 ? undefined : await response.json();
      } catch (error) {
        if (timedOut) {
          throw new OwlicTimeoutError(`Request to ${method} ${path} timed out after ${timeoutMs}ms.`, {
            cause: error,
          });
        }
        if (outerSignal?.aborted) throw error;
        if (response.ok) {
          throw new OwlicError(`The Owlic API returned a non-JSON body for ${method} ${path}.`, {
            cause: error,
          });
        }
        parseFailed = true;
      }
    } finally {
      clearTimeout(timeoutId);
      outerSignal?.removeEventListener('abort', forwardAbort);
    }

    // acceptStatuses only short-circuits when there IS a parsable payload to
    // hand back — an unparsable 503 (e.g. an HTML load-balancer page) must
    // surface as an error, not resolve to `undefined`.
    if (response.ok || (!parseFailed && init.acceptStatuses?.includes(response.status))) {
      return parsed as T;
    }
    throw apiErrorFromResponse(response.status, parsed, response.headers);
  }

  #buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}
