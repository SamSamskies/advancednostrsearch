# Shared hosted inference

[Issue #56](https://github.com/SamSamskies/advancednostrsearch/issues/56)
removes the direct-provider implementation after the migration in
[PR #55](https://github.com/SamSamskies/advancednostrsearch/pull/55).
The owner confirmed shared Replit works in Production on November 4, 2026.
All hosted requests now use the authenticated shared service. The retired
route switch cannot restore direct inference; incomplete shared configuration
fails closed. IPA preference, browser consent/storage keys, client identity,
soft counts, images/search/follow-ups, and non-streaming responses are preserved.
Absent reasoning uses provider defaults; explicit caller options pass through.

## Backend configuration

Use these server-only values in both Preview and Production:

```dotenv
INFERENCE_FALLBACK_ENABLED=true
SHARED_INFERENCE_PROVIDER=replit
REPLIT_INFERENCE_MODEL=google/gemma-4-26b-a4b-it
SHARED_INFERENCE_URL=https://ipa-inference-fallback-api.vercel.app/api/inference
SHARED_INFERENCE_APP_SECRET=<existing AdvancedNostrSearch app secret>
SHARED_INFERENCE_REPLIT_API_KEY=<existing gateway key>
```

Keep enablement/provider/model/URL as **Config**, and app/provider credentials
as **Secret**. Use the staged secret values; never commit them or prefix settings
with `VITE_`. The backend fixes the app identity to `advancednostrsearch` and
injects the model and matching provider key. Replit is the default when no shared
provider is set. `INFERENCE_FALLBACK_ENABLED=false` disables hosted inference
without affecting IPA. No shared failure triggers automatic retries or direct
provider calls.

Shared Ollama/Gemini remain available via `SHARED_INFERENCE_PROVIDER` and their
matching `SHARED_INFERENCE_OLLAMA_API_KEY` / `SHARED_INFERENCE_GEMINI_API_KEY`.
`OLLAMA_MODEL` and `GEMINI_MODEL` remain optional Config overrides (defaults
`gemma4:cloud` and `gemma-4-31b-it`). Gemini web search requires separate
selected-model validation before setting the Config
`SHARED_INFERENCE_GEMINI_SEARCH_ENABLED=true`.

The proxy retains its 100,000-byte UTF-8 browser/outgoing-request limits and
180-second timeout, including response reading. `vercel.json` retains Fluid
compute and a 200-second function duration. Project-level Fluid compute was
enabled during migration; do not revert it to the legacy runtime.

## Environment cleanup checklist

Vercel settings were inspected on November 4, 2026. **No Vercel environment
variables were changed by this cleanup.** After deploying the cleanup, the
owner can delete these entries from this project's settings:

| Variable | Currently present scopes | Action |
| --- | --- | --- |
| `GEMINI_API_KEY` | Production and Preview | Delete both obsolete direct-provider Secret entries |
| `OLLAMA_API_KEY` | Production and Preview | Delete both obsolete direct-provider Secret entries |
| `SHARED_INFERENCE_ENABLED` | Production; Preview restricted to `codex/shared-hosted-inference` | Delete the retired Config switch in both scopes |

The three active Config values `SHARED_INFERENCE_PROVIDER`,
`REPLIT_INFERENCE_MODEL`, and `INFERENCE_FALLBACK_ENABLED` currently have
Production entries and Preview entries restricted to the old
`codex/shared-hosted-inference` branch. Set those same non-secret values for
**all Preview branches**, then remove their obsolete branch-specific duplicates.
Keep their Production entries. The shared URL and all four shared app/provider
Secret names already cover both Preview and Production; keep them.

If any old settings are later found in local files, other Vercel scopes, or
branch overrides, these names also have no consumers:

```text
INFERENCE_API_KEY
INFERENCE_PROVIDER
INFERENCE_MODEL
INFERENCE_CLIENT_DAILY_LIMIT
GEMINI_FALLBACK_ENABLED
GEMINI_CLIENT_DAILY_LIMIT
OLLAMA_CLIENT_REQUESTS_PER_MINUTE
OLLAMA_REQUESTS_PER_MINUTE
OLLAMA_MAX_CONCURRENT
```

They were not present in the inspected Vercel listing. Do not delete
`INFERENCE_FALLBACK_ENABLED`, `REPLIT_INFERENCE_MODEL`, `OLLAMA_MODEL`,
`GEMINI_MODEL`, or any active `SHARED_INFERENCE_*` settings other than the
retired `SHARED_INFERENCE_ENABLED` switch. The local `.env.local` contained only
the two direct-provider key names above and a Vercel tooling token; the direct
key entries were removed without printing their values. Local hosted use now
requires the shared configuration from `.env.example`; IPA still works alone.

Removing a project variable does not revoke the provider credential. No keys
were revoked or rotated. Check other apps/scripts and deployment dependencies
before any later credential revocation. In particular, keep the single Replit
gateway key shared by the two app backends; this cleanup does not change
TrendingNostr or the shared service.

## Validation

The cleanup passes all 65 tests and the production build. Direct-only suites
were removed with their unused modules. Retained coverage exercises trusted
header/model injection, forged selectors and credentials, UTF-8 limits,
errors/Retry-After, redaction, timeout/cancellation, consent/client identity/soft
counts, IPA preference, images/search/follow-ups, and default/explicit reasoning.
New assertions ensure missing shared credentials and the hosted kill switch
cannot trigger direct inference, and the backend env loader ignores retired
settings while loading active shared settings.

The Vite integration test starts the real app middleware and a separate shared
HTTP fixture, checks both API routes and UTF-8 rejection, and verifies backend
credentials stay out of the served browser module. `npm run dev` continues to
serve both endpoints. A separate local shared service can use port 3001 with
`SHARED_INFERENCE_URL=http://127.0.0.1:3001/api/inference`. Local HTTP is rejected
in deployed Preview/Production.

The existing shared-service Production endpoint passed availability, text,
follow-up, provider-default reasoning, forged selectors/credentials, methods,
origin, prompt/options/client validation, and UTF-8 rejection during this cleanup.
The immutable rollback deployment also passed a full-size-image smoke with
search enabled: its response described sunset/sunrise over mountain silhouettes
and returned an HTTPS source link. Cleanup-branch Preview validation follows
the source push. A production build using unique backend configuration/secret
markers passed; none of the markers appeared in any browser build artifact.
Actual search execution must be checked using gateway/provider usage evidence;
HTTPS citations alone do not independently prove a search ran. Browser
interaction with an installed IPA extension is covered by automated tests and
was not manually repeated.

## Repeating functional smokes

Each invocation makes one real generation; `--followup` adds another. No app
or provider credentials are needed in the caller:

```sh
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --checks --followup --vercel
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --image-url 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=4000&q=100' --search --vercel
```

The second smoke combines a realistic full-size image with search enabled.
This public JPEG was 3,203,930 bytes during migration, becoming 4,271,908 base64
bytes before JSON framing upstream. The browser submits a small URL request;
the service downloads/encodes the image. This exercises the gateway's 32 MB
JSON-limit fix. The optional `--vision` red-image fixture is useful for a color
check but cannot replace the full-size-image smoke. Read the returned scene
description to verify the image was actually understood.

`--vercel` uses the authenticated Vercel CLI to access protected Preview.
If needed, `VERCEL_CLI_PATH` points to its `dist/vc.js`. For a public endpoint,
omit `--vercel`. An existing `VERCEL_AUTOMATION_BYPASS_SECRET` can alternatively
be supplied only in the smoke caller's environment; bypass credentials never
reach the shared service. Keep Preview protection enabled.

## Shared-service rollback target

The following immutable deployment was Ready and served shared Replit on
November 4, 2026:

- Deployment: `dpl_2449EgdKfVVAu3Ayif2DsHKtcfZr`.
- URL: <https://advancednostrsearch-i5lpdrnxr-samsamskies-projects.vercel.app>.
- Production alias at verification: <https://advancednostrsearch.vercel.app>.
- Migration source: PR #55, merged as `2b8f8074b347bc336dd97d03ae09594e0fbecabc`.
  The CLI deployment response did not include a source commit; the working
  deployment ID and observed shared-Replit behavior identify this rollback target.

After release authorization, roll back by restoring this **shared-service**
deployment through Vercel and repeat GET/text/full-size-image checks. Preserve
its captured shared provider selection, URL, app secret, and provider key.
Do not recreate a deployment from old source with the retired switch absent:
that source still contains direct routing. If rebuilding rollback source,
explicitly configure its shared-service path and verify it before promoting.
Changes to project env settings affect new deployments only. No production
promotion or rollback was performed for this cleanup.

Production load/WAF testing and spending-console checks are not prerequisites
under issue #54's accepted scope and are not claimed as verified.
