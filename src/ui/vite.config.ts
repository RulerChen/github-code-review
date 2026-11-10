import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui",
  base: "/",
  plugins: [react()],
  worker: { format: "es" },
  build: {
    outDir: "../../plugins/diff-review/dist/ui",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1000,
  },
});
