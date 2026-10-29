/**
 * Hosted inference fallback. The public contract is generic so the provider
 * behind this file can change without renaming `/api/inference`.
 *
 * Default: Ollama Cloud. Gemini remains selectable with INFERENCE_PROVIDER.
 * The key stays server-side. Local: `npx vercel dev` (loads `.env.local`).
 *
 * JavaScript (not TypeScript): `vercel dev` crashes compiling `.ts` API
 * routes in this Vite app with `Cannot read properties of undefined (reading
 * 'startsWith')`.
 */

import dns from "node:dns/promises";
import { isIP } from "node:net";
import { envInt, loadLocalEnvFallback, todayUtc } from "../lib/env.js";
import { completeOllama } from "../lib/ollama.js";
import { ollamaLimiter } from "../lib/ollama-limits.js";
import {
  applyCors,
  INFERENCE_CLIENT_HEADER,
  originAllowed,
} from "../lib/http.js";

const DEFAULT_MODELS = { ollama: "gemma4:cloud", gemini: "gemma-4-31b-it" };
const MAX_BODY_BYTES = 100_000;
const MAX_PROMPT_CHARS = 60_000;
const REQUEST_TIMEOUT_MS = 50_000;
const DEFAULT_CLIENT_DAILY = 50;

const clientBuckets = new Map();

loadLocalEnvFallback(["INFERENCE_", "GEMINI_", "OLLAMA_"]);

function providerId() {
  return process.env.INFERENCE_PROVIDER?.trim().toLowerCase() || "ollama";
}

function apiKey() {
  if (providerId() === "gemini") {
    return process.env.GEMINI_API_KEY?.trim() || process.env.INFERENCE_API_KEY?.trim() || "";
  }
  if (providerId() === "ollama") {
    // INFERENCE_API_KEY is a legacy Gemini key; never send it to Ollama.
    return process.env.OLLAMA_API_KEY?.trim() || "";
  }
  return "";
}

function fallbackEnabled() {
  const flag = (
    process.env.INFERENCE_FALLBACK_ENABLED ??
    (providerId() === "gemini" ? process.env.GEMINI_FALLBACK_ENABLED : undefined) ??
    ""
  )
    .trim()
    .toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(apiKey());
}

function modelId() {
  const provider = providerId();
  return process.env[provider === "ollama" ? "OLLAMA_MODEL" : "GEMINI_MODEL"]?.trim() ||
    (process.env.INFERENCE_PROVIDER?.trim() ? process.env.INFERENCE_MODEL?.trim() : "") ||
    DEFAULT_MODELS[provider];
}

function clientDailyLimit() {
  return envInt(
    "INFERENCE_CLIENT_DAILY_LIMIT",
    providerId() === "gemini" ? envInt("GEMINI_CLIENT_DAILY_LIMIT", DEFAULT_CLIENT_DAILY) : DEFAULT_CLIENT_DAILY
  );
}

function tryConsumeClient(key, limit) {
  const day = todayUtc();
  const cur = clientBuckets.get(key);
  if (!cur || cur.day !== day) {
    clientBuckets.set(key, { day, count: 1 });
    return true;
  }
  if (cur.count >= limit) return false;
  cur.count += 1;
  return true;
}

function releaseClient(key) {
  const day = todayUtc();
  const cur = clientBuckets.get(key);
  if (!cur || cur.day !== day || cur.count <= 0) return;
  cur.count -= 1;
}

const IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function guessImageMime(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".webp")) return "image/webp";
    if (path.endsWith(".gif")) return "image/gif";
    if (
      path.endsWith(".jpg") ||
      path.endsWith(".jpeg") ||
      path.endsWith(".jfif")
    ) {
      return "image/jpeg";
    }
  } catch {
    // ignore
  }
  return "image/jpeg";
}

function normalizeImageMime(raw) {
  if (typeof raw !== "string") return undefined;
  const mime = raw.trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (IMAGE_MEDIA_TYPES.has(mime)) return mime;
  return undefined;
}

/** Map IPA ContentPart[] / string into Gemini generateContent parts. */
function toGeminiParts(content) {
  if (typeof content === "string") {
    return content.trim() ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts = [];
  for (const part of content) {
    if (part == null || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") {
      if (part.text.trim()) parts.push({ text: part.text });
      continue;
    }
    if (part.type !== "image") continue;

    if (typeof part.url === "string" && part.url.trim()) {
      const mime =
        normalizeImageMime(part.mediaType) || guessImageMime(part.url);
      parts.push({
        fileData: {
          fileUri: part.url.trim(),
          mimeType: mime,
        },
      });
      continue;
    }

    const mime = normalizeImageMime(part.mediaType);
    const data = typeof part.data === "string" ? part.data.trim() : "";
    if (mime && data) {
      parts.push({
        inlineData: {
          mimeType: mime,
          data,
        },
      });
    }
  }
  return parts;
}

function toGeminiContents(messages) {
  let system = "";
  const contents = [];

  for (const msg of messages) {
    if (msg == null || typeof msg !== "object") continue;
    if (msg.role === "system") {
      const content = typeof msg.content === "string" ? msg.content : "";
      if (content.trim()) {
        system = system ? `${system}\n\n${content}` : content;
      }
      continue;
    }

    const parts = toGeminiParts(msg.content);
    if (parts.length === 0) continue;

    const role = msg.role === "assistant" ? "model" : "user";
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) {
      // Merge consecutive same-role turns (text-only concat when both are plain text).
      const prevOnlyText =
        prev.parts.length === 1 && typeof prev.parts[0].text === "string";
      const nextOnlyText =
        parts.length === 1 && typeof parts[0].text === "string";
      if (prevOnlyText && nextOnlyText) {
        prev.parts[0].text += `\n\n${parts[0].text}`;
      } else {
        prev.parts.push(...parts);
      }
    } else {
      contents.push({ role, parts });
    }
  }

  if (contents.length === 0) return null;
  if (contents[0].role !== "user") return null;
  if (contents[contents.length - 1]?.role !== "user") return null;
  return { system: system.trim(), contents };
}

function promptChars(system, contents) {
  let total = system.length;
  for (const content of contents) {
    for (const part of content.parts) {
      if (typeof part.text === "string") total += part.text.length;
      else if (part.fileData?.fileUri) total += part.fileData.fileUri.length;
      else if (part.inlineData?.data) total += part.inlineData.data.length;
    }
  }
  return total;
}

const MAX_INLINE_IMAGE_BYTES = 4_000_000;
const MAX_IMAGE_FETCH_REDIRECTS = 5;

function contentsHaveFileData(contents) {
  return contents.some((content) =>
    content.parts.some((part) => part.fileData?.fileUri)
  );
}

function contentsHaveInlineData(contents) {
  return contents.some((content) =>
    content.parts.some((part) => part.inlineData)
  );
}

// Keep in sync with SYSTEM_PROMPT_IMAGES_LINE in src/ask-ai-context.ts.
const VISION_SYSTEM_LINE =
  "The first user message includes the note's images before the text. Look at those images when they matter.";

function stripVisionSystemLine(system) {
  if (typeof system !== "string" || !system) return system;
  return system
    .split("\n")
    .filter((line) => line !== VISION_SYSTEM_LINE)
    .join("\n");
}

/** Turn unresolved fileData into text URLs so a failed fetch still explains the note. */
function fallbackUnreadImages(contents) {
  return contents.map((content) => {
    const kept = [];
    const unreadUrls = [];
    for (const part of content.parts) {
      if (part.fileData?.fileUri) unreadUrls.push(part.fileData.fileUri);
      else kept.push(part);
    }
    if (unreadUrls.length === 0) return content;
    const existingText = kept
      .filter((part) => typeof part.text === "string")
      .map((part) => part.text)
      .join("\n\n");
    const extraUrls = unreadUrls.filter((url) => url && !existingText.includes(url));
    if (extraUrls.length === 0) return { ...content, parts: kept };
    const extra = extraUrls.join("\n");
    const parts = kept.slice();
    let lastText = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (typeof parts[i].text === "string") {
        lastText = i;
        break;
      }
    }
    if (lastText >= 0) {
      const text = parts[lastText].text;
      parts[lastText] = { text: text ? `${text}\n\n${extra}` : extra };
    } else {
      parts.push({ text: extra });
    }
    return { ...content, parts };
  });
}

/**
 * DNS lookup used before fetching note images. Tests replace `lookupAll` so
 * they can simulate public vs private answers without a network.
 */
export const imageFetchDns = {
  lookupAll(hostname) {
    return dns.lookup(hostname, { all: true });
  },
};

/** Block localhost, RFC1918, link-local, and cloud-metadata targets (SSRF). */
function isPrivateOrLocalHostname(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host.endsWith(".internal")) {
    return true;
  }
  if (host === "::1" || host === "0.0.0.0" || host === "::") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (host.includes(":")) {
    if (
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return true;
    }
    const mapped = /:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
    if (mapped) return isPrivateOrLocalHostname(mapped[1]);
  }

  return false;
}

async function assertPublicResolvedAddresses(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (isIP(host)) return;

  let records;
  try {
    records = await imageFetchDns.lookupAll(host);
  } catch {
    throw new Error("image_fetch_url");
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("image_fetch_url");
  }
  for (const record of records) {
    const address = record?.address;
    if (!address || isPrivateOrLocalHostname(address)) {
      throw new Error("image_fetch_url");
    }
  }
}

async function assertSafeImageFetchUrl(fileUri, base) {
  let parsed;
  try {
    parsed = base ? new URL(fileUri, base) : new URL(fileUri);
  } catch {
    throw new Error("image_fetch_url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("image_fetch_url");
  }
  if (parsed.username || parsed.password) {
    throw new Error("image_fetch_url");
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error("image_fetch_url");
  }
  // Literal IPs are covered above; names like 127.0.0.1.nip.io need DNS.
  await assertPublicResolvedAddresses(parsed.hostname);
  return parsed;
}

async function fetchImageAsInlineData(fileUri, mimeType, signal) {
  let current = await assertSafeImageFetchUrl(fileUri);
  let res;

  for (let hop = 0; hop <= MAX_IMAGE_FETCH_REDIRECTS; hop++) {
    res = await fetch(current.href, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        // Some media CDNs reject bare bot fetches.
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "advancednostrsearch-inference/1.0",
      },
    });

    if (res.status < 300 || res.status >= 400) break;

    const location = res.headers.get("location");
    if (!location) throw new Error("image_fetch_url");
    // Re-validate every hop so redirects cannot pivot into private/metadata nets.
    current = await assertSafeImageFetchUrl(location, current.href);
  }

  if (!res || (res.status >= 300 && res.status < 400)) {
    throw new Error("image_fetch_url");
  }
  if (!res.ok) {
    throw new Error(`image_fetch_http_${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("image_fetch_size");
  }
  const headerMime = normalizeImageMime(
    (res.headers.get("content-type") || "").split(";")[0]
  );
  const mime =
    headerMime ||
    normalizeImageMime(mimeType) ||
    guessImageMime(current.href);
  return {
    inlineData: {
      mimeType: mime,
      data: buffer.toString("base64"),
    },
  };
}

/**
 * Resolve `{ fileData }` to `{ inlineData }` in our process. Google's URL fetch
 * often fails or 503s on Nostr/Blossom CDNs; bytes we can reach work more often.
 * Leave fileData only when our fetch fails; provider paths then fall back to
 * a text URL (Gemini below, Ollama in toMessages).
 */
async function resolveImagesToInline(contents, signal) {
  const next = [];
  for (const content of contents) {
    const parts = [];
    for (const part of content.parts) {
      if (!part.fileData?.fileUri) {
        parts.push(part);
        continue;
      }
      try {
        parts.push(
          await fetchImageAsInlineData(
            part.fileData.fileUri,
            part.fileData.mimeType,
            signal
          )
        );
      } catch (error) {
        console.warn("[api/inference] image fetch failed", {
          uri: String(part.fileData.fileUri).slice(0, 120),
          error: error instanceof Error ? error.message : "unknown",
        });
        parts.push(part);
      }
    }
    next.push({ ...content, parts });
  }
  return next;
}

function looksLikeCapacityError(errJson, httpStatus) {
  if (httpStatus !== 500 && httpStatus !== 503 && httpStatus !== 502) {
    return false;
  }
  const providerStatus =
    errJson && typeof errJson === "object" ? errJson?.error?.status : null;
  // Gemini often returns opaque 500 INTERNAL / "Internal error encountered"
  // under load; treat like capacity rather than a hard provider failure.
  if (providerStatus === "INTERNAL" || providerStatus === "UNAVAILABLE") {
    return true;
  }
  const text = collectStrings(errJson).join(" ");
  return /high demand|try again later|temporarily|UNAVAILABLE|overloaded|capacity|internal error/i.test(
    text
  );
}

function readBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body == null) return "";
  return JSON.stringify(req.body);
}

function clientToken(req) {
  const header = req.headers[INFERENCE_CLIENT_HEADER.toLowerCase()];
  return typeof header === "string" ? header.trim() : "";
}

export default async function handler(req, res) {
  applyCors(res, req);

  if (req.method === "OPTIONS") {
    if (req.headers.origin && !originAllowed(req)) {
      res.status(403).end();
      return;
    }
    res.status(204).end();
    return;
  }

  if (!Object.hasOwn(DEFAULT_MODELS, providerId())) {
    res.status(503).json({ error: "invalid_provider" });
    return;
  }

  if (req.method === "GET") {
    if (fallbackEnabled()) {
      res.status(200).json({ ok: true });
      return;
    }
    res.status(503).json({
      ok: false,
      error: apiKey() ? "disabled" : "missing_api_key",
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!fallbackEnabled()) {
    res.status(503).json({
      error: apiKey() ? "disabled" : "missing_api_key",
    });
    return;
  }

  if (!originAllowed(req)) {
    res.status(403).json({ error: "forbidden_origin" });
    return;
  }

  const contentLength = Number(req.headers["content-length"] || "0");
  if (contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }

  let body;
  try {
    const text = readBody(req);
    if (text.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    body =
      typeof req.body === "object" && req.body != null
        ? req.body
        : JSON.parse(text);
  } catch {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const prompt = toGeminiContents(body.messages);
  if (!prompt) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  if (promptChars(prompt.system, prompt.contents) > MAX_PROMPT_CHARS) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }

  const options = parseInferenceOptions(body.options);
  if (options === null) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const clientId = clientToken(req);
  if (!clientId) {
    res.status(400).json({ error: "missing_client_token" });
    return;
  }

  if (!tryConsumeClient(clientId, clientDailyLimit())) {
    res.status(429).json({ error: "client_limit" });
    return;
  }

  if (providerId() === "ollama") {
    let finish;
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    try {
      finish = ollamaLimiter.begin(clientId);
      const resolvedPrompt = {
        ...prompt,
        contents: contentsHaveFileData(prompt.contents)
          ? await resolveImagesToInline(prompt.contents, signal)
          : prompt.contents,
      };
      const result = await completeOllama({
        prompt: resolvedPrompt,
        model: modelId(),
        key: apiKey(),
        options,
        webSearch: body.webSearch !== false,
        signal,
      });
      res.status(200).json({
        content: withSources(result.content, result.sources),
        model: result.model,
      });
    } catch (error) {
      releaseClient(clientId);
      if (error?.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      const status = signal.aborted ? 503 : error?.status || 502;
      res.status(status).json({
        error: signal.aborted ? "provider_busy" : error?.status ? error.message : "provider_error",
      });
    } finally {
      finish?.();
    }
    return;
  }

  const key = apiKey();
  const model = modelId();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const generationConfig = {};
  const thinkingConfig = thinkingConfigForEffort(
    model,
    options.reasoningEffort
  );
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig;
  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }

  // Client may omit web search to avoid Google Search grounding cost.
  const useWebSearch = body.webSearch !== false;
  const geminiBody = {
    contents: prompt.contents,
  };
  if (useWebSearch) {
    geminiBody.tools = [{ googleSearch: {} }];
  }
  if (prompt.system) {
    geminiBody.systemInstruction = {
      parts: [{ text: prompt.system }],
    };
  }
  if (Object.keys(generationConfig).length > 0) {
    geminiBody.generationConfig = generationConfig;
  }

  // Bound image fetching, generation, and the capacity retry within Vercel's limit.
  const requestSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  // Hosted path: pull image bytes ourselves first. Relying on Gemini fileUri
  // fetch for Nostr CDNs often returns 503 / fetch failures.
  if (contentsHaveFileData(geminiBody.contents)) {
    geminiBody.contents = await resolveImagesToInline(geminiBody.contents, requestSignal);
  }
  geminiBody.contents = fallbackUnreadImages(geminiBody.contents);
  if (
    geminiBody.systemInstruction &&
    !contentsHaveInlineData(geminiBody.contents)
  ) {
    const system = stripVisionSystemLine(
      geminiBody.systemInstruction.parts?.[0]?.text
    );
    if (system) {
      geminiBody.systemInstruction = { parts: [{ text: system }] };
    } else {
      delete geminiBody.systemInstruction;
    }
  }

  async function postGemini(body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  }

  let geminiRes;
  try {
    geminiRes = await postGemini(geminiBody);
  } catch {
    releaseClient(clientId);
    if (requestSignal.aborted) {
      res.status(503).json({ error: "provider_busy" });
      return;
    }
    res.status(502).json({ error: "provider_error" });
    return;
  }

  // One capacity retry for transient Gemini 5xx (503 high demand, 500 INTERNAL).
  if (
    geminiRes.status === 500 ||
    geminiRes.status === 502 ||
    geminiRes.status === 503
  ) {
    let errJson = null;
    try {
      errJson = await geminiRes.json();
    } catch {
      errJson = null;
    }
    const capacity = looksLikeCapacityError(errJson, geminiRes.status);
    if (capacity) {
      console.warn("[api/inference] provider capacity; retrying once", {
        http: geminiRes.status,
        status: errJson?.error?.status,
        message: geminiErrorMessage(errJson)?.slice(0, 200),
      });
      try {
        await new Promise((r) => setTimeout(r, 800));
        geminiRes = await postGemini(geminiBody);
      } catch {
        releaseClient(clientId);
        res.status(503).json({ error: "provider_busy" });
        return;
      }
      // Fall through to normal status handling with the retry response.
    } else {
      releaseClient(clientId);
      const providerStatus = errJson?.error?.status;
      console.warn("[api/inference] provider error", {
        http: geminiRes.status,
        status: providerStatus,
        message: geminiErrorMessage(errJson)?.slice(0, 200),
      });
      res.status(503).json({
        error: "provider_busy",
        http: geminiRes.status,
        ...(providerStatus ? { providerStatus } : {}),
      });
      return;
    }
  }

  if (geminiRes.status === 429) {
    releaseClient(clientId);
    let quota = "rate";
    try {
      const errJson = await geminiRes.json();
      quota = classifyGemini429(errJson);
      console.warn("[api/inference] provider 429", {
        kind: quota,
        webSearch: useWebSearch,
        quotaIds: collectQuotaIds(errJson),
        message: geminiErrorMessage(errJson)?.slice(0, 200),
      });
    } catch {
      console.warn("[api/inference] provider 429", {
        kind: quota,
        webSearch: useWebSearch,
        unreadable: true,
      });
    }
    // Grounding has its own (often tiny) quota. When search was on, tell the
    // client so the UI can suggest turning it off vs a generic rate limit.
    const error = useWebSearch
      ? "search_quota"
      : quota === "daily"
        ? "quota_exhausted"
        : "rate_limited";
    res.status(429).json({ error });
    return;
  }

  if (!geminiRes.ok) {
    releaseClient(clientId);
    let errJson = null;
    try {
      errJson = await geminiRes.json();
    } catch {
      errJson = null;
    }
    if (looksLikeCapacityError(errJson, geminiRes.status)) {
      console.warn("[api/inference] provider capacity", {
        http: geminiRes.status,
        message: geminiErrorMessage(errJson)?.slice(0, 200),
      });
      res.status(503).json({ error: "provider_busy" });
      return;
    }
    const providerStatus = errJson?.error?.status;
    console.warn("[api/inference] provider error", {
      http: geminiRes.status,
      status: providerStatus,
      message: geminiErrorMessage(errJson)?.slice(0, 200),
    });
    if (geminiRes.status >= 500) {
      res.status(503).json({
        error: "provider_busy",
        http: geminiRes.status,
        ...(providerStatus ? { providerStatus } : {}),
      });
      return;
    }
    res.status(400).json({
      error: "provider_error",
      http: geminiRes.status,
      ...(providerStatus ? { providerStatus } : {}),
    });
    return;
  }

  let geminiJson;
  try {
    geminiJson = await geminiRes.json();
  } catch {
    releaseClient(clientId);
    res.status(502).json({ error: "provider_error" });
    return;
  }

  const text = extractGeminiText(geminiJson);
  if (!text) {
    releaseClient(clientId);
    res.status(502).json({ error: "provider_error" });
    return;
  }

  res.status(200).json({
    content: withSources(text, extractGroundingSources(geminiJson)),
    model,
  });
}

const REASONING_EFFORTS = new Set(["auto", "none", "low", "medium", "high"]);

function parseInferenceOptions(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const options = {};

  if ("reasoningEffort" in raw && raw.reasoningEffort !== undefined) {
    if (
      typeof raw.reasoningEffort !== "string" ||
      !REASONING_EFFORTS.has(raw.reasoningEffort)
    ) {
      return null;
    }
    options.reasoningEffort = raw.reasoningEffort;
  }

  if ("temperature" in raw && raw.temperature !== undefined) {
    if (
      typeof raw.temperature !== "number" ||
      !Number.isFinite(raw.temperature) ||
      raw.temperature < 0 ||
      raw.temperature > 2
    ) {
      return null;
    }
    options.temperature = raw.temperature;
  }

  return options;
}

/** Map IPA `reasoningEffort` onto Gemini thinking knobs. Omit for auto/absent. */
function thinkingConfigForEffort(model, effort) {
  if (effort == null || effort === "auto") return undefined;
  if (/\b2\.5\b/.test(model)) {
    if (effort === "none") return { thinkingBudget: 0 };
    if (effort === "low") return { thinkingBudget: 1024 };
    if (effort === "medium") return { thinkingBudget: 8192 };
    return { thinkingBudget: -1 };
  }
  if (/^gemma-/i.test(model)) {
    return { thinkingLevel: effort === "none" ? "minimal" : "high" };
  }
  return { thinkingLevel: effort === "none" ? "minimal" : effort };
}

function classifyGemini429(body) {
  // RESOURCE_EXHAUSTED covers both short-window RPM/TPM limits and daily/plan
  // quotas. Prefer explicit quota signals; default to rate (retry soon).
  const haystack = `${collectStrings(body).join(" ")} ${collectQuotaIds(body).join(" ")}`;
  if (
    /PerMinute|per_minute|per minute|RequestsPerMinute|_rpm\b|TokensPerMinute|_tpm\b/i.test(
      haystack
    )
  ) {
    return "rate";
  }
  // Opaque "check billing" / "exceeded your current quota" is Gemini's usual
  // daily/plan message when PerDay is absent (common for Search Grounding).
  if (
    /PerDay|per_day|per day|RequestsPerDay|_rpd\b|exceeded your current quota|billing details/i.test(
      haystack
    )
  ) {
    return "daily";
  }
  return "rate";
}

function collectQuotaIds(value) {
  const ids = [];
  walkObjects(value, (record) => {
    if (typeof record.quotaId === "string" && record.quotaId.trim()) {
      ids.push(record.quotaId);
    }
  });
  return ids;
}

function collectStrings(value) {
  const parts = [];
  const visit = (node) => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const child of Object.values(node)) visit(child);
    }
  };
  visit(value);
  return parts;
}

function walkObjects(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    visit(value);
    for (const child of Object.values(value)) walkObjects(child, visit);
  }
}

function geminiErrorMessage(value) {
  if (!value || typeof value !== "object") return undefined;
  const error = value.error;
  if (!error || typeof error !== "object") return undefined;
  const message = error.message;
  return typeof message === "string" ? message : undefined;
}

function extractGeminiText(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = data.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const content = candidates[0]?.content;
  if (!content || typeof content !== "object") return null;
  const parts = content.parts;
  if (!Array.isArray(parts)) return null;
  const chunks = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    if (part.thought === true) continue;
    if (typeof part.text === "string") chunks.push(part.text);
  }
  const joined = chunks.join("").trim();
  return joined || null;
}

function extractGroundingSources(data) {
  const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const seen = new Set();
  const sources = [];
  for (const chunk of chunks) {
    const web = chunk?.web;
    const uri = typeof web?.uri === "string" ? web.uri.trim() : "";
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    const title =
      typeof web.title === "string" && web.title.trim()
        ? web.title.trim()
        : uri;
    sources.push({ title, uri });
  }
  return sources;
}

function withSources(text, sources) {
  if (sources.length === 0) return text;
  if (sources.every((source) => text.includes(source.uri))) return text;
  const lines = sources.map((source) => `- [${source.title}](${source.uri})`);
  return `${text}\n\nSources:\n${lines.join("\n")}`;
}
