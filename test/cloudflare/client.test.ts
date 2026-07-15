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

  it("lists Workers by immutable tag", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        success([
          { id: "api-worker", tag: "a".repeat(32) },
          { id: "web-worker", tag: "b".repeat(32) },
        ]),
      ),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).listWorkers(ACCOUNT_ID),
    ).resolves.toEqual([
      { name: "api-worker", tag: "a".repeat(32) },
      { name: "web-worker", tag: "b".repeat(32) },
    ]);
  });

  it("parses production and preview GitHub triggers", async () => {
    const workerTag = "a".repeat(32);
    const repository = {
      provider_account_name: "Cloudflare",
      provider_type: "github",
      repo_name: "workers-sdk",
    };
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        success([
          {
            branch_excludes: [],
            branch_includes: ["main"],
            deploy_command: "npx wrangler deploy",
            repo_connection: repository,
            root_directory: "/apps/api",
            trigger_name: "Production",
            trigger_uuid: "11111111-1111-1111-1111-111111111111",
          },
          {
            branch_excludes: ["main"],
            branch_includes: ["*"],
            deploy_command: "npx wrangler versions upload",
            repo_connection: repository,
            root_directory: "/apps/api",
            trigger_name: "Preview",
            trigger_uuid: "22222222-2222-2222-2222-222222222222",
          },
        ]),
      ),
    );

    const triggers = await new CloudflareClient(TOKEN, { fetcher }).listTriggers(
      ACCOUNT_ID,
      workerTag,
    );

    expect(triggers).toMatchObject([
      {
        environment: "production",
        repositoryCanonicalName: "cloudflare/workers-sdk",
      },
      {
        environment: "preview",
        repositoryCanonicalName: "cloudflare/workers-sdk",
      },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toContain(
      `/builds/workers/${workerTag}/triggers`,
    );
  });

  it("lists bounded recent builds and omits build token and environment data", async () => {
    const workerTag = "a".repeat(32);
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        success([
          {
            build_outcome: "success",
            build_trigger_metadata: {
              branch: "feature/builds",
              build_token_name: "must-not-leave-parser",
              build_token_uuid: "11111111-1111-1111-1111-111111111111",
              build_trigger_source: "push",
              commit_hash: "b".repeat(40),
              commit_message: "Add build retrieval",
              environment_variables: { PRIVATE_BUILD_VALUE: "not-exposed" },
            },
            build_uuid: "22222222-2222-2222-2222-222222222222",
            created_on: "2026-01-02T03:04:05Z",
            initializing_on: "2026-01-02T03:04:06Z",
            modified_on: "2026-01-02T03:05:05Z",
            running_on: "2026-01-02T03:04:07Z",
            status: "stopped",
            stopped_on: "2026-01-02T03:05:04Z",
            trigger: {
              branch_excludes: ["main"],
              branch_includes: ["*"],
              deploy_command: "npx wrangler versions upload",
              external_script_id: workerTag,
              repo_connection: {
                provider_account_name: "Cloudflare",
                provider_type: "github",
                repo_name: "workers-sdk",
              },
              root_directory: "/apps/api",
              trigger_name: "Preview",
              trigger_uuid: "33333333-3333-3333-3333-333333333333",
            },
          },
        ]),
      ),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).listBuilds(ACCOUNT_ID, workerTag, 2),
    ).resolves.toEqual([
      {
        branch: "feature/builds",
        commitHash: "b".repeat(40),
        commitMessage: "Add build retrieval",
        createdOn: "2026-01-02T03:04:05Z",
        environment: "preview",
        initializingOn: "2026-01-02T03:04:06Z",
        modifiedOn: "2026-01-02T03:05:05Z",
        outcome: "success",
        runningOn: "2026-01-02T03:04:07Z",
        status: "stopped",
        stoppedOn: "2026-01-02T03:05:04Z",
        triggerSource: "push",
        uuid: "22222222-2222-2222-2222-222222222222",
      },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/builds/workers/${workerTag}/builds?page=1&per_page=2`,
    );
  });

  it("gets one build with an independent lifecycle status and outcome", async () => {
    const buildUuid = "44444444-4444-4444-4444-444444444444";
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        success({
          build_trigger_metadata: {
            branch: "main",
            build_trigger_source: "api",
            commit_hash: "c".repeat(64),
            commit_message: "Deploy the release",
          },
          build_uuid: buildUuid,
          created_on: "2026-02-03T04:05:06+00:00",
          modified_on: "2026-02-03T04:05:06+00:00",
          status: "running",
          trigger: {
            branch_excludes: [],
            branch_includes: ["main"],
            external_script_id: "d".repeat(32),
            repo_connection: {
              provider_account_name: "Cloudflare",
              provider_type: "github",
              repo_name: "workers-sdk",
            },
            root_directory: "/apps/api",
            trigger_name: "Production",
            trigger_uuid: "55555555-5555-5555-5555-555555555555",
          },
        }),
      ),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).getBuild(ACCOUNT_ID, buildUuid),
    ).resolves.toEqual({
      branch: "main",
      commitHash: "c".repeat(64),
      commitMessage: "Deploy the release",
      createdOn: "2026-02-03T04:05:06+00:00",
      environment: "production",
      modifiedOn: "2026-02-03T04:05:06+00:00",
      status: "running",
      triggerSource: "api",
      uuid: buildUuid,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/builds/builds/${buildUuid}`,
    );
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

  it("rejects trigger path injection before making a request", async () => {
    const fetcher = vi.fn<MockFetcher>(respondWith(success([])));

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).listTriggers(
        ACCOUNT_ID,
        "worker/../../user/tokens/verify",
      ),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects account pages larger than the requested page size", async () => {
    const tooManyAccounts = Array.from({ length: 51 }, (_, index) => ({
      id: index.toString(16).padStart(32, "0"),
      name: `Account ${String(index)}`,
    }));

    await expect(
      new CloudflareClient(TOKEN, {
        fetcher: respondWith(success(tooManyAccounts)),
      }).listAccounts(),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("rejects control characters in trigger text returned for display", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        success([
          {
            branch_excludes: [],
            branch_includes: ["main"],
            repo_connection: {
              provider_account_name: "Cloudflare",
              provider_type: "github",
              repo_name: "workers-sdk",
            },
            root_directory: "/apps/api",
            trigger_name: "Production\u001b[2J",
            trigger_uuid: "11111111-1111-1111-1111-111111111111",
          },
        ]),
      ),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).listTriggers(
        ACCOUNT_ID,
        "a".repeat(32),
      ),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("does not classify arbitrary deploy-command text as a preview trigger", async () => {
    const fetcher = vi.fn<MockFetcher>(
      respondWith(
        success([
          {
            branch_excludes: [],
            branch_includes: ["main"],
            deploy_command: "echo versions upload",
            repo_connection: {
              provider_account_name: "Cloudflare",
              provider_type: "github",
              repo_name: "workers-sdk",
            },
            root_directory: "/apps/api",
            trigger_name: "Production",
            trigger_uuid: "11111111-1111-1111-1111-111111111111",
          },
        ]),
      ),
    );

    await expect(
      new CloudflareClient(TOKEN, { fetcher }).listTriggers(
        ACCOUNT_ID,
        "a".repeat(32),
      ),
    ).resolves.toMatchObject([{ environment: "production" }]);
  });

  it("keeps response-stream failures from exposing error details", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.error(new Error(`stream failure with ${TOKEN}`));
        },
      }),
    );
    const failure = new CloudflareClient(TOKEN, {
      fetcher: respondWith(response),
    }).verifyToken();

    await expect(failure).rejects.toMatchObject({ kind: "invalidResponse" });
    await expect(failure).rejects.not.toThrow(TOKEN);
  });

  it("applies the request timeout while reading a stalled response body", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(): void {
          // Keep the body open without producing a chunk.
        },
      }),
    );

    await expect(
      new CloudflareClient(TOKEN, {
        fetcher: respondWith(response),
        timeoutMs: 10,
      }).verifyToken(),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("rejects unbounded response and timeout overrides", () => {
    expect(
      () => new CloudflareClient(TOKEN, { maxResponseBytes: Infinity }),
    ).toThrow("Cloudflare returned an invalid response.");
    expect(() => new CloudflareClient(TOKEN, { timeoutMs: 60_001 })).toThrow(
      "Cloudflare returned an invalid response.",
    );
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
