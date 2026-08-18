import { nip19 } from "nostr-tools";

/** NIP-27 npub / nprofile, with or without the `nostr:` prefix. */
export const mentionRegex =
  /((?:nostr:)?n(?:pub|profile)1[02-9ac-hj-np-z]+)/gi;

export type Mention = {
  code: string;
  pubkey: string;
  relayHints: string[];
};

export type MentionIdentity = {
  pubkey: string;
  relayHints: string[];
};

function stripNostrPrefix(raw: string): string {
  return raw.toLowerCase().startsWith("nostr:") ? raw.slice(6) : raw;
}

export function parseMention(raw: string): Mention | null {
  const input = raw.trim();
  if (!/^(?:nostr:)?n(?:pub|profile)1[02-9ac-hj-np-z]+$/i.test(input)) {
    return null;
  }

  const code = stripNostrPrefix(input).toLowerCase();

  try {
    const decoded = nip19.decode(code);
    if (decoded.type === "npub") {
      return { code, pubkey: decoded.data.toLowerCase(), relayHints: [] };
    }
    if (decoded.type === "nprofile") {
      return {
        code,
        pubkey: decoded.data.pubkey.toLowerCase(),
        relayHints: (decoded.data.relays ?? [])
          .map((url) => url.replace(/\/+$/, ""))
          .filter((url) => url.startsWith("wss://")),
      };
    }
  } catch {
    return null;
  }

  return null;
}

export function collectMentionIdentities(
  contents: string[]
): MentionIdentity[] {
  const byPubkey = new Map<string, string[]>();

  for (const content of contents) {
    for (const match of content.matchAll(new RegExp(mentionRegex.source, "gi"))) {
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

export function mentionLabel(pubkey: string, displayName?: string): string {
  const name = displayName?.trim();
  if (name) return `@${name}`;

  try {
    return `@${nip19.npubEncode(pubkey).slice(0, 16)}…`;
  } catch {
    return "@npub…";
  }
}

export function njumpProfileHref(code: string): string {
  return `https://njump.me/${code}`;
}
