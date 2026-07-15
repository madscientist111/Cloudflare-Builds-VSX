import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: resolve(root, "dist/test/suite/index.js"),
    launchArgs: ["--disable-extensions"],
  });
} catch (error) {
  console.error("Extension-host tests failed", error);
  process.exitCode = 1;
}
