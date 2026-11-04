import { SHARED_DEFAULT_MODELS, fallbackDisabled, sharedModelId, sharedProviderId } from "./inference-config.js";
import { applyCors, INFERENCE_CLIENT_HEADER, originAllowed } from "./http.js";

const MAX_BODY_BYTES = 100_000;
const MAX_PROMPT_CHARS = 60_000;
// Shared service: up to 170 seconds plus admission/network overhead.
const REQUEST_TIMEOUT_MS = 180_000;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const EFFORTS = new Set(["auto", "none", "low", "medium", "high"]);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (status, code) => { throw Object.assign(new Error(code), { status }); };

function sharedConfig() {
  const provider = sharedProviderId();
  if (!Object.hasOwn(SHARED_DEFAULT_MODELS, provider)) fail(503, "invalid_provider");
  if (fallbackDisabled(provider)) fail(503, "disabled");
  const model = sharedModelId();
  if (!model || model.length > 200 || /[\s\p{Cc}]/u.test(model)) fail(503, "invalid_model");
  const secret = process.env.SHARED_INFERENCE_APP_SECRET?.trim();
  const key = process.env[`SHARED_INFERENCE_${provider.toUpperCase()}_API_KEY`]?.trim();
  if (!secret || !key) fail(503, "missing_api_key");
  if (/[\r\n]/.test(secret + key)) fail(503, "invalid_shared_config");
  let url;
  try {
    url = new URL(process.env.SHARED_INFERENCE_URL?.trim());
  } catch {
    fail(503, "invalid_shared_config");
  }
  // HTTP is permitted only for the separately running local service.
  const local = process.env.VERCEL_ENV !== "production" && process.env.VERCEL_ENV !== "preview" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.hash || url.pathname !== "/api/inference") {
    fail(503, "invalid_shared_config");
  }
  // Discard configured queries as well as every browser-selected query parameter.
  url.search = "";
  url.searchParams.set("provider", provider);
  return { url: url.href, provider, model, secret, key };
}

/** Construct a fresh allowlist of IPA fields; never forward arbitrary browser data. */
function validatedPayload(req, config) {
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) fail(413, "payload_too_large");
  let body;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") :
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (typeof raw !== "string") fail(400, "invalid_json");
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) fail(413, "payload_too_large");
    body = JSON.parse(raw);
  } catch (error) {
    if (error.status) throw error;
    fail(400, "invalid_json");
  }
  if (!record(body) || !Array.isArray(body.messages) || !body.messages.length) fail(400, "invalid_request");
  let chars = 0;
  const count = (value) => {
    chars += value.length;
    if (chars > MAX_PROMPT_CHARS) fail(413, "payload_too_large");
    return value;
  };
  let firstRole;
  let lastRole;
  const messages = body.messages.map((message) => {
    if (!record(message) || !["system", "user", "assistant"].includes(message.role)) fail(400, "invalid_request");
    let content;
    if (typeof message.content === "string" && message.content.trim()) {
      content = count(message.content);
    } else if (message.role !== "system" && Array.isArray(message.content) && message.content.length) {
      content = message.content.map((part) => {
        if (!record(part)) fail(400, "invalid_request");
        if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
          return { type: "text", text: count(part.text) };
        }
        if (part.type !== "image") fail(400, "invalid_request");
        const mediaType = part.mediaType === "image/jpg" ? "image/jpeg" : part.mediaType;
        if (mediaType !== undefined && !MEDIA_TYPES.has(mediaType)) fail(400, "invalid_request");
        if (typeof part.url === "string" && part.url.trim()) {
          let url;
          try { url = new URL(part.url); } catch { fail(400, "invalid_request"); }
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail(400, "invalid_request");
          return { type: "image", url: count(part.url.trim()), ...(mediaType ? { mediaType } : {}) };
        }
        if (!mediaType || typeof part.data !== "string" || !part.data.length ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.data)) {
          fail(400, "invalid_request");
        }
        return { type: "image", mediaType, data: count(part.data) };
      });
    } else {
      fail(400, "invalid_request");
    }
    if (message.role !== "system") {
      firstRole ??= message.role;
      lastRole = message.role;
    }
    return { role: message.role, content };
  });
  if (firstRole !== "user" || lastRole !== "user") fail(400, "invalid_request");
  if (body.webSearch !== undefined && typeof body.webSearch !== "boolean") fail(400, "invalid_request");
  const webSearch = body.webSearch !== false;
  // Keep unvalidated Gemini search off the shared path until separately verified.
  if (config.provider === "gemini" && webSearch &&
      process.env.SHARED_INFERENCE_GEMINI_SEARCH_ENABLED?.trim().toLowerCase() !== "true") {
    fail(400, "unsupported_capability");
  }
  const options = {};
  if (body.options != null) {
    if (!record(body.options)) fail(400, "invalid_request");
    if (body.options.reasoningEffort !== undefined) {
      if (!EFFORTS.has(body.options.reasoningEffort)) fail(400, "invalid_request");
      options.reasoningEffort = body.options.reasoningEffort;
    }
    if (body.options.temperature !== undefined) {
      const temperature = body.options.temperature;
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) fail(400, "invalid_request");
      options.temperature = temperature;
    }
  }
  const payload = JSON.stringify({ messages, webSearch, options, model: config.model });
  if (Buffer.byteLength(payload, "utf8") > MAX_BODY_BYTES) fail(413, "payload_too_large");
  return payload;
}

function redact(value, secrets) {
  if (typeof value === "string") {
    for (const secret of secrets) value = value.replaceAll(secret, "[redacted]");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [redact(key, secrets), redact(item, secrets)]));
  return value;
}

export default async function sharedInference(req, res) {
  applyCors(res, req);
  if (req.method === "OPTIONS") {
    res.status(req.headers.origin && !originAllowed(req) ? 403 : 204).end();
    return;
  }
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if ((req.method === "POST" || req.headers.origin) && !originAllowed(req)) {
    res.status(403).json({ error: "forbidden_origin" });
    return;
  }

  let config;
  let body;
  let client;
  try {
    config = sharedConfig();
    if (req.method === "POST") {
      body = validatedPayload(req, config);
      client = req.headers[INFERENCE_CLIENT_HEADER.toLowerCase()];
      if (typeof client !== "string" || !client.trim()) fail(400, "missing_client_token");
      client = client.trim();
      if (client.length > 200 || /\p{Cc}/u.test(client)) fail(400, "invalid_client_token");
    }
  } catch (error) {
    res.status(error.status || 503).json({ error: error.status ? error.message : "invalid_shared_config" });
    return;
  }

  const cancelled = new AbortController();
  const onAborted = () => cancelled.abort();
  const onClose = () => { if (!res.writableFinished) onAborted(); };
  req.on?.("aborted", onAborted);
  res.on?.("close", onClose);
  if (req.aborted || res.destroyed) onAborted();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = AbortSignal.any([timeout, cancelled.signal, ...(req.signal ? [req.signal] : [])]);
  try {
    signal.throwIfAborted();
    const upstream = await fetch(config.url, {
      method: req.method,
      headers: {
        "X-Inference-App": "advancednostrsearch",
        Authorization: `Bearer ${config.secret}`,
        "X-Inference-Provider-Key": config.key,
        ...(body ? { "Content-Type": "application/json", [INFERENCE_CLIENT_HEADER]: client } : {}),
      },
      ...(body ? { body } : {}),
      redirect: "error",
      signal,
    });
    if (upstream.status < 200 || (upstream.status >= 300 && upstream.status < 400)) fail(502, "provider_error");
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.setHeader("Retry-After", redact(retryAfter, [config.secret, config.key]));
    let data;
    try {
      data = await upstream.json();
    } catch {
      signal.throwIfAborted();
      if (upstream.status !== 429) throw new Error("invalid_response");
    }
    // A platform WAF may return HTML/plain text instead of service error JSON.
    if (upstream.status === 429 && !record(data)) data = { error: "rate_limited" };
    if (!record(data)) fail(502, "provider_error");
    signal.throwIfAborted();
    if (!res.destroyed) res.status(upstream.status).json(redact(data, [config.secret, config.key]));
  } catch {
    // Never log upstream bodies, headers, URLs, or error messages containing secrets.
    if (!res.destroyed) {
      const aborted = cancelled.signal.aborted || req.signal?.aborted;
      res.status(aborted ? 499 : timeout.aborted ? 503 : 502).json({
        error: aborted ? "aborted" : timeout.aborted ? "provider_busy" : "provider_error",
      });
    }
  } finally {
    req.off?.("aborted", onAborted);
    res.off?.("close", onClose);
  }
}
