import type { CloudflareAccount } from "../cloudflare/client.js";
import type { WorkspaceDeploymentTarget } from "../connection/deploymentTargetStore.js";
import { parseGitHubNameWithOwner } from "../git/repositoryIdentity.js";

const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const MAX_DISPLAY_TEXT_LENGTH = 80;
const TRIGGER_ENVIRONMENTS: readonly TriggerTreeNode["environment"][] = [
  "production",
  "preview",
];
const ACCOUNT_NODE_ID = "cloudflareBuilds.connectedTarget.account";
const REPOSITORY_NODE_ID = "cloudflareBuilds.connectedTarget.repository";
const WORKER_NODE_ID = "cloudflareBuilds.connectedTarget.worker";

interface ConnectedTargetTreeNodeBase {
  readonly children: readonly ConnectedTargetTreeNode[];
  readonly id: string;
  readonly label: string;
  readonly tooltip: string;
}

export interface AccountTreeNode extends ConnectedTargetTreeNodeBase {
  readonly kind: "account";
}

export interface RepositoryTreeNode extends ConnectedTargetTreeNodeBase {
  readonly kind: "repository";
}

export interface WorkerTreeNode extends ConnectedTargetTreeNodeBase {
  readonly kind: "worker";
}

export interface TriggerTreeNode extends ConnectedTargetTreeNodeBase {
  readonly environment: "preview" | "production";
  readonly kind: "trigger";
}

export type ConnectedTargetTreeNode =
  | AccountTreeNode
  | RepositoryTreeNode
  | TriggerTreeNode
  | WorkerTreeNode;

/** A VS Code-independent projection of the current account and selected target. */
export type ConnectedTargetViewModel = AccountTreeNode;

/**
 * Creates a small, immutable tree projection. Invalid or mismatched target data
 * is intentionally represented as an account-only connection.
 */
export function createConnectedTargetViewModel(
  account: CloudflareAccount | undefined,
  target: WorkspaceDeploymentTarget | undefined,
): ConnectedTargetViewModel | undefined {
  const accountData = toAccountData(account);
  if (accountData === undefined) {
    return undefined;
  }

  const repository = toRepositoryNode(accountData.id, target);
  return Object.freeze({
    children: Object.freeze(repository === undefined ? [] : [repository]),
    id: ACCOUNT_NODE_ID,
    kind: "account",
    label: sanitizeDisplayText(accountData.name, "Connected account"),
    tooltip: `Connected Cloudflare account: ${sanitizeDisplayText(
      accountData.name,
      "Connected account",
    )}`,
  });
}

function toAccountData(
  account: CloudflareAccount | undefined,
): { readonly id: string; readonly name: string } | undefined {
  if (
    !isRecord(account) ||
    !isSafeIdentifier(account.id) ||
    typeof account.name !== "string"
  ) {
    return undefined;
  }
  return { id: account.id, name: account.name };
}

function toRepositoryNode(
  accountId: string,
  target: WorkspaceDeploymentTarget | undefined,
): RepositoryTreeNode | undefined {
  if (!isRecord(target) || target.accountId !== accountId) {
    return undefined;
  }

  const repository = toCanonicalRepository(target.repositoryCanonicalName);
  const worker = toWorkerNode(target.worker, target.triggers);
  if (repository === undefined || worker === undefined) {
    return undefined;
  }

  return Object.freeze({
    children: Object.freeze([worker]),
    id: REPOSITORY_NODE_ID,
    kind: "repository",
    label: repository,
    tooltip: `GitHub repository: ${repository}`,
  });
}

function toCanonicalRepository(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const repository = parseGitHubNameWithOwner(value);
  return repository?.canonicalName === value ? repository.canonicalName : undefined;
}

function toWorkerNode(
  workerValue: unknown,
  triggerValues: unknown,
): WorkerTreeNode | undefined {
  if (
    !isRecord(workerValue) ||
    typeof workerValue.name !== "string" ||
    !isSafeIdentifier(workerValue.tag) ||
    !Array.isArray(triggerValues)
  ) {
    return undefined;
  }

  const triggers = toTriggerNodes(triggerValues);
  if (triggers === undefined) {
    return undefined;
  }

  const workerName = sanitizeDisplayText(workerValue.name, "Unnamed Worker");
  return Object.freeze({
    children: Object.freeze(triggers),
    id: WORKER_NODE_ID,
    kind: "worker",
    label: workerName,
    tooltip: `Cloudflare Worker: ${workerName}`,
  });
}

function toTriggerNodes(values: readonly unknown[]): TriggerTreeNode[] | undefined {
  if (values.length === 0 || values.length > 2) {
    return undefined;
  }

  const triggers = new Map<TriggerTreeNode["environment"], TriggerTreeNode>();
  for (const value of values) {
    const trigger = toTriggerNode(value);
    if (trigger === undefined || triggers.has(trigger.environment)) {
      return undefined;
    }
    triggers.set(trigger.environment, trigger);
  }

  return TRIGGER_ENVIRONMENTS.flatMap(
    (environment: TriggerTreeNode["environment"]): TriggerTreeNode[] => {
      const trigger = triggers.get(environment);
      return trigger === undefined ? [] : [trigger];
    },
  );
}

function toTriggerNode(value: unknown): TriggerTreeNode | undefined {
  if (
    !isRecord(value) ||
    !isSafeIdentifier(value.id) ||
    typeof value.name !== "string" ||
    (value.environment !== "production" && value.environment !== "preview")
  ) {
    return undefined;
  }

  const environment = value.environment;
  const environmentLabel = environment === "production" ? "Production" : "Preview";
  const triggerName = sanitizeDisplayText(value.name, "Unnamed trigger");
  return Object.freeze({
    children: Object.freeze([]),
    environment,
    id: `cloudflareBuilds.connectedTarget.trigger.${environment}`,
    kind: "trigger",
    label: `${environmentLabel}: ${triggerName}`,
    tooltip: `${environmentLabel} build trigger: ${triggerName}`,
  });
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !CONTROL_CHARACTER.test(value)
  );
}

function sanitizeDisplayText(value: string, fallback: string): string {
  const sanitized = value.replace(CONTROL_CHARACTERS, "").trim();
  const displayText = sanitized.length === 0 ? fallback : sanitized;
  const characters = Array.from(displayText);
  return characters.length > MAX_DISPLAY_TEXT_LENGTH
    ? `${characters.slice(0, MAX_DISPLAY_TEXT_LENGTH - 1).join("")}…`
    : displayText;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
