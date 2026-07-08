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
import type { ApiCaller, DataEnvelope, Health, HttpMethod, QueryParams, RequestOptions, WhoAmI } from './types';

export interface OwlicOptions {
  /**
   * Owlic API key (`owlic_sk_…`), created from the Owlic dashboard.
   * Defaults to the `OWLIC_API_KEY` environment variable.
   */
  apiKey?: string;
  /**
   * API base URL. Defaults to the `OWLIC_BASE_URL` environment variable,
   * then `https://api.owlic.fr`.
   */
  baseUrl?: string;
  /** Request timeout in milliseconds (per attempt). Default: 30 000. */
  timeout?: number;
  /**
   * How many times a failed request is retried (connection errors, timeouts,
   * 429 and 5xx — with exponential backoff, honoring `Retry-After`). Default: 2.
   */
  maxRetries?: number;
  /** Custom `fetch` implementation (testing, proxies, instrumentation…). */
  fetch?: typeof globalThis.fetch;
  /** Headers sent with every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * API keys are SECRETS: using this SDK in a browser exposes yours to every
   * visitor. Only set this to true if you fully understand the consequences.
   */
  dangerouslyAllowBrowser?: boolean;
}

const DEFAULT_BASE_URL = 'https://api.owlic.fr';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 8_000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  #apiKey: string;
  #timeout: number;
  #maxRetries: number;
  #fetch: typeof globalThis.fetch;
  #defaultHeaders: Record<string, string>;

  constructor(options: OwlicOptions = {}) {
    const apiKey = options.apiKey ?? readEnv('OWLIC_API_KEY');
    if (!apiKey) {
      throw new OwlicError(
        "Missing Owlic API key. Pass it explicitly (new Owlic({ apiKey: 'owlic_sk_…' })) " +
          'or set the OWLIC_API_KEY environment variable.'
      );
    }
    if (isBrowserLike() && options.dangerouslyAllowBrowser !== true) {
      throw new OwlicError(
        'The Owlic SDK must not run in a browser: your API key would be visible to every visitor. ' +
          'Call the API from your backend instead. If you really know what you are doing, ' +
          'pass { dangerouslyAllowBrowser: true }.'
      );
    }

    this.#apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? readEnv('OWLIC_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#defaultHeaders = options.defaultHeaders ?? {};
    if (typeof this.#fetch !== 'function') {
      throw new OwlicError(
        'No fetch implementation available. Use Node.js >= 18 or pass one via new Owlic({ fetch }).'
      );
    }

    this.trainers = new Trainers(this);
    this.trainingPrograms = new TrainingPrograms(this);
    this.trainingActions = new TrainingActions(this);
  }

  /** Identify the calling API key — useful to test authentication. */
  async whoami(options?: RequestOptions): Promise<WhoAmI> {
    return this.request<WhoAmI>('GET', '/v1/whoami', { options });
  }

  /**
   * Health check (no API key required). Returns the payload for both 200
   * (healthy) and 503 (database unreachable) instead of throwing — inspect
   * `status`/`database` to tell them apart.
   */
  async health(options?: RequestOptions): Promise<Health> {
    return this.request<Health>('GET', '/health', { options, acceptStatuses: [503] });
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
      acceptStatuses?: readonly number[];
    } = {}
  ): Promise<T> {
    const maxRetries = init.options?.maxRetries ?? this.#maxRetries;
    let attempt = 0;
    for (;;) {
      try {
        return await this.#requestOnce<T>(method, path, init);
      } catch (error) {
        if (attempt >= maxRetries || !this.#isRetryable(error) || init.options?.signal?.aborted) {
          throw error;
        }
        await sleep(this.#retryDelay(error, attempt));
        attempt += 1;
      }
    }
  }

  #isRetryable(error: unknown): boolean {
    if (error instanceof OwlicConnectionError || error instanceof OwlicTimeoutError) return true;
    if (error instanceof OwlicAPIError) return error.status === 429 || error.status >= 500;
    return false;
  }

  #retryDelay(error: unknown, attempt: number): number {
    if (error instanceof RateLimitError && error.retryAfter !== undefined) {
      return Math.min(error.retryAfter, 60_000);
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
    }
  ): Promise<T> {
    const url = this.#buildUrl(path, init.query);
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#apiKey}`,
      accept: 'application/json',
      ...this.#defaultHeaders,
      ...init.options?.headers,
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';

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
    } finally {
      clearTimeout(timeoutId);
      outerSignal?.removeEventListener('abort', forwardAbort);
    }

    let parsed: unknown;
    try {
      parsed = response.status === 204 ? undefined : await response.json();
    } catch (error) {
      if (response.ok) {
        throw new OwlicError(`The Owlic API returned a non-JSON body for ${method} ${path}.`, { cause: error });
      }
      parsed = undefined;
    }

    if (response.ok || init.acceptStatuses?.includes(response.status)) {
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

// Convenience alias for callers who prefer an explicit name.
export { Owlic as OwlicClient };
export type { DataEnvelope };
