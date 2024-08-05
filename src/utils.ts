import { nip19, SimplePool, Filter, Event } from "nostr-tools";

export const formatCreateAtDate = (unixTimestamp: number) => {
  const date = new Date(unixTimestamp * 1000);
  const formattedDate = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const formattedTime = date.toLocaleTimeString(undefined, {
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
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Something went wrong :("
    );
    return null;
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
}) => {
  const userRelays = await getUserRelays(pubkey);
  const backupRelays = [
    "wss://relay.nostr.band",
    "wss://nostr.wine",
    "wss://relay.damus.io",
  ];
  const relays = userRelays.length > 0 ? userRelays : backupRelays;
  let pool;

  try {
    pool = new SimplePool();
    const reactionEvents = await pool.list(relays, [
      {
        kinds: [7],
        authors: [pubkey],
        since,
        until,
      },
    ]);

    return reactionEvents
      .map(
        (event) => (event.tags.reverse().find(([key]) => key === "e") ?? [])[1]
      )
      .filter((id) => id !== undefined);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Something went wrong :("
    );
    return [];
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
