import { describe, expect, it, vi } from "vitest";
import { CloudflareApiError } from "../../src/cloudflare/apiError.js";
import { CloudflareClient } from "../../src/cloudflare/client.js";

const TOKEN = "unit-test-credential";
const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

type MockFetcher = (input: string, init: RequestInit) => Promise<Response>;

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function success(result: unknown, resultInfo?: unknown): Response {
  return jsonResponse({
    errors: [],
    messages: [],
    result,
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
    success: true,
  });
}

function respondWith(response: Response): MockFetcher {
  return () => Promise.resolve(response);
}

describe("CloudflareClient", () => {
  it("verifies an active token without exposing it", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(success({ id: "token-id", status: "active" })),
    );
    const client = new CloudflareClient(TOKEN, { fetcher });

    await expect(client.verifyToken()).resolves.toEqual({
      id: "token-id",
      status: "active",
    });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("rejects disabled and expired tokens as authentication failures", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(success({ id: "token-id", status: "disabled" })),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).verifyToken(),
    ).rejects.toMatchObject({ kind: "authentication" });
  });

  it("lists and de-duplicates paginated accounts", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: index.toString(16).padStart(32, "0"),
      name: `Account ${String(index)}`,
    }));
    const fetcher = vi
      .fn<MockFetcher>()
      .mockResolvedValueOnce(success(firstPage, { total_count: 51 }))
      .mockResolvedValueOnce(
        success(
          [firstPage[0], { id: "f".repeat(32), name: "Final account" }],
          { total_count: 51 },
        ),
      );

    const accounts = await new CloudflareClient(TOKEN, {
      fetcher,
    }).listAccounts();

    expect(accounts).toHaveLength(51);
    expect(accounts.at(-1)).toEqual({
      id: "f".repeat(32),
      name: "Final account",
    });
    expect(fetcher.mock.calls[1]?.[0]).toContain("page=2");
  });

  it("checks Workers Scripts and Builds access for a safe account ID", async () => {
    const fetcher = vi
      .fn<MockFetcher>()
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(success({ has_reached_build_minutes_limit: false }));

    await new CloudflareClient(TOKEN, { fetcher }).checkAccountAccess(ACCOUNT_ID);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`,
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/builds/account/limits`,
    ]);
  });

  it("rejects an unsafe account ID before making a request", async () => {
    const fetcher = vi.fn<MockFetcher>(respondWith(success({})));
    const client = new CloudflareClient(TOKEN, { fetcher });

    await expect(client.checkAccountAccess("../user/tokens/verify"))
      .rejects.toMatchObject({ kind: "invalidResponse" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps permission failures without retaining response content", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        jsonResponse(
          {
            errors: [{ code: 10000, message: `Leaked ${TOKEN}` }],
            success: false,
          },
          403,
        ),
      ),
    );

    const failure = new CloudflareClient(TOKEN, { fetcher }).verifyToken();
    await expect(failure).rejects.toMatchObject({ kind: "permission" });
    await expect(failure).rejects.not.toThrow(TOKEN);
  });

  it("retains only bounded Retry-After metadata", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(jsonResponse({}, 429, { "retry-after": "30" })),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).verifyToken(),
    ).rejects.toMatchObject({
      kind: "rateLimit",
      retryAfterSeconds: 30,
    });
  });

  it("rejects oversized responses before parsing them", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(jsonResponse({}, 200, { "content-length": "2048" })),
    );

    await expect(
      new CloudflareClient(TOKEN, {
        fetcher,
        maxResponseBytes: 1024,
      }).verifyToken(),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("stops reading a streaming response at the byte limit", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(success({ value: "x".repeat(2048) })),
    );

    await expect(
      new CloudflareClient(TOKEN, {
        fetcher,
        maxResponseBytes: 1024,
      }).verifyToken(),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("turns fetch failures into safe network errors", async () => {
    const fetcher = vi.fn<MockFetcher>(() =>
      Promise.reject(new Error(`Network failure with ${TOKEN}`)),
    );

    const failure = new CloudflareClient(TOKEN, { fetcher }).verifyToken();
    await expect(failure).rejects.toBeInstanceOf(CloudflareApiError);
    await expect(failure).rejects.toMatchObject({
      kind: "network",
      message: "Cloudflare could not be reached.",
    });
    await expect(failure).rejects.not.toThrow(TOKEN);
  });
});
