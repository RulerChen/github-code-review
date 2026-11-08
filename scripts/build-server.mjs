import { build } from "esbuild";

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "plugins/diff-review/dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "none",
  // Some bundled dependencies are CommonJS and call require() on Node builtins.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
