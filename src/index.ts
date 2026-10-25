export { SimpleVerifier, DEFAULT_BASE_URL, VERSION } from "./client.js";
export {
  SimpleVerifierError,
  BadRequestError,
  AuthError,
  PaymentRequiredError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
} from "./errors.js";
export { RateLimiter } from "./rateLimiter.js";
export type {
  BulkItem,
  EmailResult,
  EmailStatus,
  PhoneResult,
  PhoneStatus,
  PhoneType,
  RetryOptions,
  SimpleVerifierOptions,
  VerifyEmailsOptions,
  VerifyPhoneOptions,
} from "./types.js";
