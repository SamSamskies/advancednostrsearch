import { nip19, SimplePool, type Event } from "nostr-tools";
import { isNip05 } from "nostr-tools/nip05";
import {
  looksLikePrivateKey,
  parseKind0Profile,
  type Kind0Profile,
} from "./identity";

/** Vertex relay — NIP-50 profile search is free here (see vertexlab.io/docs). */
export const VERTEX_RELAY = "wss://relay.vertexlab.io";

export const SEARCH_MIN_CHARS = 4;
export const SEARCH_RESULT_LIMIT = 8;
export const SEARCH_DEBOUNCE_MS = 280;
export const SEARCH_MAX_WAIT_MS = 4500;
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const BECH32_PREFIX = /^n(pub|profile|sec)1/i;

export type ProfileSuggestion = Kind0Profile & {
  pubkey: string;
  npub: string;
  nip05?: string;
};

type CacheEntry = {
  results: ProfileSuggestion[];
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ProfileSuggestion[]>>();

function cacheKey(term: string, limit: number): string {
  return `${term.trim().toLowerCase()}\0${limit}`;
}

function readCache(key: string): ProfileSuggestion[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SEARCH_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.results;
}

function writeCache(key: string, results: ProfileSuggestion[]): void {
  cache.set(key, { results, fetchedAt: Date.now() });
}

export function shouldSuggestProfiles(raw: string): boolean {
  const input = raw.trim();
  if (input.length < SEARCH_MIN_CHARS) return false;
  if (looksLikePrivateKey(input)) return false;
  if (HEX_PUBKEY.test(input)) return false;
  if (isNip05(input)) return false;

  let code = input;
  if (code.toLowerCase().startsWith("nostr:")) {
    code = code.slice(6);
  }
  if (BECH32_PREFIX.test(code)) return false;

  return true;
}

async function fetchProfilesFromRelay(
  term: string,
  limit: number
): Promise<ProfileSuggestion[]> {
  const pool = new SimplePool();

  try {
    const events = await pool.querySync(
      [VERTEX_RELAY],
      {
        kinds: [0],
        search: term,
        limit,
      },
      { maxWait: SEARCH_MAX_WAIT_MS }
    );

    const byPubkey = new Map<string, Event>();
    for (const event of events) {
      const prev = byPubkey.get(event.pubkey);
      if (!prev || event.created_at > prev.created_at) {
        byPubkey.set(event.pubkey, event);
      }
    }

    return [...byPubkey.values()].map((event) => {
      const profile = parseKind0Profile(event);
      return {
        pubkey: event.pubkey,
        npub: nip19.npubEncode(event.pubkey),
        ...profile,
      };
    });
  } catch {
    return [];
  } finally {
    pool.destroy();
  }
}

function loadProfiles(
  term: string,
  limit: number
): Promise<ProfileSuggestion[]> {
  const key = cacheKey(term, limit);
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchProfilesFromRelay(term, limit)
      .then((results) => {
        writeCache(key, results);
        return results;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }

  return pending;
}

export async function searchProfiles(
  query: string,
  options?: { limit?: number; signal?: AbortSignal }
): Promise<ProfileSuggestion[]> {
  const term = query.trim();
  if (!shouldSuggestProfiles(term)) return [];
  if (options?.signal?.aborted) return [];

  const limit = options?.limit ?? SEARCH_RESULT_LIMIT;
  const results = await loadProfiles(term, limit);
  if (options?.signal?.aborted) return [];
  return [...results];
}

export function suggestionValue(suggestion: ProfileSuggestion): string {
  return suggestion.npub;
}
