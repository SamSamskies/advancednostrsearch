import assert from "node:assert/strict";
import test from "node:test";
import { nip19 } from "nostr-tools";
import { parseNostrEntity } from "../src/mentions.ts";

const id = "a".repeat(64);
const author = "b".repeat(64);

test("note references retain the event id for quote hydration", () => {
  const code = nip19.noteEncode(id);
  assert.deepEqual(parseNostrEntity(`nostr:${code}`), {
    type: "note", code, id, relayHints: [],
  });
});

test("nevent references retain kind, author, and usable deduplicated relay hints", () => {
  const code = nip19.neventEncode({
    id, author, kind: 1111,
    relays: ["wss://relay.example/", "wss://relay.example", "https://invalid.example"],
  });
  assert.deepEqual(parseNostrEntity(code), {
    type: "note", code, id, author, kind: 1111,
    relayHints: ["wss://relay.example"],
  });
  assert.equal(parseNostrEntity("nostr:note1invalid"), null);
});
