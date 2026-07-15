export type CloudflareErrorKind =
  | "authentication"
  | "permission"
  | "rateLimit"
  | "network"
  | "invalidResponse"
  | "api";

interface CloudflareApiErrorOptions {
  readonly apiCode?: number;
  readonly retryAfterSeconds?: number;
}

const SAFE_MESSAGES: Readonly<Record<CloudflareErrorKind, string>> = {
  api: "Cloudflare could not complete the request.",
  authentication: "Cloudflare rejected the API token.",
  invalidResponse: "Cloudflare returned an invalid response.",
  network: "Cloudflare could not be reached.",
  permission: "The Cloudflare API token is missing required permissions.",
  rateLimit: "Cloudflare rate-limited the request.",
};

export class CloudflareApiError extends Error {
  public readonly apiCode: number | undefined;
  public readonly kind: CloudflareErrorKind;
  public readonly retryAfterSeconds: number | undefined;

  public constructor(
    kind: CloudflareErrorKind,
    options: CloudflareApiErrorOptions = {},
  ) {
    super(SAFE_MESSAGES[kind]);
    this.name = "CloudflareApiError";
    this.kind = kind;
    this.apiCode = options.apiCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
