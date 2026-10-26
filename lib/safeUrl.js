import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";

function normalizeHostname(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

/** Extract trailing IPv4 from an IPv4-mapped IPv6 literal (dotted or hex tail). */
function mappedIpv4FromIpv6(host) {
  const lower = normalizeHostname(host);
  const dotted = /(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(lower);
  if (dotted) return dotted[1];

  const hex = /(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(lower);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/** Block localhost, RFC1918, link-local, and cloud-metadata targets (SSRF). */
export function isPrivateOrLocalHostname(hostname) {
  const host = normalizeHostname(hostname);
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
    const mapped = mappedIpv4FromIpv6(host);
    if (mapped) return isPrivateOrLocalHostname(mapped);
  }

  return false;
}

function isIpLiteral(hostname) {
  const host = normalizeHostname(hostname);
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * Resolve hostname once; reject if any answer is private/loopback.
 * @param {string} hostname
 * @returns {Promise<{ address: string, family: number }>}
 */
async function resolvePublicAddress(hostname) {
  const host = normalizeHostname(hostname);

  if (isIpLiteral(host)) {
    if (isPrivateOrLocalHostname(host)) throw new Error("unsafe_url");
    return { address: host, family: host.includes(":") ? 6 : 4 };
  }

  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("unsafe_url");
  }
  if (!addresses.length) throw new Error("unsafe_url");
  for (const { address } of addresses) {
    if (isPrivateOrLocalHostname(address)) {
      throw new Error("unsafe_url");
    }
  }
  return addresses[0];
}

/**
 * Parse and validate an absolute http(s) URL for server-side fetches.
 * Returns a pinned connect address so callers can avoid a second DNS lookup (rebinding).
 * @param {string} value
 * @param {string} [base]
 * @returns {Promise<{ url: URL, address: string, family: number }>}
 */
export async function assertSafeFetchUrl(value, base) {
  let parsed;
  try {
    parsed = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new Error("unsafe_url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("unsafe_url");
  }
  if (parsed.username || parsed.password) {
    throw new Error("unsafe_url");
  }
  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error("unsafe_url");
  }
  const { address, family } = await resolvePublicAddress(parsed.hostname);
  return { url: parsed, address, family };
}

/**
 * HTTP(S) GET that connects to the pre-validated IP while sending Host / TLS SNI
 * for the original hostname (closes DNS-rebinding TOCTOU).
 * @param {{ url: URL, address: string }} target
 * @param {{ signal?: AbortSignal, headers?: Record<string, string> }} [init]
 */
export function pinnedFetch(target, init = {}) {
  const { url, address } = target;
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const sniHost = url.hostname.replace(/^\[|\]$/g, "");

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: address,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          ...(init.headers || {}),
          Host: url.host,
        },
        servername: isHttps ? sniHost : undefined,
        signal: init.signal,
      },
      (incoming) => {
        const body = new ReadableStream({
          start(controller) {
            incoming.on("data", (chunk) => {
              const bytes =
                chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk);
              try {
                controller.enqueue(bytes);
              } catch {
                incoming.destroy();
              }
            });
            incoming.on("end", () => {
              try {
                controller.close();
              } catch {
                // already closed/errored
              }
            });
            incoming.on("error", (err) => {
              try {
                controller.error(err);
              } catch {
                // already closed/errored
              }
            });
          },
          cancel() {
            incoming.destroy();
          },
        });

        resolve({
          status: incoming.statusCode || 0,
          get ok() {
            const s = incoming.statusCode || 0;
            return s >= 200 && s < 300;
          },
          headers: {
            get(name) {
              const v = incoming.headers[String(name).toLowerCase()];
              if (v == null) return null;
              return Array.isArray(v) ? v.join(", ") : v;
            },
          },
          body,
          async text() {
            const reader = body.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const total = chunks.reduce((n, c) => n + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
              merged.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return new TextDecoder("utf-8").decode(merged);
          },
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}
