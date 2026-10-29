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
Conversations stay in memory for the current page session. **Include note images**
is on by default; turn it off for text-only models. Image URLs stay in the note
context when images are off. Both this checkbox and **Search the web when helpful**
are saved in the browser. Markdown links open in a new tab.

Generated answers default to the browser's preferred language (English when
unavailable), regardless of the note's language. An explicit language request
takes priority, followed by the language of the reader's follow-up question.
This applies to both inference paths; panel labels stay in English.

Ask AI uses an installed [Inference Bridge](https://github.com/SamSamskies/inference-bridge)
or another Inference Provider API extension first. No server credentials are
needed for that path.

The optional hosted fallback defaults to Ollama Cloud. To enable it locally,
copy `.env.example` to `.env.local` and set `OLLAMA_API_KEY` to your
[Ollama API key](https://ollama.com/settings/keys). All model and search requests
go directly to `https://ollama.com/api`; no local Ollama installation is needed.
The default `OLLAMA_MODEL=gemma4:cloud` is translated to `gemma4:31b`, the
[direct API model name](https://docs.ollama.com/cloud). Images are sent as base64
after the server fetches them. With web search enabled, the model can use Ollama's
[web search API](https://docs.ollama.com/capabilities/web-search), with at most
two searches and three chat calls per explanation, and source links in the answer.

`npm run dev` serves both the app and the inference endpoint. On Vercel,
configure the same server-only environment variables in the project;
`api/inference.js` is deployed as a function. Never prefix keys with `VITE_`
or add them to frontend code.

Gemini remains available: set `INFERENCE_PROVIDER=gemini` and `GEMINI_API_KEY`,
optionally overriding `GEMINI_MODEL` (default `gemma-4-31b-it`). Switching back
to `INFERENCE_PROVIDER=ollama` uses the independent Ollama key and model.
Legacy `INFERENCE_API_KEY`, `GEMINI_FALLBACK_ENABLED`, and
`GEMINI_CLIENT_DAILY_LIMIT` are accepted only for Gemini. `INFERENCE_MODEL`
can override the selected provider's default when `INFERENCE_PROVIDER` is set;
provider-specific model variables take precedence. An old generic Gemini key
is never sent to Ollama.

Without an inference extension, the panel asks for consent before sending the
note and questions to the hosted provider. Hosted requests have a per-browser
daily allowance; `INFERENCE_CLIENT_DAILY_LIMIT` changes the default of 50.
Hosted explanations use lightweight reasoning, and server requests time out after
50 seconds so slow provider calls can be retried.
Ollama requests also have configurable limits: 5 explanations per browser per
rolling minute (`OLLAMA_CLIENT_REQUESTS_PER_MINUTE`), 20 upstream API attempts
per rolling minute (`OLLAMA_REQUESTS_PER_MINUTE`, including search and follow-up
chat calls), and 2 concurrent explanations (`OLLAMA_MAX_CONCURRENT`).
Failed attempts count toward minute limits; failed explanations release the
daily allowance. HTTP 429 responses include `Retry-After`; an upstream 429
starts a shared cooldown using Ollama's retry header, or 60 seconds when absent.
These defaults are application policy, not Ollama's published plan limits.
Limits and cooldowns live in memory per server process and reset on restart;
Vercel instances do not share counters. They reduce bursts but do not enforce
an account-wide budget across instances. Browser tokens can also be reset by
the reader. A shared datastore is needed for strict deployment-wide quotas.
If neither inference path is available, the panel links to Inference Bridge.

## Checks

```bash
npm test
npm run build
```
