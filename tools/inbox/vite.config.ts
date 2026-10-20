import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Inbox (37-inbox.md): built into dist/tools/inbox/ and served by `persimmon ui`
// at /tools/inbox/, over the same-origin /api.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/tools/inbox/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL("../../dist/tools/inbox", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:4747" },
  },
});
