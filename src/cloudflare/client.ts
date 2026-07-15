import { parseGitHubNameWithOwner } from "../git/repositoryIdentity.js";
import { CloudflareApiError } from "./apiError.js";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const ACCOUNTS_PER_PAGE = 50;
const MAX_ACCOUNT_PAGES = 20;
const MAX_TEXT_LENGTH = 255;
const MAX_ROOT_DIRECTORY_LENGTH = 1_024;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const TRIGGER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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
    this.#maxResponseBytes = validatePositiveInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    this.#timeoutMs = validatePositiveInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
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
      if (
        !Array.isArray(envelope.result) ||
        envelope.result.length > ACCOUNTS_PER_PAGE
      ) {
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
    const requestDeadline = Date.now() + this.#timeoutMs;
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

    const payload = await readBoundedJson(
      response,
      this.#maxResponseBytes,
      Math.max(0, requestDeadline - Date.now()),
    );
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

function validatePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
): number {
  const result = value ?? defaultValue;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) {
    throw new CloudflareApiError("invalidResponse");
  }
  return result;
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
    !isSafeText(value.name, MAX_TEXT_LENGTH)
  ) {
    throw new CloudflareApiError("invalidResponse");
  }
  return { id: value.id, name: value.name };
}

function parseWorker(value: unknown): WorkerRef {
  if (
    !isRecord(value) ||
    !isSafeText(value.id, MAX_TEXT_LENGTH) ||
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
    !TRIGGER_ID.test(value.trigger_uuid) ||
    !isSafeText(value.trigger_name, MAX_TEXT_LENGTH)
  ) {
    throw new CloudflareApiError("invalidResponse");
  }

  const identity = parseGitHubNameWithOwner(
    `${repository.provider_account_name}/${repository.repo_name}`,
  );
  if (identity === undefined) {
    throw new CloudflareApiError("invalidResponse");
  }

  const branchIncludes = parseStringArray(value.branch_includes);
  const branchExcludes = parseStringArray(value.branch_excludes);
  const deployCommand = value.deploy_command;
  if (
    deployCommand !== undefined &&
    !isSafeText(deployCommand, MAX_ROOT_DIRECTORY_LENGTH)
  ) {
    throw new CloudflareApiError("invalidResponse");
  }
  const preview =
    (branchIncludes.includes("*") && branchExcludes.length > 0) ||
    (typeof deployCommand === "string" &&
      /(?:^| )(?:npx )?wrangler(?:@[A-Za-z0-9._-]+)? versions upload(?: |$)/u.test(
        deployCommand,
      ));
  const rootDirectory = value.root_directory;
  if (
    rootDirectory !== undefined &&
    !isSafeText(rootDirectory, MAX_ROOT_DIRECTORY_LENGTH)
  ) {
    throw new CloudflareApiError("invalidResponse");
  }

  return {
    branchExcludes,
    branchIncludes,
    environment: preview ? "preview" : "production",
    id: value.trigger_uuid,
    name: value.trigger_name,
    repositoryCanonicalName: identity.canonicalName,
    rootDirectory: rootDirectory ?? "/",
    workerTag,
  };
}

function isSafeText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength &&
    !CONTROL_CHARACTER.test(value)
  );
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new CloudflareApiError("invalidResponse");
  }

  const strings: string[] = [];
  for (const item of value as unknown[]) {
    if (
      !isSafeText(item, MAX_TEXT_LENGTH)
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
  timeoutMs: number,
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

  try {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    const deadline = Date.now() + timeoutMs;

    try {
      for (;;) {
        const result = await readBeforeDeadline(reader, deadline);
        if (result.done) {
          break;
        }
        byteLength += result.value.byteLength;
        if (byteLength > maxBytes) {
          void reader.cancel().catch(() => {
            return undefined;
          });
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
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      ) as unknown;
    } catch {
      throw new CloudflareApiError("invalidResponse");
    }
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      throw error;
    }
    throw new CloudflareApiError("invalidResponse");
  }
}

async function readBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    void reader.cancel().catch(() => {
      return undefined;
    });
    throw new CloudflareApiError("invalidResponse");
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<ReadableStreamReadResult<Uint8Array>>(
      (resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new CloudflareApiError("invalidResponse"));
        }, remainingMs);
        void reader.read().then(resolve, reject);
      },
    );
  } catch (error) {
    void reader.cancel().catch(() => {
      return undefined;
    });
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
