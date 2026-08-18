import { SimplePool, type Event, type Filter } from "nostr-tools";
import { VERTEX_RELAY } from "./profile-search";
import type { NostrIdentity } from "./identity";

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
