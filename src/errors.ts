/**
 * Typed error hierarchy of the Owlic SDK.
 *
 * Every failure is an `OwlicError`; HTTP failures are `OwlicAPIError` with a
 * status-specific subclass so callers can `catch` (or `instanceof`) exactly the
 * case they care about. The API answers every error with an RFC 9457 Problem
 * Details body: `message` comes from its `detail`, `type`/`title`/`errors` from
 * the members of the same name, and `code` from the legacy `error` envelope
 * the API keeps for the whole life of `/v1`.
 */
import type { ErrorResponse, ProblemFieldError } from './types';

/** The Problem Details members an `OwlicAPIError` carries, when the body has them. */
export interface ProblemMembers {
  type?: string;
  title?: string;
  errors?: readonly ProblemFieldError[];
}

export class OwlicError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request never got an HTTP response (DNS, TLS, socket reset…). */
export class OwlicConnectionError extends OwlicError {}

/** The request exceeded the configured timeout. */
export class OwlicTimeoutError extends OwlicError {}

/** A non-2xx HTTP response from the API. */
export class OwlicAPIError extends OwlicError {
  /** HTTP status code (400, 401, …). */
  readonly status: number;
  /** Machine-readable code from the legacy `error` envelope (e.g. `INVALID_API_KEY`). */
  readonly code: string;
  /**
   * Problem type URI: its documentation page (e.g.
   * `https://api.owlic.fr/problems/invalid-api-key`), or `about:blank` when
   * the HTTP status says it all.
   */
  readonly type?: string;
  /** Short summary of the problem type, identical for every occurrence. */
  readonly title?: string;
  /** Every field the API rejected, when the request body failed schema validation. */
  readonly errors?: readonly ProblemFieldError[];

  constructor(status: number, code: string, message: string, problem: ProblemMembers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.type = problem.type;
    this.title = problem.title;
    this.errors = problem.errors;
  }
}

/** 400 — the request body or parameters were rejected. */
export class BadRequestError extends OwlicAPIError {}

/** 401 — missing or invalid API key. */
export class AuthenticationError extends OwlicAPIError {}

/** 403 — key disabled/expired. */
export class PermissionDeniedError extends OwlicAPIError {}

/** 404 — resource not found in the calling key's organization. */
export class NotFoundError extends OwlicAPIError {}

/** 422 — the operation was rejected by a domain rule. */
export class UnprocessableEntityError extends OwlicAPIError {}

/** 429 — per-key rate limit or usage quota exceeded. */
export class RateLimitError extends OwlicAPIError {
  /** Server-suggested wait before retrying, in milliseconds (from `Retry-After`). */
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number, problem: ProblemMembers = {}) {
    super(status, code, message, problem);
    this.retryAfter = retryAfter;
  }
}

/** 5xx — the API failed; safe to retry idempotent calls. */
export class InternalServerError extends OwlicAPIError {}

/** Parse `Retry-After` (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** An object whose members are named after `T`'s but not yet checked. */
type Unchecked<T> = { [K in keyof T]?: unknown };

function asObject(value: unknown): object | undefined {
  return typeof value === 'object' && value !== null ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isProblemFieldError(value: unknown): value is ProblemFieldError {
  const fieldError = asObject(value) as Unchecked<ProblemFieldError> | undefined;
  return typeof fieldError?.detail === 'string' && typeof fieldError.pointer === 'string';
}

/**
 * Read an error body member by member, keeping each one only when it has the
 * expected type: a body from a proxy, or from an API older than ADR-36, still
 * yields whatever it carries. Member names are anchored to the contract's
 * `ErrorResponse` type, so renaming one in `@owlic/api-contract` surfaces here
 * as a compile error instead of silently degrading every error to `UNKNOWN`.
 */
function readErrorBody(body: unknown): { code?: string; message?: string } & ProblemMembers {
  const problem = (asObject(body) ?? {}) as Unchecked<ErrorResponse>;
  const envelope = (asObject(problem.error) ?? {}) as Unchecked<ErrorResponse['error']>;
  return {
    code: asString(envelope.code),
    message: asString(problem.detail) ?? asString(envelope.message),
    type: asString(problem.type),
    title: asString(problem.title),
    errors: Array.isArray(problem.errors) ? problem.errors.filter(isProblemFieldError) : undefined,
  };
}

/** Build the right `OwlicAPIError` subclass for a response. */
export function apiErrorFromResponse(
  status: number,
  body: unknown,
  headers: { get(name: string): string | null }
): OwlicAPIError {
  const { code = 'UNKNOWN', message = `Request failed with status ${status}`, ...problem } = readErrorBody(body);

  switch (status) {
    case 400:
      return new BadRequestError(status, code, message, problem);
    case 401:
      return new AuthenticationError(status, code, message, problem);
    case 403:
      return new PermissionDeniedError(status, code, message, problem);
    case 404:
      return new NotFoundError(status, code, message, problem);
    case 422:
      return new UnprocessableEntityError(status, code, message, problem);
    case 429:
      return new RateLimitError(status, code, message, parseRetryAfter(headers.get('retry-after')), problem);
    default:
      if (status >= 500) return new InternalServerError(status, code, message, problem);
      return new OwlicAPIError(status, code, message, problem);
  }
}
