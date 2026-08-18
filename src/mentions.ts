import { nip19 } from "nostr-tools";

/** NIP-27 identifiers, with or without the `nostr:` prefix. */
export const nostrUriRegex =
  /((?:nostr:)?n(?:pub|profile|event|ote)1[02-9ac-hj-np-z]+)/gi;

const NOSTR_URI =
  /^(?:nostr:)?n(?:pub|profile|event|ote)1[02-9ac-hj-np-z]+$/i;

export type Mention = {
  type: "profile";
  code: string;
  pubkey: string;
  relayHints: string[];
};

export type NoteRef = {
  type: "note";
  code: string;
};

export type NostrEntity = Mention | NoteRef;

export type MentionIdentity = {
  pubkey: string;
  relayHints: string[];
};

function stripNostrPrefix(raw: string): string {
  return raw.toLowerCase().startsWith("nostr:") ? raw.slice(6) : raw;
}

export function parseNostrEntity(raw: string): NostrEntity | null {
  const input = raw.trim();
  if (!NOSTR_URI.test(input)) return null;

  const code = stripNostrPrefix(input).toLowerCase();

  try {
    const decoded = nip19.decode(code);
    if (decoded.type === "npub") {
      return {
        type: "profile",
        code,
        pubkey: decoded.data.toLowerCase(),
        relayHints: [],
      };
    }
    if (decoded.type === "nprofile") {
      return {
        type: "profile",
        code,
        pubkey: decoded.data.pubkey.toLowerCase(),
        relayHints: (decoded.data.relays ?? [])
          .map((url) => url.replace(/\/+$/, ""))
          .filter((url) => url.startsWith("wss://")),
      };
    }
    if (decoded.type === "note" || decoded.type === "nevent") {
      return { type: "note", code };
    }
  } catch {
    return null;
  }

  return null;
}

export function parseMention(raw: string): Mention | null {
  const entity = parseNostrEntity(raw);
  return entity?.type === "profile" ? entity : null;
}

export function collectMentionIdentities(
  contents: string[]
): MentionIdentity[] {
  const byPubkey = new Map<string, string[]>();

  for (const content of contents) {
    for (const match of content.matchAll(new RegExp(nostrUriRegex.source, "gi"))) {
      const mention = parseMention(match[0]);
      if (!mention) continue;

      const relays = byPubkey.get(mention.pubkey) ?? [];
      for (const url of mention.relayHints) {
        if (!relays.includes(url)) relays.push(url);
      }
      byPubkey.set(mention.pubkey, relays);
    }
  }

  return [...byPubkey.entries()].map(([pubkey, relayHints]) => ({
    pubkey,
    relayHints,
  }));
}

export function profileLabel(pubkey: string, displayName?: string): string {
  const name = displayName?.trim();
  if (name) return name;

  try {
    return `${nip19.npubEncode(pubkey).slice(0, 16)}…`;
  } catch {
    return "npub…";
  }
}

export function mentionLabel(pubkey: string, displayName?: string): string {
  return `@${profileLabel(pubkey, displayName)}`;
}

export function noteRefLabel(code: string): string {
  return `${code.slice(0, 16)}…`;
}

export function njumpHref(code: string): string {
  return `https://njump.me/${code}`;
}

export function addIdentities(
  identities: MentionIdentity[],
  extra: MentionIdentity[]
): MentionIdentity[] {
  const byPubkey = new Map<string, string[]>();
  for (const identity of [...identities, ...extra]) {
    const pubkey = identity.pubkey.trim().toLowerCase();
    if (!pubkey) continue;
    const relays = byPubkey.get(pubkey) ?? [];
    for (const url of identity.relayHints) {
      if (!relays.includes(url)) relays.push(url);
    }
    byPubkey.set(pubkey, relays);
  }
  return [...byPubkey.entries()].map(([pubkey, relayHints]) => ({
    pubkey,
    relayHints,
  }));
}

export function isUnmodifiedLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
