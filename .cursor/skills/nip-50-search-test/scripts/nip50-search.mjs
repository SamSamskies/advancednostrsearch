#!/usr/bin/env node
/**
 * Probe NIP-50 search on one or more relays.
 * Usage:
 *   node nip50-search.mjs --query pullup --npub npub1...
 *   node nip50-search.mjs --query pullup --author <hex> --relay wss://relay.noswhere.com
 */
import { SimplePool } from "nostr-tools";
import * as nip19 from "nostr-tools/nip19";

const DEFAULT_RELAYS = [
  "wss://relay.ditto.pub",
  "wss://relay.noswhere.com",
  "wss://search.nos.today",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

function allArgs(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) {
      values.push(process.argv[++i]);
    }
  }
  return values;
}

const query = (arg("query") ?? "").trim();
if (!query) {
  console.error("Missing --query");
  process.exit(1);
}

let author = arg("author")?.toLowerCase();
const npub = arg("npub");
if (!author && npub) {
  let decoded;
  try {
    decoded = nip19.decode(npub);
  } catch {
    console.error("--npub is not a valid bech32 npub");
    process.exit(1);
  }
  if (decoded.type !== "npub") {
    console.error("--npub must decode to npub");
    process.exit(1);
  }
  author = decoded.data;
}

const relays = allArgs("relay");
const targets = relays.length > 0 ? relays : DEFAULT_RELAYS;
const limit = Number(arg("limit", "20"));
const maxWait = Number(arg("max-wait", "6000"));

const filter = { kinds: [1], search: query, limit };
if (author) {
  if (!/^[0-9a-f]{64}$/.test(author)) {
    console.error("--author must be 64-char hex");
    process.exit(1);
  }
  filter.authors = [author];
}

const pool = new SimplePool();

async function nip11(relay) {
  try {
    const http = relay.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    const res = await fetch(http, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const j = await res.json();
    return {
      name: j.name,
      software: j.software,
      version: j.version,
      supported_nips: j.supported_nips,
    };
  } catch (e) {
    return { error: e.message };
  }
}

const results = [];
for (const relay of targets) {
  const started = Date.now();
  let events = [];
  let error = null;
  try {
    events = await pool.querySync([relay], filter, { maxWait });
  } catch (e) {
    error = e.message;
  }
  const needle = query.toLowerCase();
  const contentHits = events.filter((e) =>
    (e.content ?? "").toLowerCase().includes(needle)
  );
  results.push({
    relay,
    ms: Date.now() - started,
    error,
    nip11: await nip11(relay),
    returned: events.length,
    contentIncludesQuery: contentHits.length,
    notes: events.slice(0, 8).map((e) => ({
      id: e.id,
      created_at: e.created_at,
      iso: new Date(e.created_at * 1000).toISOString(),
      contentPreview: (e.content ?? "").slice(0, 120),
      contentMatch: (e.content ?? "").toLowerCase().includes(needle),
    })),
  });
}

pool.destroy();
console.log(
  JSON.stringify({ query, author: author ?? null, filter, results }, null, 2)
);
