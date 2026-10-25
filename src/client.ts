import {
  BadRequestError,
  RateLimitError,
  ServiceUnavailableError,
  SimpleVerifierError,
  TimeoutError,
  errorFromResponse,
} from "./errors.js";
import { RateLimiter, defaultSleep } from "./rateLimiter.js";
import type {
  BulkItem,
  EmailResult,
  PhoneResult,
  SimpleVerifierOptions,
  VerifyEmailsOptions,
  VerifyPhoneOptions,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://simpleverifier.com";
export const VERSION = "0.1.0";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_REQUESTS_PER_MINUTE = 120;
const DEFAULT_CONCURRENCY = 5;

function envKey(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env["SIMPLEVERIFIER_KEY"];
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, (date - Date.now()) / 1000);
}

function isRetryable(error: unknown): error is RateLimitError | ServiceUnavailableError {
  return error instanceof RateLimitError || error instanceof ServiceUnavailableError;
}

export class SimpleVerifier {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;

  constructor(options: SimpleVerifierOptions = {}) {
    const apiKey = options.apiKey ?? envKey();
    if (!apiKey) {
      throw new SimpleVerifierError(
        "Missing API key. Pass { apiKey } or set SIMPLEVERIFIER_KEY. Create one at https://simpleverifier.com/api-keys",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new SimpleVerifierError("No fetch implementation found. Use Node 18+ or pass { fetch }.");
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.baseDelayMs = options.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.fetchImpl = fetchImpl;
    this.limiter = new RateLimiter(options.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE);
  }

  /** Verify one email address: syntax, domain, disposable and live mailbox checks. */
  async verifyEmail(email: string): Promise<EmailResult> {
    if (typeof email !== "string" || !email.trim()) {
      throw new BadRequestError("email must be a non-empty string");
    }
    return this.request<EmailResult>("/api/v1/verify", { email: email.trim() });
  }

  /** Validate one phone number, with a live carrier lookup with the phone add-on. */
  async verifyPhone(phone: string, options: VerifyPhoneOptions = {}): Promise<PhoneResult> {
    if (typeof phone !== "string" || !phone.trim()) {
      throw new BadRequestError("phone must be a non-empty string");
    }
    const body: Record<string, string | boolean> = { phone: phone.trim() };
    if (options.country) body["country"] = options.country.trim().toUpperCase();
    if (options.live !== undefined) body["live"] = options.live;
    return this.request<PhoneResult>("/api/v1/phone", body);
  }

  /**
   * Verify many addresses with bounded concurrency. Requests are paced to the
   * client's per-minute cap, and 429s are retried with backoff. Never throws for
   * a single address: each item reports `ok: true` with a result or `ok: false`
   * with the error. Results come back in input order.
   */
  async verifyEmails(emails: readonly string[], options: VerifyEmailsOptions = {}): Promise<BulkItem[]> {
    const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
    const results = new Array<BulkItem>(emails.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < emails.length) {
        const index = next++;
        const email = emails[index] ?? "";
        let item: BulkItem;
        try {
          item = { email, ok: true, result: await this.verifyEmail(email) };
        } catch (error) {
          item = { email, ok: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
        results[index] = item;
        options.onResult?.(item);
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
    return results;
  }

  private async request<T>(path: string, body: Record<string, string | boolean>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.limiter.acquire();
        return await this.send<T>(path, body);
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.maxRetries) throw error;
        await defaultSleep(this.backoff(attempt, error));
      }
    }
  }

  private backoff(attempt: number, error: RateLimitError | ServiceUnavailableError): number {
    const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    const requested = error instanceof RateLimitError && error.retryAfter !== undefined ? error.retryAfter * 1000 : 0;
    return Math.max(exponential, Math.min(requested, this.maxDelayMs));
  }

  private async send<T>(path: string, body: Record<string, string | boolean>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": `simpleverifier-node/${VERSION}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new TimeoutError(this.timeoutMs);
      const reason = error instanceof Error ? error.message : String(error);
      throw new SimpleVerifierError(`Network error: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    const parsed: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw errorFromResponse(response.status, parsed, parseRetryAfter(response.headers.get("retry-after")));
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new SimpleVerifierError("Unexpected response from SimpleVerifier", response.status, parsed);
    }
    return parsed as T;
  }
}
