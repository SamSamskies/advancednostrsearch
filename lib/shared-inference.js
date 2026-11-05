import { SHARED_DEFAULT_MODELS, fallbackDisabled, sharedModelId, sharedProviderId } from "./inference-config.js";
import { applyCors, INFERENCE_CLIENT_HEADER, originAllowed } from "./http.js";

const MAX_BODY_BYTES = 100_000;
// Shared service: up to 170 seconds plus admission/network overhead.
const REQUEST_TIMEOUT_MS = 180_000;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (status, code) => { throw Object.assign(new Error(code), { status }); };

function sharedConfig() {
  const provider = sharedProviderId();
  if (!Object.hasOwn(SHARED_DEFAULT_MODELS, provider)) fail(503, "invalid_provider");
  if (fallbackDisabled()) fail(503, "disabled");
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

/** Bound the browser request and select public fields; the shared API validates their contents. */
function proxyPayload(req, config) {
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
  if (!record(body)) fail(400, "invalid_request");
  // App-owned rollout policy: Gemini search still requires explicit opt-in.
  if (config.provider === "gemini" && body.webSearch !== false &&
      process.env.SHARED_INFERENCE_GEMINI_SEARCH_ENABLED?.trim().toLowerCase() !== "true") {
    fail(400, "unsupported_capability");
  }
  const payload = JSON.stringify({
    messages: body.messages, webSearch: body.webSearch, options: body.options, model: config.model,
  });
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
      body = proxyPayload(req, config);
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
