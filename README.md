# simpleverifier

Official Node.js client for the [SimpleVerifier](https://simpleverifier.com) email verification and phone validation API.

- Verify an email address: syntax, domain, disposable and live mailbox (SMTP) checks in one call. Get back `valid`, `risky` or `invalid` with a reason.
- Validate a phone number: E.164 form, country and line type, plus a live carrier lookup with the phone add-on.
- Zero runtime dependencies. Uses the built-in `fetch` (Node 18+). ESM and CommonJS, full TypeScript types.
- Typed errors, automatic retry with backoff on `429` and `503`, and a bulk helper that stays under the 120 calls a minute limit.

## Install

Not on npm yet. Install straight from GitHub (builds on install):

```bash
npm install github:Ahmedmkarrar/simpleverifier-node
```

The import name stays `simpleverifier`, so your code will not change when the npm package goes live.

## Quickstart

Create an API key on the [API keys page](https://simpleverifier.com/api-keys). Keys start with `sv_live_`. Keep them on your server: anyone who can read a key can use your plan.

```ts
import { SimpleVerifier } from "simpleverifier";

const sv = new SimpleVerifier({ apiKey: process.env.SIMPLEVERIFIER_KEY });

const result = await sv.verifyEmail("jane@company.com");
// { email: "jane@company.com", status: "valid", reason: "Mailbox exists", mailbox_checked: true }

if (result.status === "invalid") {
  throw new Error(`Please check your email: ${result.reason}`);
}
```

CommonJS works too:

```js
const { SimpleVerifier } = require("simpleverifier");
```

If you leave out `apiKey`, the client reads `SIMPLEVERIFIER_KEY` from the environment.

## Methods

### `new SimpleVerifier(options)`

| Option              | Default                      | Notes                                                                 |
| ------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `apiKey`            | `process.env.SIMPLEVERIFIER_KEY` | Required one way or the other.                                    |
| `baseUrl`           | `https://simpleverifier.com` |                                                                       |
| `timeoutMs`         | `30000`                      | A mailbox check can take a few seconds when a mail server is slow.    |
| `retry.maxRetries`  | `2`                          | Retries after `429` and `503`. Set to `0` to turn retries off.        |
| `retry.baseDelayMs` | `1000`                       | Doubles on each retry. A `Retry-After` header wins if it is longer.   |
| `retry.maxDelayMs`  | `30000`                      | Upper bound on a single wait.                                         |
| `requestsPerMinute` | `120`                        | Client-side pacing shared by every call on this client. `0` disables. |
| `fetch`             | `globalThis.fetch`           | Pass your own fetch for older runtimes or for testing.                |

### `verifyEmail(email)`

```ts
const r = await sv.verifyEmail("jane@company.com");
r.status;          // "valid" | "risky" | "invalid"
r.reason;          // e.g. "Mailbox exists", "Accepts all addresses", "Disposable address"
r.mailbox_checked; // true when the mail server was asked about the mailbox directly
```

| status    | Meaning                                                                                   |
| --------- | ----------------------------------------------------------------------------------------- |
| `valid`   | The mail server confirmed the mailbox exists.                                             |
| `risky`   | The address may work, but delivery isn't confirmed. Keep it out of cold campaigns.         |
| `invalid` | Don't send. It will bounce or it's a throwaway address.                                    |

### `verifyPhone(phone, { country, live })`

```ts
const p = await sv.verifyPhone("07911 123456", { country: "GB" });
// {
//   input: "07911 123456",
//   phone_status: "valid",
//   phone_e164: "+447911123456",
//   phone_country: "GG",
//   phone_type: "mobile",
//   phone_carrier: "JT Group Limited",
//   phone_line_type: "mobile",
//   live_lookup: true
// }
```

- `country`: two letters, used for numbers written without `+`. The server defaults to `US`.
- `live`: pass `false` to skip the live carrier lookup with the phone add-on.
- `phone_carrier` and `phone_line_type` appear only when `live_lookup` is `true`.

### `verifyEmails(list, { concurrency, onResult })`

Verifies many addresses with bounded concurrency (default `5`). Calls are paced to the client's `requestsPerMinute` and `429`s are retried, so a long list finishes instead of failing halfway. It never throws for a single address: each item tells you whether it worked. Results come back in input order.

```ts
const items = await sv.verifyEmails(emails, {
  concurrency: 5,
  onResult: (item) => console.log(item.email, item.ok ? item.result.status : item.error.message),
});

const valid = items.filter((i) => i.ok && i.result.status === "valid").map((i) => i.email);
```

At 120 calls a minute, 1,000 addresses take a little over eight minutes. For lists of thousands, upload a CSV in the [dashboard](https://simpleverifier.com) instead: it runs the same checks in bulk and returns valid, risky and invalid files.

## Error handling

Every error extends `SimpleVerifierError`, which carries `status` (the HTTP status, if any) and `body` (the parsed JSON error, if any).

| Class                     | Status | When                                                         |
| ------------------------- | ------ | ------------------------------------------------------------ |
| `BadRequestError`         | 400    | The email or phone parameter is missing.                     |
| `AuthError`               | 401    | The API key is missing, wrong or revoked.                    |
| `PaymentRequiredError`    | 402    | The key's subscription isn't active.                         |
| `RateLimitError`          | 429    | More than 120 calls a minute on one key. Has `retryAfter`.   |
| `ServiceUnavailableError` | 503    | The verification service is briefly unavailable.             |
| `TimeoutError`            | none   | No response within `timeoutMs`.                              |
| `SimpleVerifierError`     | any    | Network failures and any other status.                       |

```ts
import { AuthError, PaymentRequiredError, RateLimitError, SimpleVerifier } from "simpleverifier";

try {
  await sv.verifyEmail(email);
} catch (error) {
  if (error instanceof AuthError) {
    // Rotate or fix the key.
  } else if (error instanceof PaymentRequiredError) {
    // Renew at https://simpleverifier.com/pricing
  } else if (error instanceof RateLimitError) {
    // Already retried `retry.maxRetries` times. error.retryAfter is in seconds.
  } else {
    throw error;
  }
}
```

## Don't call it from the browser

The API key would be visible to anyone who opens your page. Call SimpleVerifier from your backend and pass the verdict to your form.

## Links

- API docs: https://simpleverifier.com/docs/api
- SDKs: https://simpleverifier.com/docs/sdks
- Pricing: https://simpleverifier.com/pricing
- Support: support@simpleverifier.com

## License

MIT, SimpleVerifier Team
