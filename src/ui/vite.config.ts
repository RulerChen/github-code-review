import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Paths are relative to the repository root, where `npm run build:ui` runs.
export default defineConfig({
  root: "src/ui",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../../plugins/diff-review/dist/ui",
    emptyOutDir: true,
    target: "es2022",
    // Language grammars are lazy chunks; the C++ one alone is ~800 kB and only loads for C/C++ files.
    chunkSizeWarningLimit: 1000,
  },
});
