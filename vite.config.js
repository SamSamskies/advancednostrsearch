import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { inferenceDevPlugin } from "./lib/inference-dev.js";

export default defineConfig({
  plugins: [react(), inferenceDevPlugin()],
  build: {
    outDir: "build",
  },
});
