import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/security/redact.js";

describe("redactSecrets", () => {
  it("removes every occurrence of each known secret", () => {
    expect(redactSecrets("token=abc123; repeated=abc123", ["abc123"]))
      .toBe("token=[REDACTED]; repeated=[REDACTED]");
  });

  it("redacts bearer credentials without knowing the token", () => {
    expect(redactSecrets("Authorization: Bearer opaque-token.value"))
      .toBe("Authorization: Bearer [REDACTED]");
  });

  it("handles overlapping and duplicate secrets deterministically", () => {
    expect(redactSecrets("long-secret", ["secret", "long-secret", "secret"]))
      .toBe("[REDACTED]");
  });

  it("does not alter text when there is nothing sensitive", () => {
    expect(redactSecrets("Cloudflare request failed", [])).toBe(
      "Cloudflare request failed",
    );
  });
});
