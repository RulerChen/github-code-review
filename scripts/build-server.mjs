import { build } from "esbuild";

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "plugins/diff-review/dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "none",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "info",
});
