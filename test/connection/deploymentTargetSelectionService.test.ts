import { describe, expect, it, vi } from "vitest";
import { CloudflareApiError } from "../../src/cloudflare/apiError.js";
import type {
  BuildTrigger,
  CloudflareAccount,
  WorkerRef,
} from "../../src/cloudflare/client.js";
import type { DeploymentTargetCandidate } from "../../src/discovery/deploymentTargetDiscovery.js";
import type { GitHubRepositoryIdentity } from "../../src/git/repositoryIdentity.js";
import {
  DeploymentTargetSelectionService,
  type DeploymentTargetDiscoveryPort,
  type DeploymentTargetSelectionPromptPort,
  type DeploymentTargetStorePort,
  type RepositoryIdentityResolverPort,
} from "../../src/connection/deploymentTargetSelectionService.js";

const ACCOUNT: CloudflareAccount = {
  id: "0123456789abcdef0123456789abcdef",
  name: "Example account",
};
const REPOSITORY: GitHubRepositoryIdentity = {
  canonicalName: "cloudflare/workers-sdk",
  name: "workers-sdk",
  owner: "Cloudflare",
  provider: "github",
};

function candidate(
  workerTag: string,
  environment: BuildTrigger["environment"] = "production",
): DeploymentTargetCandidate {
  const worker: WorkerRef = { name: `worker-${workerTag}`, tag: workerTag };
  return {
    triggers: [
      {
        branchExcludes: [],
        branchIncludes: ["main"],
        environment,
        id: `${workerTag}-${environment}`,
        name: `${environment} trigger`,
        repositoryCanonicalName: REPOSITORY.canonicalName,
        rootDirectory: "/app",
        workerTag,
      },
    ],
    worker,
  };
}

function createHarness(
  candidates: readonly DeploymentTargetCandidate[] = [],
): {
  readonly discover: ReturnType<typeof vi.fn>;
  readonly pick: ReturnType<typeof vi.fn>;
  readonly resolve: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
  readonly service: DeploymentTargetSelectionService;
} {
  const resolve = vi.fn(() => Promise.resolve(REPOSITORY));
  const discover = vi.fn(() => Promise.resolve(candidates));
  const pick = vi.fn(() => Promise.resolve<DeploymentTargetCandidate | undefined>(undefined));
  const save = vi.fn(() => Promise.resolve());
  const resolver: RepositoryIdentityResolverPort = { resolve };
  const discovery: DeploymentTargetDiscoveryPort = { discover };
  const prompts: DeploymentTargetSelectionPromptPort = { pickDeploymentTarget: pick };
  const store: DeploymentTargetStorePort = { save };

  return {
    discover,
    pick,
    resolve,
    save,
    service: new DeploymentTargetSelectionService({
      account: ACCOUNT,
      discovery,
      prompts,
      repositoryResolver: resolver,
      store,
    }),
  };
}

describe("DeploymentTargetSelectionService", () => {
  it("auto-selects and persists a unique deployment target", async () => {
    const onlyCandidate = candidate("worker-api");
    const { discover, pick, save, service } = createHarness([onlyCandidate]);

    await expect(service.select()).resolves.toEqual({
      kind: "selected",
      target: {
        accountId: ACCOUNT.id,
        repositoryCanonicalName: REPOSITORY.canonicalName,
        triggers: [
          {
            environment: "production",
            id: "worker-api-production",
            name: "production trigger",
          },
        ],
        worker: { name: "worker-worker-api", tag: "worker-api" },
      },
    });
    expect(discover).toHaveBeenCalledWith(ACCOUNT.id, REPOSITORY);
    expect(pick).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("uses the prompt result when several targets match", async () => {
    const first = candidate("worker-first");
    const second = candidate("worker-second", "preview");
    const { pick, save, service } = createHarness([first, second]);
    pick.mockResolvedValue(second);

    await expect(service.select()).resolves.toMatchObject({
      kind: "selected",
      target: { worker: second.worker },
    });
    expect(pick).toHaveBeenCalledWith([first, second]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ worker: second.worker }));
  });

  it("represents no matching targets without prompting or persisting", async () => {
    const { pick, save, service } = createHarness();

    await expect(service.select()).resolves.toEqual({ kind: "notFound" });
    expect(pick).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("represents prompt cancellation without persisting a target", async () => {
    const { pick, save, service } = createHarness([
      candidate("worker-first"),
      candidate("worker-second"),
    ]);

    await expect(service.select()).resolves.toEqual({ kind: "cancelled" });
    expect(pick).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
  });

  it("persists account and canonical repository fields while stripping trigger secrets", async () => {
    const base = candidate("worker-api");
    const trigger = base.triggers[0];
    if (trigger === undefined) {
      throw new Error("test fixture has no trigger");
    }
    const runtimeTrigger: BuildTrigger & {
      readonly buildToken: string;
      readonly environmentValues: { readonly API_KEY: string };
    } = {
      ...trigger,
      buildToken: "must-not-persist",
      environmentValues: { API_KEY: "must-not-persist" },
    };
    const runtimeWorker: WorkerRef & { readonly token: string } = {
      ...base.worker,
      token: "must-not-persist",
    };
    const selected: DeploymentTargetCandidate = {
      triggers: [runtimeTrigger],
      worker: runtimeWorker,
    };
    const { save, service } = createHarness([selected]);
    const persisted = {
      accountId: ACCOUNT.id,
      repositoryCanonicalName: REPOSITORY.canonicalName,
      triggers: [
        {
          environment: "production",
          id: "worker-api-production",
          name: "production trigger",
        },
      ],
      worker: { name: "worker-worker-api", tag: "worker-api" },
    };

    await service.select();

    expect(save).toHaveBeenCalledWith(persisted);
    expect(JSON.stringify(save.mock.calls)).not.toContain("must-not-persist");
  });

  it("converts resolver failures to a fixed category without disclosing their text", async () => {
    const { resolve, service } = createHarness([candidate("worker-api")]);
    resolve.mockRejectedValue(new Error("repository origin includes a private URL"));

    const outcome = await service.select();

    expect(outcome).toEqual({ failure: "repository", kind: "failed" });
    expect(JSON.stringify(outcome)).not.toContain("private URL");
  });

  it("preserves safe discovery error categories", async () => {
    const { discover, service } = createHarness();
    discover.mockRejectedValue(
      new CloudflareApiError("rateLimit", { retryAfterSeconds: 30 }),
    );

    await expect(service.select()).resolves.toEqual({
      failure: "rateLimit",
      kind: "failed",
    });
  });
});
