import { SimplePool, type Event, type Filter } from "nostr-tools";
import {
  parseKind0Profile,
  type Kind0Profile,
  type NostrIdentity,
} from "./identity";
import { VERTEX_RELAY } from "./profile-search";

export type LocatedEvent = Event & { seenOn: string[] };

/** NIP-50 kind 1 search. Vertex indexes profiles, not notes. */
export const NOTE_SEARCH_RELAYS = [
  "wss://relay.noswhere.com",
  "wss://search.nos.today",
];

export const DEFAULT_RELAYS = [
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://pyramid.fiatjaf.com",
  "wss://relay.ditto.pub",
];

export const FALLBACK_RELAYS = ["wss://relay.damus.io"];

const DISCOVERY_RELAYS = [VERTEX_RELAY, "wss://purplepag.es"];

/**
 * Kind 0 lookups for note mentions. Vertex is omitted on purpose: its
 * 200 events/min cap is shared with NIP-50 profile search.
 */
const PROFILE_METADATA_RELAYS = [
  "wss://purplepag.es",
  ...DEFAULT_RELAYS,
  ...FALLBACK_RELAYS,
];
const MAX_PROFILE_HINT_RELAYS = 8;

export const RELAY_MAX_WAIT_MS = 4500;
export const NOTE_LIMIT = 200;
export const AUTHOR_CHUNK_SIZE = 256;

export const formatCreateAtDate = (unixTimestamp: number) => {
  const date = new Date(unixTimestamp * 1000);
  const formattedDate = date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return `${formattedDate} @ ${formattedTime}`;
};

export const convertDateToUnixTimestamp = (date: string) =>
  new Date(date).getTime() / 1000;

export const chunkArray = <T,>(array: T[], chunkSize: number) => {
  const chunkedArray: T[][] = [];

  for (let i = 0; i < array.length; i += chunkSize) {
    chunkedArray.push(array.slice(i, i + chunkSize));
  }

  return chunkedArray;
};

function dedupeRelays(urls: string[]): string[] {
  const seen = new Set<string>();
  const relays: string[] = [];
  for (const url of urls) {
    if (!url.startsWith("wss://") || seen.has(url)) continue;
    seen.add(url);
    relays.push(url);
  }
  return relays;
}

export function mergeLocatedEvents(events: LocatedEvent[]): LocatedEvent[] {
  const byId = new Map<string, LocatedEvent>();
  for (const event of events) {
    const prev = byId.get(event.id);
    if (!prev) {
      byId.set(event.id, { ...event, seenOn: [...event.seenOn] });
      continue;
    }
    const seenOn = dedupeRelays([...prev.seenOn, ...event.seenOn]);
    if (event.created_at > prev.created_at) {
      byId.set(event.id, { ...event, seenOn });
    } else {
      prev.seenOn = seenOn;
    }
  }
  return [...byId.values()].sort((a, b) => b.created_at - a.created_at);
}

export async function queryRelays(
  relays: string[],
  filter: Filter
): Promise<LocatedEvent[]> {
  const unique = dedupeRelays(relays);
  if (unique.length === 0) return [];

  const pool = new SimplePool();

  try {
    const settled = await Promise.allSettled(
      unique.map(async (relay) => {
        const events = await pool.querySync([relay], filter, {
          maxWait: RELAY_MAX_WAIT_MS,
        });
        return events.map(
          (event): LocatedEvent => ({ ...event, seenOn: [relay] })
        );
      })
    );

    const located: LocatedEvent[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") located.push(...result.value);
    }
    return mergeLocatedEvents(located);
  } catch {
    return [];
  } finally {
    pool.destroy();
  }
}

function parseRelayListEvent(event: Event): string[] {
  const write: string[] = [];
  const read: string[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== "r" || typeof tag[1] !== "string") continue;
    const url = tag[1].trim();
    if (!url.startsWith("wss://")) continue;

    if (tag[2] === "read") read.push(url);
    else write.push(url);
  }

  return dedupeRelays([...write, ...read]);
}

const relaysCache: Record<string, string[]> = {};

export const getUserRelays = async (
  identity: NostrIdentity
): Promise<string[]> => {
  if (relaysCache[identity.pubkey]) {
    return relaysCache[identity.pubkey];
  }

  const discovery = dedupeRelays([
    ...identity.relayHints,
    ...DISCOVERY_RELAYS,
  ]);
  const events = await queryRelays(discovery, {
    kinds: [10002],
    authors: [identity.pubkey],
    limit: 1,
  });
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
  const relayUrls = latest ? parseRelayListEvent(latest) : [];

  if (relayUrls.length > 0) {
    relaysCache[identity.pubkey] = relayUrls;
  }

  return relayUrls;
};

export const getUserReactionEventIds = async ({
  identity,
  since,
  until,
}: {
  identity: NostrIdentity;
  since?: number;
  until?: number;
}): Promise<string[]> => {
  const userRelays = await getUserRelays(identity);
  const relays =
    userRelays.length > 0
      ? dedupeRelays([...userRelays, ...DEFAULT_RELAYS])
      : [...DEFAULT_RELAYS, ...FALLBACK_RELAYS];
  const reactionEvents = await queryRelays(relays, {
    kinds: [7],
    authors: [identity.pubkey],
    since,
    until,
  });

  return reactionEvents
    .map((event) => event.tags.findLast((tag) => tag[0] === "e")?.[1])
    .filter((id): id is string => Boolean(id));
};

const followedPubkeysCache: Record<string, string[]> = {};

export const getFollowedPubkeys = async (pubkey: string) => {
  if (followedPubkeysCache[pubkey]) {
    return followedPubkeysCache[pubkey];
  }

  const contactListEvents = await queryRelays(DISCOVERY_RELAYS, {
    kinds: [3],
    authors: [pubkey],
    limit: 1,
  });
  const latest = contactListEvents.sort((a, b) => b.created_at - a.created_at)[0];
  const followedPubkeys =
    latest?.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]) ?? [];

  if (followedPubkeys.length > 0) {
    followedPubkeysCache[pubkey] = followedPubkeys;
  }

  return followedPubkeys;
};

export async function findNotes(
  relays: string[],
  filter: Filter
): Promise<LocatedEvent[]> {
  return queryRelays(relays, filter);
}

/** Case-insensitive substring match on note content. Relays often ignore or reject NIP-50 `search`. */
export function matchesSearchQuery(
  note: { content: string },
  query: string
): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return note.content.toLowerCase().includes(term);
}

const kind0Cache = new Map<string, Kind0Profile | null>();
const kind0Inflight = new Map<string, Promise<void>>();
const kind0TriedHints = new Map<string, Set<string>>();
const PROFILE_METADATA_RELAY_SET = new Set(PROFILE_METADATA_RELAYS);

function extraProfileHints(relayHints: string[]): string[] {
  return dedupeRelays(relayHints).filter(
    (url) => !PROFILE_METADATA_RELAY_SET.has(url)
  );
}

function rememberTriedHints(
  pubkey: string,
  relayHints: string[],
  queriedRelays: Set<string>
) {
  const tried = kind0TriedHints.get(pubkey) ?? new Set();
  for (const url of extraProfileHints(relayHints)) {
    if (queriedRelays.has(url)) tried.add(url);
  }
  kind0TriedHints.set(pubkey, tried);
}

function needsKind0Fetch(pubkey: string, relayHints: string[]): boolean {
  const cached = kind0Cache.get(pubkey);
  if (cached?.picture || cached?.displayName || cached?.nip05) return false;
  if (!kind0Cache.has(pubkey)) return true;
  const tried = kind0TriedHints.get(pubkey);
  return extraProfileHints(relayHints).some((url) => !tried?.has(url));
}

function profileRelaysFor(
  identities: { pubkey: string; relayHints: string[] }[]
): string[] {
  const base = dedupeRelays(PROFILE_METADATA_RELAYS);
  const extra = dedupeRelays(
    identities.flatMap((identity) => {
      const tried = kind0TriedHints.get(identity.pubkey);
      return extraProfileHints(identity.relayHints).filter(
        (url) => !tried?.has(url)
      );
    })
  ).slice(0, MAX_PROFILE_HINT_RELAYS);
  return [...base, ...extra];
}

async function loadKind0Profiles(
  identities: { pubkey: string; relayHints: string[] }[]
): Promise<void> {
  const relays = profileRelaysFor(identities);
  const queriedRelays = new Set(relays);
  for (const { pubkey, relayHints } of identities) {
    rememberTriedHints(pubkey, relayHints, queriedRelays);
  }
  const latest = new Map<string, LocatedEvent>();

  for (const authors of chunkArray(
    identities.map((identity) => identity.pubkey),
    AUTHOR_CHUNK_SIZE
  )) {
    // Relays treat `limit` as a total event cap, not one kind-0 per author,
    // and may also apply their own default. Re-query whoever is still
    // missing until a pass adds no new profiles.
    let remaining = authors;
    for (let pass = 0; pass < 4 && remaining.length > 0; pass++) {
      const events = await queryRelays(relays, {
        kinds: [0],
        authors: remaining,
        limit: remaining.length,
      });

      for (const event of events) {
        if (event.kind !== 0) continue;
        const pubkey = event.pubkey.toLowerCase();
        const prev = latest.get(pubkey);
        if (!prev || event.created_at > prev.created_at) {
          latest.set(pubkey, event);
        }
      }

      const next = remaining.filter((pubkey) => !latest.has(pubkey));
      if (next.length === remaining.length) break;
      remaining = next;
    }
  }

  for (const { pubkey } of identities) {
    const event = latest.get(pubkey);
    kind0Cache.set(pubkey, event ? parseKind0Profile(event) : null);
  }
}

export async function getKind0Profiles(
  identities: { pubkey: string; relayHints?: string[] }[]
): Promise<Record<string, Kind0Profile>> {
  const byPubkey = new Map<string, string[]>();
  for (const identity of identities) {
    const pubkey = identity.pubkey.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey)) continue;
    const relays = byPubkey.get(pubkey) ?? [];
    for (const url of identity.relayHints ?? []) {
      if (!relays.includes(url)) relays.push(url);
    }
    byPubkey.set(pubkey, relays);
  }

  for (;;) {
    const toFetch: { pubkey: string; relayHints: string[] }[] = [];
    const waitFor: Promise<void>[] = [];

    for (const [pubkey, relayHints] of byPubkey) {
      if (!needsKind0Fetch(pubkey, relayHints)) continue;
      const pending = kind0Inflight.get(pubkey);
      if (pending) {
        waitFor.push(pending);
        continue;
      }
      toFetch.push({ pubkey, relayHints });
    }

    if (toFetch.length === 0 && waitFor.length === 0) break;

    if (toFetch.length > 0) {
      const fetchPromise = loadKind0Profiles(toFetch).finally(() => {
        for (const { pubkey } of toFetch) kind0Inflight.delete(pubkey);
      });
      for (const { pubkey } of toFetch) kind0Inflight.set(pubkey, fetchPromise);
      waitFor.push(fetchPromise);
    }

    await Promise.all(waitFor);
  }

  const found: Record<string, Kind0Profile> = {};
  for (const pubkey of byPubkey.keys()) {
    const profile = kind0Cache.get(pubkey);
    if (profile) {
      found[pubkey] = profile;
      continue;
    }
    // Drop misses so a later search can retry after a relay timeout.
    kind0Cache.delete(pubkey);
    kind0TriedHints.delete(pubkey);
  }
  return found;
}
