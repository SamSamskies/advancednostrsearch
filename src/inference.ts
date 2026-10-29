import {
  createInference,
  getFeatures,
  isInferenceAvailable,
  isInferenceError,
  type ContentPart,
  type InferenceRequest,
  type Message,
} from "ipa-tools";
import { SYSTEM_PROMPT_IMAGES_LINE } from "./ask-ai-context.ts";
import {
  createHostedBackend,
  hasHostedConsent,
  HOSTED_BACKEND_ID,
  setHostedConsent,
} from "./hosted-backend.ts";
import { isWebSearchEnabled } from "./settings.ts";

export type InferenceMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string };

export type ChatStatus = "waiting" | "generating" | "thinking";

export type ChatResult = {
  content: string;
  model?: string;
};

export type InferenceGate = "ipa" | "hosted" | "consent" | "unavailable";

export { hasHostedConsent, setHostedConsent };

export const INFERENCE_BRIDGE_HREF =
  "https://github.com/SamSamskies/inference-bridge#installation";

const WEB_SEARCH_TOOL = { type: "web_search" } as const;

type StreamChunk = {
  type: string;
  content?: string;
  model?: string;
  message?: { role?: string; content?: string | ContentPart[] | null };
};

const hostedBackend = createHostedBackend();
const inferenceClient = createInference({
  fallbacks: [hostedBackend],
});

export function isSupportedContext(): boolean {
  return window.isSecureContext && location.origin !== "null";
}

function inferenceFeatures() {
  try {
    return getFeatures();
  } catch {
    return {};
  }
}

function usesHostedImageFallback(hasImages: boolean): boolean {
  return (
    hasImages &&
    isInferenceAvailable() &&
    !Boolean(inferenceFeatures().imageInput) &&
    hasHostedConsent()
  );
}

export function canSearchWeb(hasImages = false): boolean {
  if (!isWebSearchEnabled()) return false;
  // Text-only IPA still uses hosted for vision when consented, and that
  // path can search even if the extension itself cannot.
  if (usesHostedImageFallback(hasImages)) return true;
  if (isInferenceAvailable()) {
    // Stable IPA advertises and runs web_search; experimental.request is not required.
    return Boolean(inferenceFeatures().webSearch);
  }
  // The hosted endpoint handles web search through the selected provider.
  return true;
}

export async function prepareInference(): Promise<InferenceGate> {
  if (!isSupportedContext()) return "unavailable";
  if (isInferenceAvailable()) return "ipa";
  try {
    const status = await inferenceClient.probe();
    if (status.ipa === "available") return "ipa";
    if (status[HOSTED_BACKEND_ID] === "available") {
      return hasHostedConsent() ? "hosted" : "consent";
    }
  } catch {
    // probe failures mean hosted is unavailable
  }
  return "unavailable";
}

export function isAbortError(error: unknown): boolean {
  if (isInferenceError(error) && error.code === "aborted") return true;
  const code = errorCodeOf(error);
  if (code === "aborted") return true;
  return error instanceof DOMException && error.name === "AbortError";
}

function errorCodeOf(error: unknown): string | undefined {
  if (isInferenceError(error)) return error.code;
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

const BRIDGE_HINT =
  "Or install Inference Bridge to choose your own provider.";

export function describeInferenceError(error: unknown): string {
  if (isAbortError(error)) return "Stopped.";
  const code = errorCodeOf(error);
  const message = error instanceof Error && error.message ? error.message : "";

  if (code === "permission_denied") {
    return "Inference was denied for this site.";
  }
  if (code === "unavailable") {
    if (/client_limit/i.test(message)) {
      return `This browser has used today's hosted inference allowance. ${BRIDGE_HINT}`;
    }
    if (/search_quota/i.test(message)) {
      return `Hosted web search is out of quota. Turn off web search and try again. ${BRIDGE_HINT}`;
    }
    if (/provider_busy/i.test(message)) {
      return `The hosted model is busy right now. Try again in a moment. ${BRIDGE_HINT}`;
    }
    if (/rate_limited/i.test(message)) {
      return `Too many hosted requests. Wait a moment and try again. ${BRIDGE_HINT}`;
    }
    if (/quota_exhausted/i.test(message)) {
      return `Hosted inference is out of quota today. Try again tomorrow. ${BRIDGE_HINT}`;
    }
    if (/Hosted inference disabled/i.test(message)) {
      return `Hosted inference is unavailable right now. ${BRIDGE_HINT}`;
    }
    return (
      message || "Inference is unavailable. Check the extension and try again."
    );
  }
  if (code === "invalid_request") {
    return message || "The inference request was rejected.";
  }
  if (code === "provider_error") {
    if (
      /Hosted inference failed|empty hosted inference response/i.test(message)
    ) {
      return `The hosted model hit an error. Try again in a moment. ${BRIDGE_HINT}`;
    }
    return message || `The inference provider failed. ${BRIDGE_HINT}`;
  }
  if (message) return message;
  return "Inference failed.";
}

function chunkModel(chunk: StreamChunk): string | undefined {
  if (typeof chunk.model === "string" && chunk.model) return chunk.model;
  const legacy = (chunk as { model?: unknown }).model;
  return typeof legacy === "string" && legacy ? legacy : undefined;
}

function assistantTextContent(
  content: string | ContentPart[] | null | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const chunks: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && part.type === "text") {
      chunks.push(part.text);
    }
  }
  return chunks.join("");
}

async function consumeChat(
  request: (payload: InferenceRequest) => AsyncIterable<unknown>,
  payload: InferenceRequest,
  onStatus?: (status: ChatStatus) => void,
  onDelta?: (text: string) => void,
): Promise<ChatResult> {
  let text = "";
  let model: string | undefined;
  let sawDelta = false;

  for await (const raw of request(payload)) {
    const chunk = raw as StreamChunk;
    if (chunk.type === "accepted") {
      onStatus?.("generating");
    } else if (
      chunk.type === "reasoning_delta" ||
      chunk.type === "reasoning_delta"
    ) {
      onStatus?.("thinking");
    } else if (chunk.type === "delta") {
      sawDelta = true;
      text += chunk.content ?? "";
      onDelta?.(text);
    } else if (chunk.type === "done") {
      const content = assistantTextContent(chunk.message?.content);
      if (content.length > 0 || !sawDelta) {
        text = content;
      }
      model = chunkModel(chunk) ?? model;
      onDelta?.(text);
    }
  }

  return { content: text, model };
}

function messagesHaveImageParts(messages: InferenceMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (!Array.isArray(message.content)) continue;
    if (message.content.some((part) => part?.type === "image")) return true;
  }
  return false;
}

/** Hosts used by https://wsrv.nl/ (and its images.weserv.nl alias). */
const WSRV_HOSTS = new Set(["wsrv.nl", "images.weserv.nl"]);

/**
 * IPA extensions fetch image URLs from the page origin, so Blossom/CDN hosts
 * without CORS break Ask AI. Route through wsrv.nl (CORS *) for the extension path.
 */
export function proxyImageUrlForIpa(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;
    if (WSRV_HOSTS.has(parsed.hostname.toLowerCase())) return url;
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

function withIpaProxiedImageUrls(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((part) => {
        if (
          part?.type !== "image" ||
          !("url" in part) ||
          typeof part.url !== "string"
        ) {
          return part;
        }
        return { type: "image" as const, url: proxyImageUrlForIpa(part.url) };
      }),
    };
  });
}

async function hostedOnlyRequest(
  payload: InferenceRequest,
  onStatus?: (status: ChatStatus) => void,
  onDelta?: (text: string) => void,
): Promise<ChatResult> {
  const session = await hostedBackend.create({ signal: payload.signal });
  return consumeChat((req) => session.request(req), payload, onStatus, onDelta);
}

export async function completeChat(options: {
  messages: InferenceMessage[];
  signal?: AbortSignal;
  onStatus?: (status: ChatStatus) => void;
  onDelta?: (text: string) => void;
}): Promise<ChatResult> {
  const messages = options.messages as Message[];
  const hasImages = messagesHaveImageParts(options.messages);
  const wantSearch = canSearchWeb(hasImages);
  const tools = wantSearch ? [WEB_SEARCH_TOOL] : undefined;
  const features = inferenceFeatures();
  const ipaSupportsImages =
    isInferenceAvailable() && Boolean(features.imageInput);

  const payload: InferenceRequest = {
    method: "chat",
    messages,
    tools,
    signal: options.signal,
  };

  // IPA without imageInput rejects ImageParts. Prefer hosted when consented;
  // otherwise send text only: keep image URLs in the user text (including
  // imeta-only URLs) and drop the vision system-prompt line so instructions
  // match the payload.
  let requestMessages = messages;
  if (usesHostedImageFallback(hasImages)) {
    return hostedOnlyRequest(payload, options.onStatus, options.onDelta);
  }
  if (hasImages && isInferenceAvailable() && !ipaSupportsImages) {
    requestMessages = stripImageParts(messages);
  } else if (hasImages && ipaSupportsImages) {
    requestMessages = withIpaProxiedImageUrls(messages);
  }

  return consumeChat(
    (req) => inferenceClient.request(req),
    {
      method: "chat",
      messages: requestMessages,
      tools,
      signal: options.signal,
    },
    options.onStatus,
    options.onDelta,
  );
}

function stripImageParts(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (message.role === "system" && typeof message.content === "string") {
      if (!message.content.includes(SYSTEM_PROMPT_IMAGES_LINE)) return message;
      return {
        ...message,
        content: message.content
          .split("\n")
          .filter((line) => line !== SYSTEM_PROMPT_IMAGES_LINE)
          .join("\n"),
      };
    }
    if (message.role !== "user" && message.role !== "assistant") return message;
    if (!Array.isArray(message.content)) return message;
    const texts: string[] = [];
    const imageUrls: string[] = [];
    for (const part of message.content) {
      if (part?.type === "text") texts.push(part.text);
      if (
        part?.type === "image" &&
        "url" in part &&
        typeof part.url === "string" &&
        part.url
      ) {
        imageUrls.push(part.url);
      }
    }
    let text = texts.join("\n\n");
    const extraUrls = imageUrls.filter((url) => !text.includes(url));
    if (extraUrls.length > 0) {
      text = text ? `${text}\n\n${extraUrls.join("\n")}` : extraUrls.join("\n");
    }
    if (message.role === "assistant") {
      return { ...message, content: text };
    }
    return { role: "user", content: text };
  });
}
