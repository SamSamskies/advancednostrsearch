import {
  makeInferenceError,
  type InferenceBackend,
  type InferenceFeatures,
  type InferenceRequest,
} from "ipa-tools";
import { isWebSearchEnabled } from "./settings.ts";

export const HOSTED_BACKEND_ID = "hosted";
export const INFERENCE_ENDPOINT = "/api/inference";
export const INFERENCE_CLIENT_HEADER = "X-Inference-Client";

const CONSENT_KEY = "advancednostrsearch.inferenceConsent";
const CLIENT_TOKEN_KEY = "advancednostrsearch.inferenceClient";
const SOFT_COUNT_KEY = "advancednostrsearch.inferenceSoftCount";

/** Align with server default in api/inference.js. */
const CLIENT_SOFT_DAILY = 50;

const HOSTED_FEATURES: InferenceFeatures = {
  toolCalling: false,
  webSearch: true,
  imageInput: true,
  options: { reasoningEffort: true, temperature: true },
};

export function hasHostedConsent(): boolean {
  try {
    return sessionStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHostedConsent(ok: boolean): void {
  try {
    if (ok) sessionStorage.setItem(CONSENT_KEY, "1");
    else sessionStorage.removeItem(CONSENT_KEY);
  } catch {
    // ignore quota / private mode
  }
}

export function getOrCreateClientToken(): string {
  try {
    const existing = localStorage.getItem(CLIENT_TOKEN_KEY);
    if (existing) return existing;
    const token = crypto.randomUUID();
    localStorage.setItem(CLIENT_TOKEN_KEY, token);
    return token;
  } catch {
    return crypto.randomUUID();
  }
}

function softClientCount(): number {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const raw = localStorage.getItem(SOFT_COUNT_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day: string; count: number };
    if (!parsed || parsed.day !== day) return 0;
    return typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function softClientAllowed(): boolean {
  return softClientCount() < CLIENT_SOFT_DAILY;
}

function bumpSoftClientCount(): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const count = softClientCount() + 1;
    localStorage.setItem(SOFT_COUNT_KEY, JSON.stringify({ day, count }));
  } catch {
    // ignore
  }
}

export function createHostedBackend(): InferenceBackend {
  return {
    id: HOSTED_BACKEND_ID,
    getFeatures() {
      return HOSTED_FEATURES;
    },
    async probe() {
      try {
        const res = await fetch(INFERENCE_ENDPOINT, { method: "GET" });
        if (res.ok) return "available";
        return "unavailable";
      } catch {
        return "unavailable";
      }
    },
    async create() {
      return {
        getFeatures() {
          return HOSTED_FEATURES;
        },
        async *request(req: InferenceRequest) {
          if (!hasHostedConsent()) {
            throw makeInferenceError(
              "permission_denied",
              "Hosted inference consent required",
            );
          }
          if (!softClientAllowed()) {
            throw makeInferenceError("unavailable", "client_limit");
          }

          const res = await fetch(INFERENCE_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              [INFERENCE_CLIENT_HEADER]: getOrCreateClientToken(),
            },
            body: JSON.stringify({
              messages: req.messages.map((message) => ({
                role: message.role,
                content: "content" in message ? message.content : null,
              })),
              webSearch: isWebSearchEnabled(),
              // Short note explanations should not wait for extended reasoning.
              options: { reasoningEffort: "none", ...req.options },
            }),
            signal: req.signal,
          });

          let data: unknown = null;
          try {
            data = await res.json();
          } catch {
            data = null;
          }

          const errorCode =
            data &&
            typeof data === "object" &&
            typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : null;

          if (errorCode === "client_limit") {
            throw makeInferenceError("unavailable", "client_limit");
          }
          if (errorCode === "search_quota") {
            throw makeInferenceError("unavailable", "search_quota");
          }
          if (errorCode === "rate_limited") {
            throw makeInferenceError("unavailable", "rate_limited");
          }
          if (errorCode === "provider_busy") {
            throw makeInferenceError("unavailable", "provider_busy");
          }
          if (res.status === 429 || errorCode === "quota_exhausted") {
            throw makeInferenceError("unavailable", "quota_exhausted");
          }
          if (errorCode === "disabled" || errorCode === "missing_api_key") {
            throw makeInferenceError(
              "unavailable",
              "Hosted inference disabled",
            );
          }
          const providerStatus =
            data &&
            typeof data === "object" &&
            typeof (data as { providerStatus?: unknown }).providerStatus ===
              "string"
              ? (data as { providerStatus: string }).providerStatus
              : null;
          const providerHttp =
            data &&
            typeof data === "object" &&
            typeof (data as { http?: unknown }).http === "number"
              ? (data as { http: number }).http
              : null;
          // Provider capacity errors (ours may be 503 or wrapped 502).
          if (
            res.status === 503 ||
            res.status === 502 ||
            providerStatus === "UNAVAILABLE" ||
            providerStatus === "INTERNAL" ||
            providerHttp === 503 ||
            providerHttp === 500 ||
            providerHttp === 502
          ) {
            throw makeInferenceError("unavailable", "provider_busy");
          }
          if (errorCode === "provider_error" && res.status >= 500) {
            throw makeInferenceError("unavailable", "provider_busy");
          }
          if (!res.ok) {
            throw makeInferenceError(
              "provider_error",
              "Hosted inference failed. Try again in a moment.",
            );
          }

          const record = data as { content?: unknown; model?: unknown };
          const content =
            typeof record.content === "string" ? record.content : "";
          const model =
            typeof record.model === "string" && record.model.trim()
              ? record.model.trim()
              : "hosted";

          if (!content.trim()) {
            throw makeInferenceError(
              "provider_error",
              "empty hosted inference response",
            );
          }

          bumpSoftClientCount();

          yield { type: "accepted" as const };
          yield {
            type: "done" as const,
            model,
            message: { role: "assistant" as const, content },
          };
        },
      };
    },
  };
}
