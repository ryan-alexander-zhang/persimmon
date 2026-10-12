import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The event storming editor (25-ui.md): built into dist/tools/eventstorming/ and
// served by `persimmon ui` at /tools/eventstorming/, over the same-origin /api.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/tools/eventstorming/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL("../../dist/tools/eventstorming", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:4747" },
  },
});
