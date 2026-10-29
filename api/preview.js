/**
 * Open Graph / Twitter Card link unfurl for note previews.
 * JavaScript (not TypeScript): `vercel dev` crashes compiling `.ts` API routes.
 */

import { applyCors, originAllowed } from "../lib/http.js";
import {
  assertSafeFetchUrl,
  discardBody,
  pinnedFetch,
} from "../lib/safeUrl.js";

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 8_000;
const USER_AGENT = "advancednostrsearch-preview/1.0";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : "";
      } catch {
        return "";
      }
    })
    .trim();
}

function metaContent(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta\\s[^>]*?(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*?>`,
        "i"
      ),
      new RegExp(
        `<meta\\s[^>]*?content\\s*=\\s*["']([^"']*)["'][^>]*?(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?>`,
        "i"
      ),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return decodeEntities(match[1]);
    }
  }
  return null;
}

function htmlTitle(html) {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1] ? decodeEntities(match[1]) : null;
}

async function resolveImageUrl(image, pageUrl) {
  if (!image) return null;
  try {
    const resolved = await assertSafeFetchUrl(image, pageUrl);
    return resolved.url.href;
  } catch {
    return null;
  }
}

async function readBodyLimited(res, maxBytes) {
  const length = Number(res.headers.get("content-length") || "0");
  if (length > maxBytes) {
    throw new Error("html_too_large");
  }

  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (text.length > maxBytes) throw new Error("html_too_large");
    return text;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      throw new Error("html_too_large");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

async function fetchHtml(targetUrl) {
  let current = await assertSafeFetchUrl(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Connect to the address from assertSafeFetchUrl — do not re-resolve DNS.
      const res = await pinnedFetch(current, {
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": USER_AGENT,
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await discardBody(res);
        if (!location) throw new Error("redirect");
        current = await assertSafeFetchUrl(location, current.url.href);
        continue;
      }

      if (!res.ok) {
        await discardBody(res);
        throw new Error(`http_${res.status}`);
      }

      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      if (
        contentType &&
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml") &&
        !contentType.includes("text/plain")
      ) {
        await discardBody(res);
        throw new Error("not_html");
      }

      const html = await readBodyLimited(res, MAX_HTML_BYTES);
      return { html, finalUrl: current.url.href };
    }

    throw new Error("too_many_redirects");
  } finally {
    clearTimeout(timer);
  }
}

async function parsePreview(html, finalUrl) {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) || htmlTitle(html);
  const description = metaContent(html, [
    "og:description",
    "twitter:description",
    "description",
  ]);
  const imageRaw = metaContent(html, ["og:image", "twitter:image"]);
  const image = await resolveImageUrl(imageRaw, finalUrl);

  let domain = null;
  try {
    domain = new URL(finalUrl).hostname.replace(/^www\./i, "");
  } catch {
    domain = null;
  }

  return {
    url: finalUrl,
    title: title || null,
    description: description || null,
    image,
    domain,
  };
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

  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // Same-origin GETs often omit Origin; only enforce when present.
  if (req.headers.origin && !originAllowed(req)) {
    res.status(403).json({ error: "forbidden_origin" });
    return;
  }

  const rawUrl =
    typeof req.query?.url === "string"
      ? req.query.url
      : new URL(req.url || "", "http://localhost").searchParams.get("url");

  if (!rawUrl || typeof rawUrl !== "string") {
    res.status(400).json({ error: "missing_url" });
    return;
  }

  let target;
  try {
    target = await assertSafeFetchUrl(rawUrl);
  } catch {
    res.status(400).json({ error: "invalid_url" });
    return;
  }

  try {
    const { html, finalUrl } = await fetchHtml(target.url.href);
    const preview = await parsePreview(html, finalUrl);

    if (!preview.title && !preview.description && !preview.image) {
      res.setHeader("Cache-Control", "public, s-maxage=300");
      res.status(404).json({ error: "no_preview" });
      return;
    }

    res.setHeader("Cache-Control", "public, s-maxage=3600");
    res.status(200).json(preview);
  } catch (err) {
    const code = err instanceof Error ? err.message : "fetch_failed";
    res.setHeader("Cache-Control", "no-store");
    if (code === "unsafe_url" || code === "redirect") {
      res.status(400).json({ error: "invalid_url" });
      return;
    }
    if (code === "html_too_large") {
      res.status(413).json({ error: "html_too_large" });
      return;
    }
    res.status(502).json({ error: "fetch_failed" });
  }
}
