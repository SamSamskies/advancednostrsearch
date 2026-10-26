import { nip19 } from "nostr-tools";
import type { ContentPart } from "ipa-tools";
import type { InferenceMessage } from "./inference.ts";
import { noteImageUrls } from "./media.ts";
import type { LocatedEvent } from "./nostr";

const MAX_NOTE_CHARS = 8000;

function encodeNpub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return "";
  }
}

export const SYSTEM_PROMPT_IMAGES_LINE =
  "The first user message includes the note's images before the text. Look at those images when they matter.";

export function systemPrompt(canSearch: boolean, hasImages: boolean): string {
  return [
    "You help someone read a public Nostr note from search results.",
    "The reader can already see the note. There are no replies in this app, so do not summarize the text back to them.",
    hasImages ? SYSTEM_PROMPT_IMAGES_LINE : null,
    "On the first reply, explain and check:",
    "- What is this referring to, and who or what is involved?",
    canSearch
      ? "- If it makes a claim or shares news, is that actually true? Search if you need to."
      : "- If it makes a claim or shares news, is that actually true? Say so if you cannot verify it.",
    "- If it is jargon, a meme, or an in-joke, explain it.",
    "- If it asks a question, answer it.",
    "- If it is a simple status or joke, say so in one line and stop.",
    canSearch
      ? "You can search the public web when that would help: checking a claim, identifying a person or project, current events, or facts that are not in the note. Do not search when the note itself is enough. If you searched, say so briefly."
      : "You cannot search the web. Do not claim you searched. If a claim needs verification you cannot do, say so.",
    "Keep answers short. Light markdown is fine: bold, short lists, and links. Do not use headings or code fences.",
    "You are not the note's author. If you are unsure, say so. Invite a follow-up when it would help.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function buildNoteContext(
  note: LocatedEvent,
  authorName: string,
): string {
  const npub = encodeNpub(note.pubkey);
  const raw = note.content.trim() || "(no text — media-only note)";
  const truncated =
    raw.length > MAX_NOTE_CHARS
      ? `${raw.slice(0, MAX_NOTE_CHARS)}\n\n[note truncated]`
      : raw;

  return [
    "A public Nostr note:",
    `Author: ${authorName}${npub ? ` (${npub})` : ""}`,
    `Posted: ${new Date(note.created_at * 1000).toISOString()}`,
    "",
    "Note:",
    truncated,
  ].join("\n");
}

export function noteContextUserContent(
  note: LocatedEvent,
  authorName: string,
): string | ContentPart[] {
  const text = buildNoteContext(note, authorName);
  const images = noteImageUrls(note.content, note.tags);
  if (images.length === 0) return text;
  // Images first, then the existing note-context text (Bridge / Gemini vision).
  return [
    ...images.map((url): ContentPart => ({ type: "image", url })),
    { type: "text", text },
  ];
}

export function patchNoteContextHistory(
  history: InferenceMessage[],
  content: string | ContentPart[],
  canSearch: boolean,
): boolean {
  const system = history[0];
  const context = history[1];
  if (system?.role !== "system" || context?.role !== "user") return false;
  const nextSystem = systemPrompt(canSearch, Array.isArray(content));
  const contentSame =
    JSON.stringify(context.content) === JSON.stringify(content);
  const systemSame = system.content === nextSystem;
  if (contentSame && systemSame) return false;
  history[0] = { role: "system", content: nextSystem };
  history[1] = { role: "user", content };
  return true;
}
