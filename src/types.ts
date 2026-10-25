export type EmailStatus = "valid" | "risky" | "invalid";

export interface EmailResult {
  email: string;
  status: EmailStatus;
  /** Human-readable reason, e.g. "Mailbox exists" or "Disposable address". */
  reason: string;
  /** True when the mail server was asked about the mailbox directly. */
  mailbox_checked: boolean;
}

export type PhoneStatus = "valid" | "invalid" | "empty";

export type PhoneType =
  | "mobile"
  | "landline"
  | "mobile_or_landline"
  | "toll_free"
  | "premium_rate"
  | "voip"
  | "shared_cost"
  | "personal"
  | "pager"
  | "uan"
  | "voicemail"
  | "unknown"
  | "";

export interface PhoneResult {
  input: string;
  phone_status: PhoneStatus;
  /** The number in E.164 form, e.g. "+447911123456". Empty when invalid. */
  phone_e164: string;
  /** Two-letter country code of the number. */
  phone_country: string;
  /** Line type from the numbering plan. */
  phone_type: PhoneType;
  /** Carrier name. Present only when `live_lookup` is true. */
  phone_carrier?: string;
  /** Line type from the live carrier lookup. Present only when `live_lookup` is true. */
  phone_line_type?: string;
  /** True when a live carrier lookup ran for this number. */
  live_lookup: boolean;
}

export interface VerifyPhoneOptions {
  /** Two-letter country used for numbers written without a leading +. Defaults to "US" on the server. */
  country?: string;
  /** Set to false to skip the live carrier lookup with the phone add-on. Defaults to true. */
  live?: boolean;
}

export interface RetryOptions {
  /** Retries after a 429 or 503 response. Defaults to 2. Set to 0 to disable. */
  maxRetries?: number;
  /** First backoff delay in milliseconds, doubled on each retry. Defaults to 1000. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff delay in milliseconds. Defaults to 30000. */
  maxDelayMs?: number;
}

export interface SimpleVerifierOptions {
  /** Your API key, starting with `sv_live_`. Defaults to `process.env.SIMPLEVERIFIER_KEY`. */
  apiKey?: string;
  /** Defaults to "https://simpleverifier.com". */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Automatic retry with exponential backoff on 429 and 503. */
  retry?: RetryOptions;
  /**
   * Client-side cap on requests per minute, shared by every call on this client.
   * Defaults to 120, the per-key limit. Set to 0 to disable.
   */
  requestsPerMinute?: number;
  /** Custom fetch implementation. Defaults to the global `fetch` (Node 18+). */
  fetch?: typeof fetch;
}

export interface VerifyEmailsOptions {
  /** Requests in flight at once. Defaults to 5. */
  concurrency?: number;
  /** Called once per address as soon as its result (or error) is known. */
  onResult?: (item: BulkItem) => void;
}

export type BulkItem =
  | { email: string; ok: true; result: EmailResult }
  | { email: string; ok: false; error: Error };
