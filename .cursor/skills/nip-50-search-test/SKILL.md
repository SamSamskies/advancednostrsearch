---
name: nip-50-search-test
description: Queries Nostr NIP-50 search relays with a text query (optional author npub/hex) and reports whether matching kind-1 notes come back. Use when testing NIP-50 search results, verifying a search relay index, checking relay.noswhere.com or search.nos.today, or confirming a note is findable by search after a rebroadcast.
---

# NIP-50 search test

Live-query search relays. Do not infer index state from memory or from ordinary (non-`search`) REQ results.

## Run

From the repo root (needs `nostr-tools` from this project):

```bash
node .cursor/skills/nip-50-search-test/scripts/nip50-search.mjs --query pullup --npub npub1...
```

Flags:

- `--query` (required) — NIP-50 `search` string
- `--npub` or `--author` (hex) — optional `authors` filter
- `--relay` — repeatable; default is `wss://relay.ditto.pub`, `wss://relay.noswhere.com`, and `wss://search.nos.today`
- `--limit` (default 20), `--max-wait` (default 6000)

Needs network (`full_network`). Read-only: REQ plus NIP-11 HTTP. Do not EVENT/rebroadcast unless the user asked.

## Interpret

- `returned: 0` and a clean EOSE means the relay has no indexed hit (or does not store that event). Treat as a miss.
- `returned > 0` but `contentIncludesQuery: 0` means the relay ignored `search` or ranked poorly — not a real NIP-50 hit.
- Compare with a normal REQ (`ids` / `authors` without `search`) on a write relay (e.g. ditto, primal) only to prove the note exists somewhere. That does not prove the search index.

## Report

Lead with hit or miss per relay. Include query, author, counts, and a content preview of any matches. Mention NIP-11 `supported_nips` if 50 is missing.
