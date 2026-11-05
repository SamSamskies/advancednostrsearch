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

The optional hosted fallback uses the authenticated shared inference service
through `/api/inference`, with Replit selected by default. Copy `.env.example`
to `.env.local` for local use. Set these **server-only** values in Vercel
Preview and Production:

```dotenv
INFERENCE_FALLBACK_ENABLED=true
SHARED_INFERENCE_PROVIDER=replit
REPLIT_INFERENCE_MODEL=google/gemma-4-26b-a4b-it
SHARED_INFERENCE_URL=https://ipa-inference-fallback-api.vercel.app/api/inference
SHARED_INFERENCE_APP_SECRET=<this app's existing secret>
SHARED_INFERENCE_REPLIT_API_KEY=<existing gateway key>
```

Keep selection/model/URL/enablement settings as **Config** and app/provider
credentials as **Secret**. Never prefix them with `VITE_` or commit secret
values. The backend fixes the `advancednostrsearch` app identity and injects
its selected provider key and model. Browser-selected providers, models, and
credentials cannot override them. The proxy bounds requests and selects public
fields; the shared service validates messages, images, search values, and
options. Responses are non-streaming JSON; the proxy times out after 180 seconds
within a 200-second Fluid compute function.

`INFERENCE_FALLBACK_ENABLED=false` disables hosted inference. Missing shared
configuration fails closed. All hosted requests use the shared service;
shared errors never trigger an automatic retry or a direct provider request.
Shared Ollama and Gemini remain supported with their matching
`SHARED_INFERENCE_OLLAMA_API_KEY` or `SHARED_INFERENCE_GEMINI_API_KEY` and
backend-owned models (`OLLAMA_MODEL` and `GEMINI_MODEL` optionally override
their defaults). Gemini search requires separate model validation
and `SHARED_INFERENCE_GEMINI_SEARCH_ENABLED=true`. Legacy direct-provider
keys, generic selection/model aliases, and quota settings are no longer read.

`npm run dev` serves both `/api/inference` and `/api/preview`. The shared
service can run independently on port 3001: use
`SHARED_INFERENCE_URL=http://127.0.0.1:3001/api/inference` in `.env.local`.
Local HTTP is rejected in deployed Preview/Production.

Without an inference extension, the panel asks for consent before sending the
note and questions to the hosted provider. Hosted requests retain a per-browser
soft daily allowance of 50 successful explanations. Reasoning uses the provider
default unless a caller supplies an explicit option. The shared service applies
its own admission limits; browser counts can be reset and do not enforce an
account-wide budget. If neither inference path is available, the panel links
to Inference Bridge.

## Checks

```bash
npm test
npm run build
```

For functional checks against a protected Preview deployment:

```bash
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --checks --followup --vercel
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --image-url 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=4000&q=100' --search --vercel
```

Each command makes a real generation; `--followup` adds another. `--vercel`
uses the authenticated Vercel CLI for protected Preview access; omit it for
public endpoints. `VERCEL_CLI_PATH` can point to the CLI's `dist/vc.js`.
The image command exercises a full-size photo downloaded by the shared service,
including its base64 upstream payload. Check the returned scene description;
citations alone do not independently verify search execution.

The shared-Replit deployment verified on November 4, 2026 is
`dpl_2449EgdKfVVAu3Ayif2DsHKtcfZr`
([deployment URL](https://advancednostrsearch-i5lpdrnxr-samsamskies-projects.vercel.app)).
Restore that existing deployment through Vercel deployment history when rollback
is needed, preserving its captured shared configuration and credentials.
