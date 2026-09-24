import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // Electron profiles contain locked databases; generated artifacts are not source.
  server: {
    watch: {
      ignored: [
        "**/release/**",
        "**/build/**",
        "**/tmp/**",
        "**/.scrollweave/**",
      ],
    },
  },
  build: { outDir: "dist/client", chunkSizeWarningLimit: 900 },
});
