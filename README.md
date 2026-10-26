# Advanced Nostr Search

A tool to help you search your favorite Nostr accounts.

## Installation

```bash
npm ci
npm start
```

Open the local URL Vite prints (usually http://localhost:5173).

## Note previews

Search results show quoted notes with their author, timestamp, text, and media.
Quoted references and author names work with the existing Open In dialog.
Web links show a title, description, and thumbnail when metadata is available.
Unavailable notes and pages fall back to ordinary links. Each quote shows up to
one web link preview with a smaller image; additional links and nested note
references stay inline.

`/api/preview` runs with `npm run dev` and deploys as a Vercel function. No API
key is required. The endpoint checks public destinations and redirects, pins
DNS addresses, and limits fetch time and response size.

## Ask AI

Each note has an **Ask AI** button. It opens an explanation of the note and lets
readers ask follow-up questions, stop a response, or clear the conversation.
Conversations stay in memory for the current page session. Images on the note
are included when the inference provider supports them; Markdown links open in
a new tab. The panel's web-search checkbox is saved in the browser.

Ask AI uses an installed [Inference Bridge](https://github.com/SamSamskies/inference-bridge)
or another Inference Provider API extension first. No server credentials are
needed for that path.

An optional hosted Gemini fallback uses the same `/api/inference` implementation
as Trending Nostr. To enable it locally, copy `.env.example` to `.env.local` and
set `INFERENCE_API_KEY` to a Gemini API key. `npm run dev` serves both the app and
the inference endpoint. On Vercel, configure the same server-only environment
variables in the project; `api/inference.js` is deployed as a function. Never
prefix the key with `VITE_` or add it to frontend code.

Without an inference extension, the panel asks for consent before sending the
note and questions to the hosted provider. Hosted requests have a per-browser
daily allowance; `INFERENCE_CLIENT_DAILY_LIMIT` changes the default of 50.
Hosted explanations use lightweight reasoning, and server requests time out after
50 seconds so slow provider calls can be retried.
If neither inference path is available, the panel links to Inference Bridge.

## Checks

```bash
npm test
npm run build
```
