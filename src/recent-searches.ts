import * as nip19 from "nostr-tools/nip19";
import type { Kind0Profile } from "./identity";

export const INCLUDE_FOLLOWED_USERS_QUERY_PARAM = "followed";
export const INCLUDE_ONLY_AUTHOR_QUERY_PARAM = "onlyAuthor";
export const INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM =
  "onlyNotesAuthorReactedTo";

export const RECENT_SEARCHES_STORAGE_KEY = "advancednostrsearch:recents";
export const MAX_RECENT_SEARCHES = 10;

export type SearchFields = {
  npub: string;
  include: string;
  query: string;
  fromDate: string;
  toDate: string;
  hasImage: boolean;
  hasVideo: boolean;
};

export type RecentSearch = SearchFields & {
  savedAt: number;
  authorName?: string;
};

export function pubkeyFromNpub(npub: string): string | null {
  try {
    const decoded = nip19.decode(npub.trim());
    return decoded.type === "npub" ? decoded.data.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function sameSearch(a: SearchFields, b: SearchFields): boolean {
  return (
    a.npub === b.npub &&
    a.include === b.include &&
    a.query === b.query &&
    a.fromDate === b.fromDate &&
    a.toDate === b.toDate &&
    a.hasImage === b.hasImage &&
    a.hasVideo === b.hasVideo
  );
}

export function toQueryString(fields: SearchFields): string {
  const params = new URLSearchParams();
  if (fields.npub) params.set("npub", fields.npub);
  if (fields.include) params.set("include", fields.include);
  if (fields.query) params.set("query", fields.query);
  if (fields.fromDate) params.set("fromDate", fields.fromDate);
  if (fields.toDate) params.set("toDate", fields.toDate);
  if (fields.hasImage) params.set("hasImage", "1");
  if (fields.hasVideo) params.set("hasVideo", "1");
  return params.toString();
}

export function recentTitle(recent: RecentSearch): string {
  const name = recent.authorName?.trim();
  if (name) return name;
  const npub = recent.npub.trim();
  return npub.length > 16 ? `${npub.slice(0, 16)}…` : npub || "Unknown author";
}

export function recentSummary(recent: RecentSearch): string {
  const parts: string[] = [];
  const query = recent.query.trim();
  if (query) parts.push(query);
  parts.push(includeLabel(recent.include));
  if (recent.hasImage && recent.hasVideo) parts.push("has image or video");
  else if (recent.hasImage) parts.push("has image");
  else if (recent.hasVideo) parts.push("has video");
  const dates = dateLabel(recent.fromDate, recent.toDate);
  if (dates) parts.push(dates);
  return parts.join(" · ");
}

export function loadRecents(): RecentSearch[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseRecentSearch)
      .filter((item): item is RecentSearch => item !== null)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecent(
  fields: SearchFields & { authorName?: string },
  recents: RecentSearch[]
): RecentSearch[] {
  const previous = recents.find((item) => sameSearch(item, fields));
  const next: RecentSearch = {
    npub: fields.npub.trim(),
    include: fields.include || INCLUDE_ONLY_AUTHOR_QUERY_PARAM,
    query: fields.query,
    fromDate: fields.fromDate,
    toDate: fields.toDate,
    hasImage: fields.hasImage,
    hasVideo: fields.hasVideo,
    authorName: fields.authorName?.trim() || previous?.authorName,
    savedAt: Date.now(),
  };
  const list = [
    next,
    ...recents.filter((item) => !sameSearch(item, fields)),
  ].slice(0, MAX_RECENT_SEARCHES);
  persist(list);
  return list;
}

export function withAuthorNames(
  recents: RecentSearch[],
  profiles: Record<string, Kind0Profile>
): RecentSearch[] {
  let changed = false;
  const next = recents.map((recent) => {
    const pubkey = pubkeyFromNpub(recent.npub);
    if (!pubkey) return recent;
    const authorName = profiles[pubkey]?.displayName?.trim();
    if (!authorName || authorName === recent.authorName) return recent;
    changed = true;
    return { ...recent, authorName };
  });
  if (!changed) return recents;
  persist(next);
  return next;
}

export function clearRecents(): RecentSearch[] {
  persist([]);
  return [];
}

function includeLabel(include: string): string {
  switch (include) {
    case INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM:
      return "Reacted to";
    case INCLUDE_FOLLOWED_USERS_QUERY_PARAM:
      return "Following";
    default:
      return "Author notes";
  }
}

function dateLabel(fromDate: string, toDate: string): string | null {
  if (fromDate && toDate) return `${fromDate}–${toDate}`;
  if (fromDate) return `from ${fromDate}`;
  if (toDate) return `until ${toDate}`;
  return null;
}

function parseRecentSearch(value: unknown): RecentSearch | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.npub !== "string" || !item.npub.trim()) return null;

  return {
    npub: item.npub.trim(),
    include:
      typeof item.include === "string" && item.include
        ? item.include
        : INCLUDE_ONLY_AUTHOR_QUERY_PARAM,
    query: typeof item.query === "string" ? item.query : "",
    fromDate: typeof item.fromDate === "string" ? item.fromDate : "",
    toDate: typeof item.toDate === "string" ? item.toDate : "",
    hasImage: item.hasImage === true,
    hasVideo: item.hasVideo === true,
    savedAt: typeof item.savedAt === "number" ? item.savedAt : 0,
    authorName:
      typeof item.authorName === "string" && item.authorName.trim()
        ? item.authorName.trim()
        : undefined,
  };
}

function persist(recents: RecentSearch[]) {
  try {
    window.localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify(recents)
    );
  } catch {
    // Private mode and quota errors shouldn't break search.
  }
}
