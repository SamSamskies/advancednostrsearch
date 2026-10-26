import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { inferenceDevPlugin } from "./lib/inference-dev.js";
import { previewDevPlugin } from "./lib/preview-dev.js";

export default defineConfig({
  plugins: [react(), inferenceDevPlugin(), previewDevPlugin()],
  build: {
    outDir: "build",
  },
});
