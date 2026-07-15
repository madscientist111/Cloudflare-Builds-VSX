import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  platform: "node",
  sourcemap: !production,
  target: "node20",
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    minify: production,
    outfile: "dist/extension.js",
  }),
  esbuild.context({
    ...common,
    entryPoints: ["src/test/suite/index.ts"],
    outfile: "dist/test/suite/index.js",
  }),
]);

if (watch) {
  await Promise.all(contexts.map(async (context) => context.watch()));
} else {
  await Promise.all(contexts.map(async (context) => context.rebuild()));
  await Promise.all(contexts.map(async (context) => context.dispose()));
}
