/** Base class for every error this package throws. */
export class SimpleVerifierError extends Error {
  /** HTTP status code, or `undefined` for network failures and timeouts. */
  readonly status: number | undefined;
  /** Parsed JSON body of the error response, when there was one. */
  readonly body: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "SimpleVerifierError";
    this.status = status;
    this.body = body;
  }
}

/** 400: the email or phone parameter is missing or malformed. */
export class BadRequestError extends SimpleVerifierError {
  constructor(message: string, body?: unknown) {
    super(message, 400, body);
    this.name = "BadRequestError";
  }
}

/** 401: the API key is missing, wrong or revoked. */
export class AuthError extends SimpleVerifierError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
    this.name = "AuthError";
  }
}

/** 402: no API access on the plan, inactive subscription, or a yearly plan's monthly calls used. */
export class PaymentRequiredError extends SimpleVerifierError {
  /** Seconds until the quota resets; set for the quota case only. */
  readonly retryAfter: number | undefined;

  constructor(message: string, body?: unknown, retryAfter?: number) {
    super(message, 402, body);
    this.name = "PaymentRequiredError";
    this.retryAfter = retryAfter;
  }
}

/** 429: more than 120 calls a minute on one key. */
export class RateLimitError extends SimpleVerifierError {
  /** Seconds the server asked us to wait, when it sent a Retry-After header. */
  readonly retryAfter: number | undefined;

  constructor(message: string, retryAfter?: number, body?: unknown) {
    super(message, 429, body);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/** 503: the verification service is briefly unavailable. */
export class ServiceUnavailableError extends SimpleVerifierError {
  constructor(message: string, body?: unknown) {
    super(message, 503, body);
    this.name = "ServiceUnavailableError";
  }
}

/** The request did not complete within the configured timeout. */
export class TimeoutError extends SimpleVerifierError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export function errorFromResponse(status: number, body: unknown, retryAfter?: number): SimpleVerifierError {
  const message = messageFrom(body) ?? `Request failed with status ${status}`;
  switch (status) {
    case 400:
      return new BadRequestError(message, body);
    case 401:
      return new AuthError(message, body);
    case 402:
      return new PaymentRequiredError(message, body, retryAfter);
    case 429:
      return new RateLimitError(message, retryAfter, body);
    case 503:
      return new ServiceUnavailableError(message, body);
    default:
      return new SimpleVerifierError(message, status, body);
  }
}

function messageFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body as { error: unknown };
  return typeof error === "string" && error ? error : undefined;
}
