# Hosted inference rollout

Implements [issue #54](https://github.com/SamSamskies/advancednostrsearch/issues/54)
using [TrendingNostr PR #111](https://github.com/SamSamskies/trendingnostr/pull/111).
The owner's subsequent instruction removes the issue's requested
`reasoningEffort: "none"` default: absent reasoning stays absent, and explicit
caller options still pass through. IPA preference, consent, storage keys,
non-streaming responses, images, and follow-up conversations remain intact.

## Baseline and configuration

Recorded November 4, 2026:

- Verified pre-migration `main`: `c5d22d6fe96376f8e8927c9a39364f504645f90a`.
- Production alias: `https://advancednostrsearch.vercel.app`.
- Ready production deployment: `dpl_G215ZioEpfNNtb7Nbif6gGXVZN7Q`.
- Rollback URL: `https://advancednostrsearch-230mw9976-samsamskies-projects.vercel.app`.
  Vercel deployment metadata confirms the baseline commit above.
- Production and Preview contain the staged shared URL, app secret, and all
  three `SHARED_INFERENCE_*_API_KEY` names. Existing direct Gemini/Ollama keys
  remain present. Secret values were not printed, replaced, or rotated.
- Preview-only Vercel authentication was enabled for this project, which
  previously had no preview protection. Production remains public.
- `vercel.json` explicitly enables Fluid compute: this older project's legacy
  runtime rejected the required 200-second duration. The per-deployment setting
  supports the 180-second proxy timeout without changing the account plan.
  See [Vercel Fluid compute](https://vercel.com/docs/fluid-compute).

The switch defaults off. Merging source alone does not select shared inference.
For this app's authorized release, use the following **backend-only** selection,
first in Preview and then in Production:

```dotenv
SHARED_INFERENCE_ENABLED=true
SHARED_INFERENCE_PROVIDER=replit
REPLIT_INFERENCE_MODEL=google/gemma-4-26b-a4b-it
SHARED_INFERENCE_URL=https://ipa-inference-fallback-api.vercel.app/api/inference
SHARED_INFERENCE_APP_SECRET=<existing AdvancedNostrSearch secret>
SHARED_INFERENCE_REPLIT_API_KEY=<existing gateway key>
INFERENCE_FALLBACK_ENABLED=true
```

Use the existing staged sensitive values, never these placeholders. Keep the
independent direct provider/model/key settings. Shared Replit uses only its
specific shared key and dedicated model setting; no legacy/direct Replit route
exists. Do not add `VITE_` prefixes. Branch-specific Preview settings should
select shared Replit for `codex/shared-hosted-inference`.

The gateway's Replit key is intentionally shared by the two app backends. App
secrets and service admission buckets remain independent. Coordinate any gateway
key rotation across both apps. No shared-service deployment change is needed.

## Validation evidence

All 92 automated tests and the production build passed. Coverage includes
trusted header/field construction, forged headers/selectors, provider/model/key
isolation, authenticated GET, methods/origins, 100,000-byte incoming and outgoing
UTF-8 request limits, image/options/follow-up forwarding, cancellation through
response reading, 180-second timeout, credential redaction, error/Retry-After
propagation, no automatic fallback/retry, and independent direct rollback.
Browser-backend tests cover IPA preference, tab consent, stable client identity,
soft counts, explicit options, absent reasoning, non-streaming completion,
platform 429 versus explicit quota failures, and Stop during response reading.
A real loopback integration starts Vite and a separate shared-service fixture;
it verifies `/api/inference` routing, backend env isolation, UTF-8 rejection,
and the retained `/api/preview` middleware.

Live functional validation used this app's own identity and staged credentials:

| Route | Deployment | Results |
| --- | --- | --- |
| Shared Replit | `dpl_4vYwjjb3VxQzUSNEJuXdimqa2dRu` — [Preview](https://advancednostrsearch-odvpyyrdi-samsamskies-projects.vercel.app) | GET availability; text; follow-up; provider-default reasoning; forged headers/body/query selectors; methods/origin/options/client/UTF-8 rejection; red image correctly identified; search-enabled response with HTTPS citations; full-size photo |
| Direct rollback | `dpl_ELUxP19n1v3qe36PviuEcPw9XV8M` — [Preview](https://advancednostrsearch-1m3nprmw1-samsamskies-projects.vercel.app) | GET availability and successful direct Ollama generation with `SHARED_INFERENCE_ENABLED=false`, while shared Replit provider/model settings remain present |

The full-size test used this [public JPEG](https://images.unsplash.com/photo-1500534623283-312aade485b7?w=4000&q=100):
3,203,930 image bytes become 4,271,908 base64 bytes before upstream JSON framing.
The browser sends a small URL request; the service downloads the photo. The
returned description identified sunset light over layered mountain silhouettes.
This exercises the former 1 MB gateway-body failure, unlike the tiny color fixture.

Search-enabled responses and citations passed. Private gateway/provider usage
was not inspected, so actual search execution is not independently confirmed.
Deployed browser interaction with an installed IPA extension was not manually
retested; its routing and consent behavior are covered by automated tests.
Production activation and its availability/generation smoke remain release work.

## Repeating smoke checks

Each smoke invocation makes one real generation. `--followup` adds a second.
The command does not require app or provider credentials:

```sh
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --checks --followup --vercel
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --vision --vercel
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --search --vercel
npm run smoke:inference -- --url https://PREVIEW_HOST/api/inference --provider replit --image-url 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=4000&q=100' --vercel
```

`--vercel` uses an authenticated Vercel CLI to handle protected-preview access.
If the CLI is not on PATH, `VERCEL_CLI_PATH` may point to its `dist/vc.js`.
Alternatively omit `--vercel` and supply an existing
`VERCEL_AUTOMATION_BYPASS_SECRET` only in the smoke caller's environment. The
proxy never forwards bypass credentials to the shared service. Keep protection
enabled. Search citations alone do not prove a search tool executed; inspect
private gateway usage when authorized.

Local development continues to use `npm run dev`. A separately running service
may listen on port 3001; set the server-only local URL to
`http://127.0.0.1:3001/api/inference`. HTTP local URLs are rejected in deployed
Preview/Production. Gemini search requires separate selected-model validation
before `SHARED_INFERENCE_GEMINI_SEARCH_ENABLED=true`.

## Release and rollback

After preview checks and release authorization, merge the PR, apply the four
non-secret selection settings to this app's Production environment, and redeploy.
Retain the staged shared secret/key/URL and existing direct credentials. Record
the release commit, deployment ID/URL, and normal availability/generation smoke.
Changes to environment settings affect new deployments only.

To roll back independently, change only `SHARED_INFERENCE_ENABLED=false` and
redeploy. Verify GET availability and a direct request using the retained
provider configuration. The protected rollback preview already passed this
path. Alternatively restore the recorded pre-migration deployment. Leave
TrendingNostr and the shared service unchanged. Never automatically try the
direct route after a shared failure: that can bypass admission or duplicate a
paid generation. Retire duplicated direct code/unused keys only in a later
cleanup after observation.

The shared admission rule is currently 10 POSTs per app per 60 seconds within a
region, across providers/client IDs; it is not a global daily quota or spending
cap. Development rate-limit validation is accepted for this migration.
Production-specific WAF/load testing and provider spending-console checks are
not release prerequisites under issue #54's accepted scope, and are not claimed
as verified here.
