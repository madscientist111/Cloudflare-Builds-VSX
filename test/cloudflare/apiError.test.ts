import { describe, expect, it } from "vitest";
import { CloudflareApiError } from "../../src/cloudflare/apiError.js";

const SENSITIVE_API_MESSAGE = "Request failed for secret-token-value";

describe("CloudflareApiError", () => {
  it("exposes only a fixed authentication message", () => {
    const error = new CloudflareApiError("authentication", { apiCode: 1000 });

    expect(error.message).toBe("Cloudflare rejected the API token.");
    expect(error.message).not.toContain(SENSITIVE_API_MESSAGE);
    expect(error.apiCode).toBe(1000);
  });

  it("retains safe rate-limit metadata", () => {
    const error = new CloudflareApiError("rateLimit", {
      retryAfterSeconds: 30,
    });

    expect(error.message).toBe("Cloudflare rate-limited the request.");
    expect(error.retryAfterSeconds).toBe(30);
  });
});
