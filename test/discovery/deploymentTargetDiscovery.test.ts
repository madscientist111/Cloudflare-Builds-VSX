import { describe, expect, it, vi } from "vitest";
import { CloudflareApiError } from "../../src/cloudflare/apiError.js";
import type {
  BuildTrigger,
  WorkerRef,
} from "../../src/cloudflare/client.js";
import { DeploymentTargetDiscovery } from "../../src/discovery/deploymentTargetDiscovery.js";
import type { GitHubRepositoryIdentity } from "../../src/git/repositoryIdentity.js";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const REPOSITORY: GitHubRepositoryIdentity = {
  canonicalName: "cloudflare/workers-sdk",
  name: "workers-sdk",
  owner: "Cloudflare",
  provider: "github",
};

type DiscoveryClient = {
  listTriggers(accountId: string, workerTag: string): Promise<BuildTrigger[]>;
  listWorkers(accountId: string): Promise<WorkerRef[]>;
};

function worker(name: string, tag: string): WorkerRef {
  return { name, tag };
}

function trigger(
  workerTag: string,
  repositoryCanonicalName = REPOSITORY.canonicalName,
  environment: BuildTrigger["environment"] = "production",
): BuildTrigger {
  return {
    branchExcludes: [],
    branchIncludes: ["main"],
    environment,
    id: `${workerTag}-${environment}`,
    name: environment,
    repositoryCanonicalName,
    rootDirectory: "/",
    workerTag,
  };
}

function createClient(
  workers: readonly WorkerRef[],
  triggers: ReadonlyMap<string, readonly BuildTrigger[]>,
): {
  readonly client: DiscoveryClient;
  readonly listTriggers: ReturnType<typeof vi.fn>;
  readonly listWorkers: ReturnType<typeof vi.fn>;
} {
  const listTriggers = vi.fn((_: string, workerTag: string) =>
    Promise.resolve([...(triggers.get(workerTag) ?? [])]),
  );
  const listWorkers = vi.fn(() => Promise.resolve([...workers]));
  return {
    client: { listTriggers, listWorkers },
    listTriggers,
    listWorkers,
  };
}

describe("DeploymentTargetDiscovery", () => {
  it("represents no matching deployment targets as an empty candidate list", async () => {
    const workers = [worker("api", "worker-api"), worker("web", "worker-web")];
    const { client, listTriggers, listWorkers } = createClient(
      workers,
      new Map([
        ["worker-api", [trigger("worker-api", "other/repository")]],
        ["worker-web", []],
      ]),
    );

    await expect(
      new DeploymentTargetDiscovery(client).discover(ACCOUNT_ID, REPOSITORY),
    ).resolves.toEqual([]);
    expect(listWorkers).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(listTriggers).toHaveBeenCalledTimes(2);
  });

  it("returns the unique Worker with its matching production and preview triggers", async () => {
    const api = worker("api", "worker-api");
    const production = trigger(api.tag);
    const preview = trigger(api.tag, REPOSITORY.canonicalName, "preview");
    const { client } = createClient(
      [api, worker("unrelated", "worker-unrelated")],
      new Map([
        [api.tag, [production, preview]],
        ["worker-unrelated", [trigger("worker-unrelated", "other/repository")]],
      ]),
    );

    await expect(
      new DeploymentTargetDiscovery(client).discover(ACCOUNT_ID, REPOSITORY),
    ).resolves.toEqual([{ triggers: [production, preview], worker: api }]);
  });

  it("returns multiple candidates and trigger lists in deterministic order", async () => {
    const alpha = worker("alpha", "worker-alpha");
    const zeta = worker("zeta", "worker-zeta");
    const alphaProduction = trigger(alpha.tag);
    const alphaPreview = trigger(alpha.tag, REPOSITORY.canonicalName, "preview");
    const zetaProduction = trigger(zeta.tag);
    const { client } = createClient(
      [zeta, alpha],
      new Map([
        [alpha.tag, [alphaPreview, alphaProduction]],
        [zeta.tag, [zetaProduction]],
      ]),
    );

    await expect(
      new DeploymentTargetDiscovery(client).discover(ACCOUNT_ID, REPOSITORY),
    ).resolves.toEqual([
      { triggers: [alphaProduction, alphaPreview], worker: alpha },
      { triggers: [zetaProduction], worker: zeta },
    ]);
  });

  it("rejects malformed client results without exposing their payload", async () => {
    const client: DiscoveryClient = {
      listTriggers: vi.fn(() => Promise.resolve([])),
      listWorkers: vi.fn(() =>
        Promise.resolve({ detail: "untrusted API payload" } as unknown as WorkerRef[]),
      ),
    };

    const discovery = new DeploymentTargetDiscovery(client).discover(
      ACCOUNT_ID,
      REPOSITORY,
    );

    await expect(discovery).rejects.toMatchObject({ kind: "invalidResponse" });
    await expect(discovery).rejects.not.toThrow("untrusted API payload");
  });

  it("rejects control characters from a custom client boundary", async () => {
    const { client } = createClient(
      [worker("unsafe\tworker", "worker-tag")],
      new Map(),
    );

    await expect(
      new DeploymentTargetDiscovery(client).discover(ACCOUNT_ID, REPOSITORY),
    ).rejects.toMatchObject({ kind: "invalidResponse" });
  });

  it("converts unexpected client failures to a safe domain error", async () => {
    const client: DiscoveryClient = {
      listTriggers: vi.fn(() => Promise.resolve([])),
      listWorkers: vi.fn(() => Promise.reject(new Error("untrusted API payload"))),
    };

    const discovery = new DeploymentTargetDiscovery(client).discover(
      ACCOUNT_ID,
      REPOSITORY,
    );

    await expect(discovery).rejects.toEqual(new CloudflareApiError("api"));
    await expect(discovery).rejects.not.toThrow("untrusted API payload");
  });

  it("limits concurrent trigger requests to four Workers", async () => {
    const workers = Array.from({ length: 9 }, (_, index) =>
      worker(`worker-${String(index)}`, `tag-${String(index)}`),
    );
    const pending: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const client: DiscoveryClient = {
      listTriggers: vi.fn(
        () =>
          new Promise<BuildTrigger[]>((resolve) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            pending.push(() => {
              active -= 1;
              resolve([]);
            });
          }),
      ),
      listWorkers: vi.fn(() => Promise.resolve(workers)),
    };

    const discovery = new DeploymentTargetDiscovery(client).discover(
      ACCOUNT_ID,
      REPOSITORY,
    );
    await flushAsyncWork();
    expect(active).toBe(4);

    while (pending.length > 0) {
      const release = pending.shift();
      if (release === undefined) {
        throw new Error("test synchronization failure");
      }
      release();
      await flushAsyncWork();
    }

    await expect(discovery).resolves.toEqual([]);
    expect(maximumActive).toBe(4);
  });
});

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
