import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ExtensionManifest {
  readonly activationEvents?: string[];
  readonly contributes?: {
    readonly commands?: ReadonlyArray<{ readonly command: string }>;
    readonly viewsWelcome?: ReadonlyArray<{
      readonly contents: string;
      readonly view: string;
    }>;
  };
  readonly enabledApiProposals?: string[];
  readonly main?: string;
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as ExtensionManifest;

describe("extension manifest", () => {
  it("uses only stable extension APIs", () => {
    expect(manifest.enabledApiProposals).toBeUndefined();
    expect(manifest.main).toBe("./dist/extension.js");
  });

  it("activates for the contributed connect command", () => {
    const commandIds = manifest.contributes?.commands?.map(({ command }) => command);

    expect(commandIds).toContain("cloudflareBuilds.connect");
    expect(manifest.activationEvents).toContain(
      "onCommand:cloudflareBuilds.connect",
    );
  });

  it("contributes an actionable unconfigured welcome view", () => {
    expect(manifest.contributes?.viewsWelcome).toContainEqual({
      contents:
        "Monitor the Cloudflare Workers Builds for this workspace.\n[Connect Cloudflare](command:cloudflareBuilds.connect)",
      view: "cloudflareBuilds.view",
    });
  });
});
