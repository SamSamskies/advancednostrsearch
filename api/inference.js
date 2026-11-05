/** Same-origin hosted fallback through the authenticated shared service. */
import sharedInference from "../lib/shared-inference.js";
import { loadLocalEnvFallback } from "../lib/env.js";

loadLocalEnvFallback([
  "INFERENCE_FALLBACK_ENABLED",
  "SHARED_INFERENCE_URL", "SHARED_INFERENCE_PROVIDER", "SHARED_INFERENCE_APP_SECRET",
  "SHARED_INFERENCE_REPLIT_API_KEY", "SHARED_INFERENCE_OLLAMA_API_KEY", "SHARED_INFERENCE_GEMINI_API_KEY",
  "REPLIT_INFERENCE_MODEL", "OLLAMA_MODEL", "GEMINI_MODEL", "SHARED_INFERENCE_GEMINI_SEARCH_ENABLED",
]);

export default sharedInference;
