import assert from "node:assert/strict";
import test from "node:test";
import { nip19 } from "nostr-tools";
import {
  buildNoteContext,
  noteContextUserContent,
  patchNoteContextHistory,
  systemPrompt,
} from "../src/ask-ai-context.ts";
import { noteImageUrls } from "../src/media.ts";

const note = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  kind: 1,
  created_at: 1700000000,
  content: "What does Nostr mean?",
  tags: [],
  seenOn: [],
  sig: "",
};

test("context identifies the selected note and truncates long text", () => {
  const context = buildNoteContext(
    { ...note, content: "x".repeat(9000) },
    "Alice",
  );
  assert.ok(
    context.includes(`Author: Alice (${nip19.npubEncode(note.pubkey)})`),
  );
  assert.ok(context.includes(new Date(note.created_at * 1000).toISOString()));
  assert.ok(context.endsWith("x".repeat(8000) + "\n\n[note truncated]"));
  assert.ok(!context.includes("trending"));
  assert.equal(typeof noteContextUserContent(note, "Alice"), "string");
});

test("image context includes inline and imeta images once, before the text", () => {
  const withMedia = {
    ...note,
    content: "https://example.com/photo.png, https://example.com/video.mp4",
    tags: [
      ["imeta", "url https://example.com/photo.png", "m image/png"],
      ["imeta", "url https://example.com/another", "m image/webp"],
    ],
  };
  const content = noteContextUserContent(withMedia, "Alice");
  assert.deepEqual(content.slice(0, -1), [
    { type: "image", url: "https://example.com/photo.png" },
    { type: "image", url: "https://example.com/another" },
  ]);
  assert.equal(content.at(-1).type, "text");
  assert.ok(content.at(-1).text.includes("Alice"));
  assert.equal(
    noteImageUrls(
      Array.from({ length: 10 }, (_, i) => `https://example.com/${i}.jpg`).join(
        " ",
      ),
    ).length,
    8,
  );
});

test("updating author metadata or web search preserves follow-up history", () => {
  const initial = noteContextUserContent(note, "Unknown");
  const history = [
    { role: "system", content: systemPrompt(true, false) },
    { role: "user", content: initial },
    { role: "assistant", content: "An open social protocol." },
    { role: "user", content: "What is a relay?" },
  ];
  const followups = history.slice(2);
  const updated = noteContextUserContent(note, "Alice");
  assert.equal(patchNoteContextHistory(history, updated, false), true);
  assert.ok(history[0].content.includes("You cannot search the web"));
  assert.equal(history[1].content, updated);
  assert.deepEqual(history.slice(2), followups);
  assert.equal(patchNoteContextHistory(history, updated, false), false);
});
