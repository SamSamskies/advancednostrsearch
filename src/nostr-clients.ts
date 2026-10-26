import { nip19 } from "nostr-tools";
import type { LocatedEvent } from "./nostr";

export type ClientPlatform = "android" | "ios" | "web";

export type OpenInKind = "note" | "profile";

export type NostrClient = {
  id: string;
  name: string;
  platform: "native" | "web" | "ios" | "android";
  url: string;
  /** Defaults to `url`. Use when the profile path differs (e.g. Primal `/p/` vs `/e/`). */
  profileUrl?: string;
  /** Fallback for iOS apps whose custom scheme fails when not installed. */
  appStoreUrl?: string;
};

/** Keep nevents shareable; extra relays mostly bloat the bech32 string. */
export const MAX_RELAY_HINTS = 3;

/**
 * Kind-1 clients, ordered like njump: default handler, then native apps,
 * then web. Platform filtering happens in `clientsForPlatform`.
 * The default nostr: handler is omitted on desktop, matching Trending Nostr.
 */
export const NOSTR_CLIENTS: NostrClient[] = [
  {
    id: "native",
    name: "Your default app",
    platform: "native",
    url: "nostr:{code}",
  },
  // HTTPS on iOS: Universal Links open the app when installed, otherwise a
  // real webpage. Custom schemes (`damus:`, `nostur:`) make Safari show
  // "address is invalid" when the app is missing — no App Store fallback.
  {
    id: "damus",
    name: "Damus",
    platform: "ios",
    url: "https://damus.io/{code}",
  },
  {
    id: "nostur",
    name: "Nostur",
    platform: "ios",
    url: "nostur:{code}",
    appStoreUrl: "https://apps.apple.com/app/id1672780508",
  },
  {
    id: "primal-ios",
    name: "Primal",
    platform: "ios",
    url: "https://primal.net/e/{code}",
    profileUrl: "https://primal.net/p/{code}",
  },
  {
    id: "amethyst",
    name: "Amethyst",
    platform: "android",
    url: "intent:{code}#Intent;scheme=nostr;package=com.vitorpamplona.amethyst;end;",
  },
  {
    id: "primal-android",
    name: "Primal",
    platform: "android",
    url: "intent:{code}#Intent;scheme=nostr;package=net.primal.android;end;",
  },
  {
    id: "voyage",
    name: "Voyage",
    platform: "android",
    url: "intent:{code}#Intent;scheme=nostr;package=com.dluvian.voyage;end;",
  },
  {
    id: "jumble",
    name: "Jumble",
    platform: "web",
    url: "https://jumble.social/{code}",
  },
  {
    id: "primal-web",
    name: "Primal",
    platform: "web",
    url: "https://primal.net/e/{code}",
    profileUrl: "https://primal.net/p/{code}",
  },
  {
    id: "nostrich",
    name: "Nostrich",
    platform: "web",
    url: "https://nostrich.org/e/{code}",
    profileUrl: "https://nostrich.org/p/{code}",
  },
  {
    id: "ditto",
    name: "Ditto",
    platform: "web",
    url: "https://ditto.pub/{code}",
  },
  {
    id: "quotestr",
    name: "Quotestr",
    platform: "web",
    url: "https://quotestr.vercel.app/?nostrId={code}",
  },
  {
    id: "yakihonne",
    name: "YakiHonne",
    platform: "web",
    url: "https://yakihonne.com/{code}",
  },
  {
    id: "njump",
    name: "njump",
    platform: "web",
    url: "https://njump.me/{code}",
  },
];

export function detectClientPlatform(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): ClientPlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iPad|iPhone|iPod/i.test(userAgent)) return "ios";
  return "web";
}

export function encodeNevent(note: LocatedEvent): string {
  return nip19.neventEncode({
    id: note.id,
    author: note.pubkey,
    kind: note.kind,
    relays: note.seenOn.slice(0, MAX_RELAY_HINTS),
  });
}

export function clientHref(
  client: NostrClient,
  code: string,
  kind: OpenInKind = "note",
): string {
  const template =
    kind === "profile" ? (client.profileUrl ?? client.url) : client.url;
  return template.replaceAll("{code}", code);
}

/**
 * href for an Open In row. Custom-scheme iOS apps with an App Store page
 * link there instead, so a missing app opens the store rather than an
 * invalid `nostur:` address.
 */
export function clientOpenHref(
  client: NostrClient,
  code: string,
  kind: OpenInKind = "note",
): string {
  const href = clientHref(client, code, kind);
  if (client.appStoreUrl && !isWebClientHref(href)) {
    return client.appStoreUrl;
  }
  return href;
}

export function clientsForPlatform(platform: ClientPlatform): NostrClient[] {
  const eligible = NOSTR_CLIENTS.filter((client) => {
    if (client.platform === "native" && platform === "web") return false;
    return (
      client.platform === "native" ||
      client.platform === "web" ||
      client.platform === platform
    );
  });

  const seen = new Set<string>();
  const clients: NostrClient[] = [];
  for (const client of eligible) {
    if (seen.has(client.name)) continue;
    seen.add(client.name);
    clients.push(client);
  }
  return clients;
}

export function isWebClientHref(href: string): boolean {
  return href.startsWith("https://") || href.startsWith("http://");
}
