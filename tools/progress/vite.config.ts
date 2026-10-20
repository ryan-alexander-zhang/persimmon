import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Progress (37-progress.md): built into dist/tools/progress/ and served by `persimmon ui`
// at /tools/progress/, over the same-origin /api.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/tools/progress/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../../dist/tools/progress", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:4747" },
  },
});
