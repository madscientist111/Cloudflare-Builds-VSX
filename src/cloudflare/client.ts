import { parseGitHubNameWithOwner } from "../git/repositoryIdentity.js";
import { CloudflareApiError } from "./apiError.js";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const ACCOUNTS_PER_PAGE = 50;
const MAX_ACCOUNT_PAGES = 20;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

interface ClientOptions {
  readonly fetcher?: Fetcher;
  readonly maxResponseBytes?: number;
  readonly timeoutMs?: number;
}

interface ApiEnvelope {
  readonly errors?: unknown;
  readonly result?: unknown;
  readonly result_info?: unknown;
  readonly success?: unknown;
}

export interface CloudflareAccount {
  readonly id: string;
  readonly name: string;
}

export interface TokenVerification {
  readonly expiresOn?: string;
  readonly id: string;
  readonly status: "active" | "disabled" | "expired";
}

export interface WorkerRef {
  readonly name: string;
  readonly tag: string;
}

export interface BuildTrigger {
  readonly branchExcludes: readonly string[];
  readonly branchIncludes: readonly string[];
  readonly environment: "preview" | "production";
  readonly id: string;
  readonly name: string;
  readonly repositoryCanonicalName: string;
  readonly rootDirectory: string;
  readonly workerTag: string;
}

export class CloudflareClient {
  readonly #fetcher: Fetcher;
  readonly #maxResponseBytes: number;
  readonly #timeoutMs: number;
  readonly #token: string;

  public constructor(token: string, options: ClientOptions = {}) {
    if (token.trim().length === 0) {
      throw new CloudflareApiError("authentication");
    }

    this.#token = token;
    this.#fetcher = options.fetcher ?? globalThis.fetch;
    this.#maxResponseBytes =
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async verifyToken(): Promise<TokenVerification> {
    const result = await this.#request("/user/tokens/verify");
    if (!isRecord(result) || typeof result.id !== "string") {
      throw new CloudflareApiError("invalidResponse");
    }

    const { status } = result;
    if (status !== "active" && status !== "disabled" && status !== "expired") {
      throw new CloudflareApiError("invalidResponse");
    }
    if (status !== "active") {
      throw new CloudflareApiError("authentication");
    }

    const expiresOn =
      typeof result.expires_on === "string" ? result.expires_on : undefined;
    return { id: result.id, status, ...(expiresOn === undefined ? {} : { expiresOn }) };
  }

  public async listAccounts(): Promise<CloudflareAccount[]> {
    const accounts = new Map<string, CloudflareAccount>();

    for (let page = 1; page <= MAX_ACCOUNT_PAGES; page += 1) {
      const envelope = await this.#requestEnvelope(
        `/accounts?page=${String(page)}&per_page=${String(ACCOUNTS_PER_PAGE)}&direction=asc`,
      );
      if (!Array.isArray(envelope.result)) {
        throw new CloudflareApiError("invalidResponse");
      }

      const pageAccounts = envelope.result.map(parseAccount);
      for (const account of pageAccounts) {
        accounts.set(account.id, account);
      }

      const totalCount = parseTotalCount(envelope.result_info);
      if (
        pageAccounts.length < ACCOUNTS_PER_PAGE ||
        (totalCount !== undefined && accounts.size >= totalCount)
      ) {
        return [...accounts.values()];
      }
    }

    throw new CloudflareApiError("invalidResponse");
  }

  public async checkAccountAccess(accountId: string): Promise<void> {
    assertAccountId(accountId);
    await this.#request(`/accounts/${accountId}/workers/scripts`);
    await this.#request(`/accounts/${accountId}/builds/account/limits`);
  }

  public async listWorkers(accountId: string): Promise<WorkerRef[]> {
    assertAccountId(accountId);
    const result = await this.#request(`/accounts/${accountId}/workers/scripts`);
    if (!Array.isArray(result)) {
      throw new CloudflareApiError("invalidResponse");
    }
    return result.map(parseWorker);
  }

  public async listTriggers(
    accountId: string,
    workerTag: string,
  ): Promise<BuildTrigger[]> {
    assertAccountId(accountId);
    assertSafeIdentifier(workerTag);
    const result = await this.#request(
      `/accounts/${accountId}/builds/workers/${workerTag}/triggers`,
    );
    if (!Array.isArray(result) || result.length > 2) {
      throw new CloudflareApiError("invalidResponse");
    }
    return result.map((value) => parseTrigger(value, workerTag));
  }

  async #request(path: string): Promise<unknown> {
    const envelope = await this.#requestEnvelope(path);
    if (!("result" in envelope)) {
      throw new CloudflareApiError("invalidResponse");
    }
    return envelope.result;
  }

  async #requestEnvelope(path: string): Promise<ApiEnvelope> {
    let response: Response;
    try {
      response = await this.#fetcher(`${API_ROOT}${path}`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.#token}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new CloudflareApiError("network");
    }

    if (!response.ok) {
      throw errorForStatus(response);
    }

    const payload = await readBoundedJson(response, this.#maxResponseBytes);
    if (!isRecord(payload)) {
      throw new CloudflareApiError("invalidResponse");
    }

    const envelope: ApiEnvelope = payload;
    if (envelope.success !== true) {
      throw new CloudflareApiError("api", {
        apiCode: firstApiCode(envelope.errors),
      });
    }

    return envelope;
  }
}

function assertAccountId(accountId: string): void {
  if (!ACCOUNT_ID.test(accountId)) {
    throw new CloudflareApiError("invalidResponse");
  }
}

function assertSafeIdentifier(value: string): void {
  if (!ACCOUNT_ID.test(value)) {
    throw new CloudflareApiError("invalidResponse");
  }
}

function errorForStatus(response: Response): CloudflareApiError {
  if (response.status === 401) {
    return new CloudflareApiError("authentication");
  }
  if (response.status === 403) {
    return new CloudflareApiError("permission");
  }
  if (response.status === 429) {
    return new CloudflareApiError("rateLimit", {
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  return new CloudflareApiError("api");
}

function firstApiCode(errors: unknown): number | undefined {
  if (!Array.isArray(errors) || !isRecord(errors[0])) {
    return undefined;
  }
  return typeof errors[0].code === "number" ? errors[0].code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAccount(value: unknown): CloudflareAccount {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !ACCOUNT_ID.test(value.id) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0
  ) {
    throw new CloudflareApiError("invalidResponse");
  }
  return { id: value.id, name: value.name };
}

function parseWorker(value: unknown): WorkerRef {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    value.id.length > 255 ||
    typeof value.tag !== "string"
  ) {
    throw new CloudflareApiError("invalidResponse");
  }
  assertSafeIdentifier(value.tag);
  return { name: value.id, tag: value.tag };
}

function parseTrigger(value: unknown, workerTag: string): BuildTrigger {
  if (!isRecord(value) || !isRecord(value.repo_connection)) {
    throw new CloudflareApiError("invalidResponse");
  }
  const repository = value.repo_connection;
  if (
    repository.provider_type !== "github" ||
    typeof repository.provider_account_name !== "string" ||
    typeof repository.repo_name !== "string" ||
    typeof value.trigger_uuid !== "string" ||
    typeof value.trigger_name !== "string"
  ) {
    throw new CloudflareApiError("invalidResponse");
  }
  assertSafeIdentifier(value.trigger_uuid);

  const identity = parseGitHubNameWithOwner(
    `${repository.provider_account_name}/${repository.repo_name}`,
  );
  if (identity === undefined) {
    throw new CloudflareApiError("invalidResponse");
  }

  const branchIncludes = parseStringArray(value.branch_includes);
  const branchExcludes = parseStringArray(value.branch_excludes);
  const preview =
    (branchIncludes.includes("*") && branchExcludes.length > 0) ||
    (typeof value.deploy_command === "string" &&
      value.deploy_command.includes("versions upload"));

  return {
    branchExcludes,
    branchIncludes,
    environment: preview ? "preview" : "production",
    id: value.trigger_uuid,
    name: value.trigger_name,
    repositoryCanonicalName: identity.canonicalName,
    rootDirectory:
      typeof value.root_directory === "string" ? value.root_directory : "/",
    workerTag,
  };
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new CloudflareApiError("invalidResponse");
  }

  const strings: string[] = [];
  for (const item of value as unknown[]) {
    if (
      typeof item !== "string" ||
      item.length > 255 ||
      item.includes("\0") ||
      item.includes("\n") ||
      item.includes("\r")
    ) {
      throw new CloudflareApiError("invalidResponse");
    }
    strings.push(item);
  }
  return strings;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\d{1,4}$/u.test(value)) {
    return undefined;
  }
  const seconds = Number(value);
  return seconds > 0 && seconds <= 3600 ? seconds : undefined;
}

function parseTotalCount(resultInfo: unknown): number | undefined {
  if (!isRecord(resultInfo) || typeof resultInfo.total_count !== "number") {
    return undefined;
  }
  return Number.isSafeInteger(resultInfo.total_count) && resultInfo.total_count >= 0
    ? resultInfo.total_count
    : undefined;
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    /^\d+$/u.test(contentLength) &&
    Number(contentLength) > maxBytes
  ) {
    throw new CloudflareApiError("invalidResponse");
  }
  if (response.body === null) {
    throw new CloudflareApiError("invalidResponse");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      byteLength += result.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new CloudflareApiError("invalidResponse");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new CloudflareApiError("invalidResponse");
  }
}
