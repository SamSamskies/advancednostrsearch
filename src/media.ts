export type MediaKind = "image" | "video";

export const newlineRegex = /(\r?\n)/gi;
export const hyperlinkRegex = /(https?:\/\/[^\s]+)/gi;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "bmp",
  "svg",
  "webp",
  "avif",
  "heic",
  "heif",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "ogg",
  "webm",
  "mkv",
  "avi",
  "m4v",
]);

const BLOSSOM_SEGMENT_RE = /^([a-fA-F0-9]{64})(?:\.([a-zA-Z0-9]+))?$/;

type Imeta = { url?: string; mime?: string };

type NoteMedia = { content: string; tags?: string[][] };

/** Strip punctuation that `https?:\/\/[^\s]+` often captures from surrounding prose. */
export function normalizeHttpUrl(raw: string): string {
  return raw.replace(/[),.;:!?]+$/g, "");
}

export function parseImeta(tags: string[][] = []): Imeta[] {
  const entries: Imeta[] = [];

  for (const tag of tags) {
    if (tag[0] !== "imeta") continue;
    const entry: Imeta = {};
    for (let i = 1; i < tag.length; i++) {
      const space = tag[i].indexOf(" ");
      if (space <= 0) continue;
      const key = tag[i].slice(0, space);
      const value = tag[i].slice(space + 1);
      if (key === "url") entry.url = value;
      if (key === "m") entry.mime = value;
    }
    if (entry.url || entry.mime) entries.push(entry);
  }

  return entries;
}

function pathnameExtension(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    const dot = last.lastIndexOf(".");
    if (dot <= 0) return undefined;
    return last.slice(dot + 1).toLowerCase();
  } catch {
    return undefined;
  }
}

/** BUD-01 / NIP-B7: last path segment is a SHA-256, with an optional advisory extension. */
export function blossomHashFromUrl(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const match = last.match(BLOSSOM_SEGMENT_RE);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function mimeKind(mime: string): MediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

function extensionKind(ext: string | undefined): MediaKind | null {
  if (!ext) return null;
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

function urlsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const hashA = blossomHashFromUrl(a);
  const hashB = blossomHashFromUrl(b);
  return Boolean(hashA && hashB && hashA === hashB);
}

export function classifyUrl(url: string, tags: string[][] = []): MediaKind | null {
  const normalized = normalizeHttpUrl(url);
  const imeta = parseImeta(tags);

  for (const entry of imeta) {
    if (!entry.url || !urlsMatch(normalized, entry.url)) continue;
    if (entry.mime) {
      const fromMime = mimeKind(entry.mime);
      if (fromMime) return fromMime;
    }
  }

  const fromExt = extensionKind(pathnameExtension(normalized));
  if (fromExt) return fromExt;

  // Extensionless blossom blobs are usually images in kind 1 notes.
  if (blossomHashFromUrl(normalized)) return "image";

  return null;
}

function urlsInContent(content: string): string[] {
  return [...content.matchAll(new RegExp(hyperlinkRegex.source, "gi"))].map(
    (match) => normalizeHttpUrl(match[0])
  );
}

export function collectMediaKinds(note: NoteMedia): Set<MediaKind> {
  const kinds = new Set<MediaKind>();
  const tags = note.tags ?? [];

  for (const url of urlsInContent(note.content)) {
    const kind = classifyUrl(url, tags);
    if (kind) kinds.add(kind);
  }

  return kinds;
}

export function noteHasImage(note: NoteMedia): boolean {
  return collectMediaKinds(note).has("image");
}

export function noteHasVideo(note: NoteMedia): boolean {
  return collectMediaKinds(note).has("video");
}

/** Both filters on → image OR video. */
export function matchesMediaFilters(
  note: NoteMedia,
  hasImage: boolean,
  hasVideo: boolean
): boolean {
  if (!hasImage && !hasVideo) return true;
  const kinds = collectMediaKinds(note);
  if (hasImage && hasVideo) return kinds.has("image") || kinds.has("video");
  if (hasImage) return kinds.has("image");
  return kinds.has("video");
}
