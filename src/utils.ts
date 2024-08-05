import { SimplePool } from "nostr-tools/pool";
import * as nip19 from "nostr-tools/nip19";
import type { Event } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";

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

export const decodeNpub = (npub: string) => {
  const { type, data } = nip19.decode(npub);

  if (type === "npub") {
    return data as string;
  }
};

export const chunkArray = (array: string[], chunkSize: number) => {
  const chunkedArray = [];
  const length = array.length;

  for (let i = 0; i < length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    chunkedArray.push(chunk);
  }

  return chunkedArray;
};

const findOneFromRelays = async (
  relays: string[],
  filter: Filter
): Promise<Event | null> => {
  let pool;

  try {
    pool = new SimplePool();

    return await pool.get(relays, filter);
  } finally {
    if (pool) {
      try {
        pool.close(relays);
      } catch {
        // fail silently for errors that happen when closing the pool
      }
    }
  }
};

export const findFromRelays = async (
  relays: string[],
  filter: Filter
): Promise<Event[]> => {
  let pool;

  try {
    pool = new SimplePool();

    return await pool.querySync(relays, filter);
  } finally {
    if (pool) {
      try {
        pool.close(relays);
      } catch {
        // fail silently for errors that happen when closing the pool
      }
    }
  }
};

const relaysCache: Record<string, string[]> = {};

const getUserRelays = async (pubkey: string) => {
  const relays = [
    "wss://relay.nostr.band",
    "wss://purplepag.es",
    "wss://nostr.wine",
    "wss://relay.damus.io",
  ];

  if (relaysCache[pubkey]) {
    return relaysCache[pubkey];
  }

  const userRelayEvent = await findOneFromRelays(relays, {
    kinds: [10002],
    authors: [pubkey],
  });
  const relayUrls = userRelayEvent
    ? userRelayEvent.tags.map(([, relay]) => relay)
    : [];

  if (relayUrls.length > 0) {
    relaysCache[pubkey] = relayUrls;
  }

  return relayUrls;
};

export const getUserReactionEventIds = async ({
  pubkey,
  since,
  until,
}: {
  pubkey: string;
  since?: number;
  until?: number;
}): Promise<string[]> => {
  const userRelays = await getUserRelays(pubkey);
  const backupRelays = [
    "wss://relay.nostr.band",
    "wss://nostr.wine",
    "wss://relay.damus.io",
  ];
  const relays = userRelays.length > 0 ? userRelays : backupRelays;
  const reactionEvents = await findFromRelays(relays, {
    kinds: [7],
    authors: [pubkey],
    since,
    until,
  });

  return reactionEvents
    .map(
      (event) => (event.tags.reverse().find(([key]) => key === "e") ?? [])[1]
    )
    .filter((id) => id !== undefined);
};

const followedPubkeysCache: Record<string, string[]> = {};

export const getFollowedPubkeys = async (pubkey: string) => {
  const relays = [
    "wss://relay.nostr.band",
    "wss://nostr.wine",
    "wss://relay.damus.io",
  ];

  if (followedPubkeysCache[pubkey]) {
    return followedPubkeysCache[pubkey];
  }

  const contactListEvent = await findOneFromRelays(relays, {
    kinds: [3],
    authors: [pubkey],
  });
  const followedPubkeys =
    contactListEvent?.tags.map(([, pubkey]) => pubkey) ?? [];

  if (followedPubkeys.length > 0) {
    followedPubkeysCache[pubkey] = followedPubkeys;
  }

  return followedPubkeys;
};
