import { nip19, type Event } from "nostr-tools";
import { isNip05, queryProfile } from "nostr-tools/nip05";

export type NostrIdentity = {
  pubkey: string;
  relayHints: string[];
};

export type Kind0Profile = {
  picture?: string;
  displayName?: string;
  nip05?: string;
};

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

export class IdentityError extends Error {
  constructor(
    message = "Enter a name, npub, nprofile, NIP-05 address, or pubkey."
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

export class Nip05Error extends Error {
  constructor(message = "NIP-05 address not found.") {
    super(message);
    this.name = "Nip05Error";
  }
}

export class PrivateKeyError extends Error {
  constructor(
    message = "That looks like a private key (nsec). Never paste an nsec here."
  ) {
    super(message);
    this.name = "PrivateKeyError";
  }
}

export function looksLikePrivateKey(raw: string): boolean {
  const input = raw.trim();
  if (!input) return false;

  let code = input;
  if (code.toLowerCase().startsWith("nostr:")) {
    code = code.slice(6);
  }

  if (/^nsec1[02-9ac-hj-np-z]+$/i.test(code)) return true;

  try {
    return nip19.decode(code).type === "nsec";
  } catch {
    return false;
  }
}

function parseLocalIdentity(raw: string): NostrIdentity | null {
  const input = raw.trim();
  if (!input) return null;

  if (HEX_PUBKEY.test(input)) {
    return { pubkey: input.toLowerCase(), relayHints: [] };
  }

  let code = input;
  if (code.toLowerCase().startsWith("nostr:")) {
    code = code.slice(6);
  }

  try {
    const decoded = nip19.decode(code);
    if (decoded.type === "nsec") {
      throw new PrivateKeyError();
    }
    if (decoded.type === "npub") {
      return { pubkey: decoded.data, relayHints: [] };
    }
    if (decoded.type === "nprofile") {
      return {
        pubkey: decoded.data.pubkey,
        relayHints: (decoded.data.relays ?? []).filter((r) =>
          r.startsWith("wss://")
        ),
      };
    }
  } catch (error) {
    if (error instanceof PrivateKeyError) throw error;
  }

  return null;
}

export async function resolveIdentity(raw: string): Promise<NostrIdentity> {
  const input = raw.trim();
  if (!input) throw new IdentityError();

  if (looksLikePrivateKey(input)) {
    throw new PrivateKeyError();
  }

  const local = parseLocalIdentity(input);
  if (local) return local;

  if (isNip05(input)) {
    let profile;
    try {
      profile = await queryProfile(input);
    } catch {
      throw new Nip05Error(
        "Could not look up that NIP-05 address. Check the spelling or try again."
      );
    }

    if (!profile?.pubkey) {
      throw new Nip05Error("No pubkey is registered for that NIP-05 address.");
    }

    return {
      pubkey: profile.pubkey,
      relayHints: (profile.relays ?? []).filter((r) => r.startsWith("wss://")),
    };
  }

  throw new IdentityError();
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
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
    const mapped = /:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
    if (mapped) return isPrivateOrLocalHostname(mapped[1]);
  }

  return false;
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    return !isPrivateOrLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function parseProfileContent(content: string): Kind0Profile {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    const picture =
      typeof data.picture === "string" ? data.picture.trim() : "";
    const displayName =
      (typeof data.display_name === "string" && data.display_name.trim()) ||
      (typeof data.name === "string" && data.name.trim()) ||
      "";
    const nip05 = typeof data.nip05 === "string" ? data.nip05.trim() : "";

    return {
      picture: isSafeHttpUrl(picture) ? picture : undefined,
      displayName: displayName || undefined,
      nip05: nip05 || undefined,
    };
  } catch {
    return {};
  }
}

export function parseKind0Profile(event: Event): Kind0Profile {
  return parseProfileContent(event.content);
}
