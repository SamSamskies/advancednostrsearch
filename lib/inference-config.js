/** Backend-owned provider/model configuration for the shared service. */
export const SHARED_DEFAULT_MODELS = {
  replit: "google/gemma-4-26b-a4b-it",
  ollama: "gemma4:cloud",
  gemini: "gemma-4-31b-it",
};

export function sharedProviderId() {
  return process.env.SHARED_INFERENCE_PROVIDER?.trim().toLowerCase() || "replit";
}

export function sharedModelId() {
  const provider = sharedProviderId();
  if (provider === "replit") {
    return process.env.REPLIT_INFERENCE_MODEL?.trim() || SHARED_DEFAULT_MODELS.replit;
  }
  return process.env[provider === "ollama" ? "OLLAMA_MODEL" : "GEMINI_MODEL"]?.trim() ||
    SHARED_DEFAULT_MODELS[provider];
}

export function fallbackDisabled() {
  const flag = process.env.INFERENCE_FALLBACK_ENABLED?.trim().toLowerCase() || "";
  return ["0", "false", "off"].includes(flag);
}
