import assert from "node:assert/strict";
import test from "node:test";
import { nip19 } from "nostr-tools";
import {
  buildNoteContext,
  formatPromptDateTime,
  noteContextUserContent,
  patchNoteContextHistory,
  preferredResponseLanguage,
  systemPrompt,
  systemPromptChanged,
  SYSTEM_PROMPT_IMAGES_LINE,
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

test("response language uses browser preference order and language fallback", () => {
  assert.equal(
    preferredResponseLanguage({ languages: ["es-MX", "en-US"], language: "fr" }),
    "es-MX",
  );
  assert.equal(
    preferredResponseLanguage({ languages: [], language: "fr-CA" }),
    "fr-CA",
  );
  assert.equal(preferredResponseLanguage({ language: "pt-br" }), "pt-BR");
  assert.equal(
    preferredResponseLanguage({
      languages: ["", "not_a_locale", "ja"],
      language: "en",
    }),
    "ja",
  );
  assert.equal(
    preferredResponseLanguage({ languages: [" "], language: "de" }),
    "de",
  );
});

test("missing or unusable browser language falls back to English", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      configurable: true,
    });
    assert.equal(preferredResponseLanguage(), "en");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
  assert.equal(preferredResponseLanguage({}), "en");
  assert.equal(preferredResponseLanguage({ languages: [], language: "" }), "en");
  assert.equal(preferredResponseLanguage({ language: "not_a_locale" }), "en");
});

test("timestamps use local civil time and the offset at that date", () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const [timezone, iso, expected] of [
      ["UTC", "2026-10-29T13:02:45.500Z", "2026-10-29T13:02:45+00:00"],
      ["America/Chicago", "2026-10-29T13:02:45.500Z", "2026-10-29T08:02:45-05:00"],
      ["America/Chicago", "2026-12-29T01:02:45.500Z", "2026-12-28T19:02:45-06:00"],
      ["Asia/Kathmandu", "2026-10-29T23:02:45.500Z", "2026-10-30T04:47:45+05:45"],
      ["America/St_Johns", "2026-12-29T13:02:45.500Z", "2026-12-29T09:32:45-03:30"],
    ]) {
      process.env.TZ = timezone;
      const date = new Date(iso);
      assert.equal(formatPromptDateTime(date), expected);
      assert.equal(
        formatPromptDateTime(date, "minute"),
        expected.replace(/:\d{2}([+-])/, ":00$1"),
      );
      assert.equal(Date.parse(expected), date.getTime() - 500);
      const context = buildNoteContext(
        { ...note, created_at: Math.floor(date.getTime() / 1000) },
        "Alice",
      );
      assert.ok(context.includes(`Posted: ${expected}\n`));
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("shared prompt includes the current time and prioritizes language signals", () => {
  const now = new Date("2026-10-29T13:02:45Z");
  const prompt = systemPrompt(false, false, "es-ES", now);
  assert.ok(prompt.includes(
    `The current date and time is ${formatPromptDateTime(now, "minute")}.`,
  ));
  const explicit = prompt.indexOf("1. Follow an explicit language request");
  const question = prompt.indexOf(
    "2. Otherwise, use the language of the reader's latest follow-up question",
  );
  const browser = prompt.indexOf("3. For the initial explanation");
  assert.ok(explicit >= 0 && explicit < question && question < browser);
  assert.ok(prompt.includes("reply in French"));
  assert.ok(prompt.includes("browser language: es-ES"));
  assert.ok(
    prompt.includes(
      "first user message is note context, not a reader question or language request",
    ),
  );
  assert.ok(prompt.includes("explain an English note in Spanish"));
  assert.ok(systemPrompt(false, false).includes("browser language: en."));
});

test("context identifies the selected note and truncates long text", () => {
  const context = buildNoteContext(
    { ...note, content: "x".repeat(9000) },
    "Alice",
  );
  assert.ok(
    context.includes(`Author: Alice (${nip19.npubEncode(note.pubkey)})`),
  );
  assert.ok(context.includes(
    `Posted: ${formatPromptDateTime(new Date(note.created_at * 1000))}`,
  ));
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
  const hash = "ab".repeat(32);
  const inlineBlossom = `https://cdn.example/${hash}.png`;
  const imetaBlossom = `https://blossom.example/${hash}`;
  const blossomNote = {
    ...note,
    content: inlineBlossom,
    tags: [["imeta", `url ${imetaBlossom}`, "m image/png"]],
  };
  const blossomContent = noteContextUserContent(blossomNote, "Alice");
  assert.deepEqual(blossomContent.slice(0, -1), [
    { type: "image", url: inlineBlossom },
  ]);
  assert.deepEqual(noteImageUrls(blossomNote.content, blossomNote.tags), [
    inlineBlossom,
  ]);
});

test("updating author metadata or web search preserves language and follow-up history", () => {
  const now = new Date("2026-10-29T13:02:00Z");
  const initial = noteContextUserContent(note, "Unknown");
  const history = [
    { role: "system", content: systemPrompt(true, false, "es-ES", now) },
    { role: "user", content: initial },
    { role: "assistant", content: "An open social protocol." },
    { role: "user", content: "What is a relay?" },
  ];
  const followups = history.slice(2);
  const updated = noteContextUserContent(note, "Alice");
  const previousSystem = history[0].content;
  assert.equal(patchNoteContextHistory(history, updated, false, "es-ES", now), true);
  assert.ok(history[0].content.includes("You cannot search the web"));
  assert.ok(history[0].content.includes("browser language: es-ES"));
  assert.equal(systemPromptChanged(previousSystem, history[0].content), true);
  assert.equal(history[1].content, updated);
  assert.deepEqual(history.slice(2), followups);
  assert.equal(patchNoteContextHistory(history, updated, false, "es-ES", now), false);

  const withImage = [
    { type: "image", url: "https://example.com/photo.png" },
    { type: "text", text: updated },
  ];
  assert.equal(patchNoteContextHistory(history, withImage, true, "es-ES", now), true);
  assert.equal(history[0].content, systemPrompt(true, true, "es-ES", now));
  assert.deepEqual(history.slice(2), followups);
});

test("author edits patch context without looking like a mode change", () => {
  const earlier = new Date("2026-10-29T13:02:00Z");
  const later = new Date("2026-10-29T14:15:00Z");
  const initial = noteContextUserContent(note, "Unknown");
  const updated = noteContextUserContent(note, "Alice");
  const history = [
    { role: "system", content: systemPrompt(true, false, "es-ES", earlier) },
    { role: "user", content: initial },
    { role: "assistant", content: "An open social protocol." },
  ];
  const previousSystem = history[0].content;
  assert.equal(patchNoteContextHistory(history, updated, true, "es-ES", later), true);
  assert.equal(systemPromptChanged(previousSystem, history[0].content), false);
  assert.equal(history[0].content, systemPrompt(true, false, "es-ES", later));
  assert.equal(history[1].content, updated);

  const withImage = [
    { type: "image", url: "https://example.com/photo.png" },
    { type: "text", text: updated },
  ];
  const beforeImages = history[0].content;
  assert.equal(patchNoteContextHistory(history, withImage, true, "es-ES"), true);
  assert.equal(systemPromptChanged(beforeImages, history[0].content), true);

  const beforeSearchOff = history[0].content;
  assert.equal(patchNoteContextHistory(history, withImage, false, "es-ES"), true);
  assert.equal(systemPromptChanged(beforeSearchOff, history[0].content), true);
});

test("clock-only updates refresh history without signaling a context or mode change", () => {
  const earlier = new Date("2026-10-29T13:02:00Z");
  const later = new Date("2026-10-29T14:15:00Z");
  const content = noteContextUserContent(note, "Alice");
  const history = [
    { role: "system", content: systemPrompt(true, false, "es-ES", earlier) },
    { role: "user", content },
    { role: "assistant", content: "An open social protocol." },
    { role: "user", content: "What is a relay?" },
  ];
  const previousSystem = history[0].content;
  const contextAndFollowups = history.slice(1);
  assert.equal(patchNoteContextHistory(history, content, true, "es-ES", later), false);
  assert.equal(history[0].content, systemPrompt(true, false, "es-ES", later));
  assert.notEqual(history[0].content, previousSystem);
  assert.equal(systemPromptChanged(previousSystem, history[0].content), false);
  assert.deepEqual(history.slice(1), contextAndFollowups);
});

test("images off keeps inline and imeta-only links once, including media-only notes", () => {
  const inline = "https://example.com/photo.png";
  const imeta = "https://example.com/imeta-only";
  const withMedia = {
    ...note,
    content: `Look at this ${inline}`,
    tags: [
      ["imeta", `url ${inline}`, "m image/png"],
      ["imeta", `url ${imeta}`, "m image/webp"],
    ],
  };
  const content = noteContextUserContent(withMedia, "Alice", false);
  assert.equal(typeof content, "string");
  assert.equal(content, `${buildNoteContext(withMedia, "Alice")}\n\n${imeta}`);
  assert.equal(content.split(inline).length, 2);
  const mediaOnly = noteContextUserContent({ ...withMedia, content: "" }, "Alice", false);
  assert.ok(mediaOnly.includes("(no text — media-only note)"));
  assert.ok(mediaOnly.endsWith(`${inline}\n${imeta}`));
  assert.equal(noteContextUserContent(note, "Alice", false), buildNoteContext(note, "Alice"));
});

test("toggling images updates the context and vision prompt while preserving follow-ups", () => {
  const now = new Date("2026-10-29T13:02:00Z");
  const withImage = { ...note, tags: [["imeta", "url https://example.com/photo.png", "m image/png"]] };
  const history = [
    { role: "system", content: systemPrompt(true, true, "es-ES", now) },
    { role: "user", content: noteContextUserContent(withImage, "Alice") },
    { role: "assistant", content: "A photo." },
    { role: "user", content: "Reply in French: who is this?" },
  ];
  const followups = history.slice(2);
  for (const enabled of [false, true, false]) {
    const content = noteContextUserContent(withImage, "Alice", enabled);
    assert.equal(patchNoteContextHistory(history, content, true, "es-ES", now), true);
    assert.equal(history[0].content.includes(SYSTEM_PROMPT_IMAGES_LINE), enabled);
    assert.equal(history[0].content, systemPrompt(true, enabled, "es-ES", now));
    assert.deepEqual(history[1].content, content);
    assert.deepEqual(history.slice(2), followups);
  }
});
