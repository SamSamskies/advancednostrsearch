/** Same-origin hosted fallback with an independent server-side rollback switch. */
import directInference from "../lib/direct-inference.js";
import sharedInference from "../lib/shared-inference.js";
import { loadLocalEnvFallback } from "../lib/env.js";

// Preserve the direct route's image-fetch test seam during the observation period.
export { imageFetchDns } from "../lib/direct-inference.js";

loadLocalEnvFallback(["INFERENCE_", "GEMINI_", "OLLAMA_", "REPLIT_", "SHARED_INFERENCE_"]);

export default function handler(req, res) {
  const flag = process.env.SHARED_INFERENCE_ENABLED?.trim().toLowerCase();
  return ["1", "true", "on"].includes(flag)
    ? sharedInference(req, res)
    : directInference(req, res);
}
