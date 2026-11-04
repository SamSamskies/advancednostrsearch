/** Backend-owned defaults shared by the proxy and retained direct route. */
export const DEFAULT_MODELS = { ollama: "gemma4:cloud", gemini: "gemma-4-31b-it" };
export const SHARED_DEFAULT_MODELS = { ...DEFAULT_MODELS, replit: "google/gemma-4-26b-a4b-it" };

export function providerId() {
  return process.env.INFERENCE_PROVIDER?.trim().toLowerCase() || "ollama";
}

export function modelId() {
  const provider = providerId();
  return process.env[provider === "ollama" ? "OLLAMA_MODEL" : "GEMINI_MODEL"]?.trim() ||
    (process.env.INFERENCE_PROVIDER?.trim() ? process.env.INFERENCE_MODEL?.trim() : "") ||
    DEFAULT_MODELS[provider];
}

export function sharedProviderId() {
  return process.env.SHARED_INFERENCE_PROVIDER?.trim().toLowerCase() || providerId();
}

export function sharedModelId() {
  const provider = sharedProviderId();
  // Replit exists only on the shared route and has no legacy model override.
  if (provider === "replit") {
    return process.env.REPLIT_INFERENCE_MODEL?.trim() || SHARED_DEFAULT_MODELS.replit;
  }
  if (provider === providerId()) return modelId();
  return process.env[provider === "ollama" ? "OLLAMA_MODEL" : "GEMINI_MODEL"]?.trim() ||
    SHARED_DEFAULT_MODELS[provider];
}

export function fallbackDisabled(provider = providerId()) {
  const flag = (
    process.env.INFERENCE_FALLBACK_ENABLED ??
    (provider === "gemini" ? process.env.GEMINI_FALLBACK_ENABLED : undefined) ??
    ""
  ).trim().toLowerCase();
  return ["0", "false", "off"].includes(flag);
}
