export const INFERENCE_CLIENT_HEADER = "X-Inference-Client";

/** Vercel injects hosts without a scheme (e.g. `app.vercel.app`). */
function originFromHost(host) {
  const trimmed = host?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed}`;
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function allowedOrigins() {
  const origins = new Set();
  for (const host of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    const origin = originFromHost(host);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function requestOrigin(req) {
  const origin = req.headers.origin;
  return typeof origin === "string" ? origin : null;
}

function requestHost(req) {
  const host = req.headers.host;
  return typeof host === "string" ? host : undefined;
}

/** Localhost (any port), Vercel URLs, or same-origin as this function. */
export function originAllowed(req) {
  const origin = requestOrigin(req);
  if (!origin) return false;
  if (isLocalOrigin(origin)) return true;
  if (allowedOrigins().has(origin)) return true;
  return originFromHost(requestHost(req)) === origin;
}

export function applyCors(res, req) {
  const origin = requestOrigin(req);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (origin && originAllowed(req)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      `Content-Type, ${INFERENCE_CLIENT_HEADER}`
    );
    res.setHeader("Vary", "Origin");
  }
}
