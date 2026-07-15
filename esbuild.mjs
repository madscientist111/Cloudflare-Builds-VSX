import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "dist/extension.js",
  platform: "node",
  sourcemap: !production,
  target: "node20",
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
