import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import handler, { imageFetchDns } from "../api/inference.js";
import { SYSTEM_PROMPT_IMAGES_LINE } from "../src/ask-ai-context.ts";

const originalFetch = globalThis.fetch;
const originalLookupAll = imageFetchDns.lookupAll;
const envNames = [
  "INFERENCE_PROVIDER",
  "INFERENCE_API_KEY",
  "GEMINI_API_KEY",
  "INFERENCE_FALLBACK_ENABLED",
  "GEMINI_FALLBACK_ENABLED",
  "INFERENCE_CLIENT_DAILY_LIMIT",
  "INFERENCE_MODEL",
  "GEMINI_MODEL",
];
let previousEnv;
beforeEach(() => {
  previousEnv = Object.fromEntries(
    envNames.map((key) => [key, process.env[key]]),
  );
  process.env.INFERENCE_API_KEY = "test-key-not-a-credential";
  process.env.INFERENCE_PROVIDER = "gemini";
  process.env.INFERENCE_MODEL = "test-model";
  process.env.INFERENCE_FALLBACK_ENABLED = "true";
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "50";
  globalThis.fetch = () => {
    throw new Error("Unexpected network call in test");
  };
  imageFetchDns.lookupAll = async () => [
    { address: "203.0.113.10", family: 4 },
  ];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  imageFetchDns.lookupAll = originalLookupAll;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const messages = [
  { role: "system", content: "Explain the note" },
  { role: "user", content: "What is Nostr?" },
];
async function call({
  method = "POST",
  origin = "https://example.test",
  token = crypto.randomUUID(),
  body = { messages, webSearch: false },
} = {}) {
  const req = {
    method,
    headers: { host: "example.test", origin, "x-inference-client": token },
    body,
  };
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler(req, res);
  return res;
}
function success(content = "Nostr is an open protocol.") {
  return Response.json({
    candidates: [{ content: { parts: [{ text: content }] } }],
  });
}

test("missing hosted configuration reports unavailable without contacting a provider", async () => {
  delete process.env.INFERENCE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const response = await call({ method: "GET" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "missing_api_key");
});

test("hosted endpoint rejects other origins, missing client tokens, and malformed input", async () => {
  assert.equal(
    (await call({ origin: "https://unrelated.test" })).statusCode,
    403,
  );
  assert.equal((await call({ token: "" })).body.error, "missing_client_token");
  assert.equal((await call({ body: { messages: [] } })).statusCode, 400);
  assert.equal((await call({ body: "{" })).body.error, "invalid_json");
  assert.equal(
    (await call({ body: { messages, options: { temperature: 10 } } }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await call({
        body: { messages: [{ role: "user", content: "x".repeat(61000) }] },
      })
    ).statusCode,
    413,
  );
});

test("hosted request honors web search, separates the system prompt, and includes sources", async () => {
  globalThis.fetch = async (url, options) => {
    assert.ok(url.startsWith("https://generativelanguage.googleapis.com/"));
    assert.ok(url.includes("test-model"));
    const body = JSON.parse(options.body);
    assert.equal(body.systemInstruction.parts[0].text, "Explain the note");
    assert.deepEqual(body.tools, [{ googleSearch: {} }]);
    assert.deepEqual(body.contents, [
      { role: "user", parts: [{ text: "What is Nostr?" }] },
    ]);
    return Response.json({
      candidates: [
        {
          content: { parts: [{ text: "Nostr is an open protocol." }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { title: "Nostr", uri: "https://nostr.com" } },
            ],
          },
        },
      ],
    });
  };
  const response = await call({ body: { messages, webSearch: true } });
  assert.equal(response.statusCode, 200);
  assert.match(response.body.content, /\[Nostr\]\(https:\/\/nostr.com\)/);
  assert.equal(response.body.model, "test-model");
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("hosted image input becomes inline bytes and web search can be disabled", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url === "https://images.example.test/photo.png") {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.contents[0].parts[0], {
      inlineData: { mimeType: "image/png", data: "AQID" },
    });
    return success("An image.");
  };
  const response = await call({
    body: {
      messages: [
        {
          role: "user",
          content: [
            { type: "image", url: "https://images.example.test/photo.png" },
            { type: "text", text: "Describe this" },
          ],
        },
      ],
      webSearch: false,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 2);
});

test("hosted image fetch does not request hostnames that resolve to private addresses", async () => {
  imageFetchDns.lookupAll = async () => [
    { address: "127.0.0.1", family: 4 },
  ];
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    const body = JSON.parse(options.body);
    assert.equal(
      body.systemInstruction.parts[0].text,
      "Explain a public Nostr note.",
    );
    assert.deepEqual(body.contents[0].parts, [
      { text: "Describe this\n\nhttps://127.0.0.1.nip.io/photo.png" },
    ]);
    return success("An image.");
  };
  const response = await call({
    body: {
      messages: [
        {
          role: "system",
          content: `Explain a public Nostr note.\n${SYSTEM_PROMPT_IMAGES_LINE}`,
        },
        {
          role: "user",
          content: [
            { type: "image", url: "https://127.0.0.1.nip.io/photo.png" },
            { type: "text", text: "Describe this" },
          ],
        },
      ],
      webSearch: false,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/generativelanguage\.googleapis\.com\//);
});

test("successful requests consume the browser allowance", async () => {
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "1";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return success();
  };
  const token = crypto.randomUUID();
  assert.equal((await call({ token })).statusCode, 200);
  assert.equal((await call({ token })).body.error, "client_limit");
  assert.equal(calls, 1);
});

test("provider errors release the allowance so the user can retry", async () => {
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "1";
  const token = crypto.randomUUID();
  globalThis.fetch = async () => {
    throw new Error("Network unavailable");
  };
  assert.equal((await call({ token })).statusCode, 502);
  globalThis.fetch = async () => success();
  assert.equal((await call({ token })).statusCode, 200);
});

test("hosted lightweight reasoning maps to Gemma's minimal setting", async () => {
  process.env.INFERENCE_MODEL = "gemma-4-31b-it";
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.generationConfig.thinkingConfig, {
      thinkingLevel: "minimal",
    });
    assert.ok(options.signal instanceof AbortSignal);
    return success();
  };
  const response = await call({
    body: { messages, webSearch: false, options: { reasoningEffort: "none" } },
  });
  assert.equal(response.statusCode, 200);
});

test("provider timeout returns a retryable error and releases the allowance", async () => {
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "1";
  const originalTimeout = AbortSignal.timeout;
  const token = crypto.randomUUID();
  try {
    AbortSignal.timeout = () =>
      AbortSignal.abort(new DOMException("Timed out", "TimeoutError"));
    globalThis.fetch = async (_url, options) => {
      options.signal.throwIfAborted();
      return success();
    };
    const response = await call({ token });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "provider_busy");
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
  globalThis.fetch = async () => success();
  assert.equal((await call({ token })).statusCode, 200);
});
