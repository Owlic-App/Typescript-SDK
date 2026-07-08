/**
 * Typed error hierarchy of the Owlic SDK.
 *
 * Every failure is an `OwlicError`; HTTP failures are `OwlicAPIError` with a
 * status-specific subclass so callers can `catch` (or `instanceof`) exactly the
 * case they care about. `code`/`message` come from the API's uniform
 * `{ error: { code, message } }` envelope.
 */

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
  /** Machine-readable code from the error envelope (e.g. `INVALID_API_KEY`). */
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 400 — the request body or parameters were rejected. */
export class BadRequestError extends OwlicAPIError {}

/** 401 — missing or invalid API key. */
export class AuthenticationError extends OwlicAPIError {}

/** 403 — key disabled/expired, or the `apiKeys` feature is off for the organization. */
export class PermissionDeniedError extends OwlicAPIError {}

/** 404 — resource not found in the calling key's organization. */
export class NotFoundError extends OwlicAPIError {}

/** 422 — the operation was rejected by a domain rule. */
export class UnprocessableEntityError extends OwlicAPIError {}

/** 429 — per-key rate limit or usage quota exceeded. */
export class RateLimitError extends OwlicAPIError {
  /** Server-suggested wait before retrying, in milliseconds (from `Retry-After`). */
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(status, code, message);
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

/** Build the right `OwlicAPIError` subclass for a response. */
export function apiErrorFromResponse(
  status: number,
  body: unknown,
  headers: { get(name: string): string | null }
): OwlicAPIError {
  let code = 'UNKNOWN';
  let message = `Request failed with status ${status}`;
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as { error: unknown }).error === 'object' &&
    (body as { error: unknown }).error !== null
  ) {
    const err = (body as { error: Record<string, unknown> }).error;
    if (typeof err.code === 'string') code = err.code;
    if (typeof err.message === 'string') message = err.message;
  }

  switch (status) {
    case 400:
      return new BadRequestError(status, code, message);
    case 401:
      return new AuthenticationError(status, code, message);
    case 403:
      return new PermissionDeniedError(status, code, message);
    case 404:
      return new NotFoundError(status, code, message);
    case 422:
      return new UnprocessableEntityError(status, code, message);
    case 429:
      return new RateLimitError(status, code, message, parseRetryAfter(headers.get('retry-after')));
    default:
      if (status >= 500) return new InternalServerError(status, code, message);
      return new OwlicAPIError(status, code, message);
  }
}
