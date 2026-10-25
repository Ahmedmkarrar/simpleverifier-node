import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  BadRequestError,
  PaymentRequiredError,
  RateLimitError,
  RateLimiter,
  ServiceUnavailableError,
  SimpleVerifier,
  SimpleVerifierError,
  TimeoutError,
  type EmailResult,
  type PhoneResult,
} from "../src/index.js";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

const VALID: EmailResult = {
  email: "jane@company.com",
  status: "valid",
  reason: "Mailbox exists",
  mailbox_checked: true,
};

const PHONE: PhoneResult = {
  input: "07911 123456",
  phone_status: "valid",
  phone_e164: "+447911123456",
  phone_country: "GG",
  phone_type: "mobile",
  phone_carrier: "JT Group Limited",
  phone_line_type: "mobile",
  live_lookup: true,
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function client(fetchMock: FetchMock, extra: Partial<ConstructorParameters<typeof SimpleVerifier>[0]> = {}) {
  return new SimpleVerifier({
    apiKey: "sv_live_test",
    fetch: fetchMock,
    retry: { maxRetries: 0, baseDelayMs: 1 },
    requestsPerMinute: 0,
    ...extra,
  });
}

function sentBody(fetchMock: FetchMock, call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("constructor", () => {
  it("throws without an API key", () => {
    vi.stubEnv("SIMPLEVERIFIER_KEY", "");
    expect(() => new SimpleVerifier({ fetch: vi.fn<typeof fetch>() })).toThrow(SimpleVerifierError);
  });

  it("reads the key from SIMPLEVERIFIER_KEY", async () => {
    vi.stubEnv("SIMPLEVERIFIER_KEY", "sv_live_env");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(200, VALID));
    await new SimpleVerifier({ fetch: fetchMock, requestsPerMinute: 0 }).verifyEmail("jane@company.com");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sv_live_env");
  });
});

describe("verifyEmail", () => {
  it("POSTs the address with a bearer token and returns the result", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(200, VALID));
    const result = await client(fetchMock).verifyEmail("  jane@company.com ");

    expect(result).toEqual(VALID);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://simpleverifier.com/api/v1/verify");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer sv_live_test");
    expect(sentBody(fetchMock)).toEqual({ email: "jane@company.com" });
  });

  it("honours a custom base URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(200, VALID));
    await client(fetchMock, { baseUrl: "http://localhost:3000/" }).verifyEmail("a@b.co");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3000/api/v1/verify");
  });

  it("rejects an empty address without calling the API", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(client(fetchMock).verifyEmail(" ")).rejects.toBeInstanceOf(BadRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyPhone", () => {
  it("sends phone, country and live", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(200, PHONE));
    const result = await client(fetchMock).verifyPhone("07911 123456", { country: "gb", live: false });

    expect(result).toEqual(PHONE);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://simpleverifier.com/api/v1/phone");
    expect(sentBody(fetchMock)).toEqual({ phone: "07911 123456", country: "GB", live: false });
  });

  it("omits optional fields when not given", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(200, PHONE));
    await client(fetchMock).verifyPhone("+447911123456");
    expect(sentBody(fetchMock)).toEqual({ phone: "+447911123456" });
  });
});

describe("errors", () => {
  it.each([
    [400, BadRequestError],
    [401, AuthError],
    [402, PaymentRequiredError],
    [429, RateLimitError],
    [503, ServiceUnavailableError],
  ])("maps %i to the right error class", async (status, ErrorClass) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(status, { error: "nope" }));
    const promise = client(fetchMock).verifyEmail("a@b.co");
    await expect(promise).rejects.toBeInstanceOf(ErrorClass);
    await expect(promise).rejects.toMatchObject({ status, message: "nope", body: { error: "nope" } });
  });

  it("falls back to a generic error for other statuses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>", { status: 500 }));
    const error = await client(fetchMock).verifyEmail("a@b.co").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SimpleVerifierError);
    expect(error).toMatchObject({ status: 500, message: "Request failed with status 500" });
  });

  it("reads Retry-After into RateLimitError", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(429, { error: "slow down" }, { "Retry-After": "7" }));
    const error = await client(fetchMock).verifyEmail("a@b.co").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(7);
  });

  it("wraps network failures", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(client(fetchMock).verifyEmail("a@b.co")).rejects.toThrow("Network error: fetch failed");
  });

  it("times out slow requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    await expect(client(fetchMock, { timeoutMs: 20 }).verifyEmail("a@b.co")).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("retries", () => {
  it("retries 429 and 503 then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(429, { error: "slow down" }, { "Retry-After": "0" }))
      .mockResolvedValueOnce(json(503, { error: "busy" }))
      .mockResolvedValueOnce(json(200, VALID));
    const result = await client(fetchMock, { retry: { maxRetries: 2, baseDelayMs: 1 } }).verifyEmail("a@b.co");
    expect(result).toEqual(VALID);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(429, { error: "slow down" }));
    await expect(
      client(fetchMock, { retry: { maxRetries: 2, baseDelayMs: 1 } }).verifyEmail("a@b.co"),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries auth or payment errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json(401, { error: "bad key" }));
    await expect(
      client(fetchMock, { retry: { maxRetries: 3, baseDelayMs: 1 } }).verifyEmail("a@b.co"),
    ).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("verifyEmails", () => {
  it("returns results in input order and reports per-item errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const { email } = JSON.parse(String(init?.body)) as { email: string };
      if (email === "bad@x.co") return json(400, { error: "That is not an email address" });
      await new Promise((resolve) => setTimeout(resolve, email === "a@x.co" ? 15 : 1));
      return json(200, { ...VALID, email });
    });
    const seen: string[] = [];
    const items = await client(fetchMock).verifyEmails(["a@x.co", "bad@x.co", "c@x.co"], {
      concurrency: 3,
      onResult: (item) => seen.push(item.email),
    });

    expect(items.map((i) => i.email)).toEqual(["a@x.co", "bad@x.co", "c@x.co"]);
    expect(items[0]).toMatchObject({ ok: true, result: { email: "a@x.co" } });
    expect(items[1]?.ok).toBe(false);
    expect(items[1]?.ok === false && items[1].error).toBeInstanceOf(BadRequestError);
    expect(seen).toHaveLength(3);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return json(200, VALID);
    });
    const emails = Array.from({ length: 20 }, (_, i) => `u${i}@x.co`);
    const items = await client(fetchMock).verifyEmails(emails, { concurrency: 4 });
    expect(items.every((i) => i.ok)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("handles an empty list", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(await client(fetchMock).verifyEmails([])).toEqual([]);
  });
});

describe("RateLimiter", () => {
  it("allows `limit` calls per window and then waits", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(
      3,
      60_000,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );

    for (let i = 0; i < 3; i++) await limiter.acquire();
    expect(waits).toEqual([]);

    now = 10_000;
    await limiter.acquire();
    expect(waits).toEqual([50_000]);
    expect(now).toBe(60_000);
  });

  it("is a no-op when disabled", async () => {
    const sleep = vi.fn(async () => undefined);
    const limiter = new RateLimiter(0, 60_000, () => 0, sleep);
    for (let i = 0; i < 500; i++) await limiter.acquire();
    expect(sleep).not.toHaveBeenCalled();
  });
});
