import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import handler, { imageFetchDns } from "../api/inference.js";

const originalFetch = globalThis.fetch;
const originalLookup = imageFetchDns.lookupAll;
const originalNow = Date.now;
const envNames = [
  "INFERENCE_PROVIDER", "INFERENCE_API_KEY", "INFERENCE_MODEL",
  "INFERENCE_FALLBACK_ENABLED", "INFERENCE_CLIENT_DAILY_LIMIT",
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_FALLBACK_ENABLED",
  "OLLAMA_API_KEY", "OLLAMA_MODEL", "OLLAMA_REQUESTS_PER_MINUTE",
  "OLLAMA_CLIENT_REQUESTS_PER_MINUTE", "OLLAMA_MAX_CONCURRENT",
];
let previous;
let time = originalNow();
beforeEach(() => {
  previous = envNames.map((name) => process.env[name]);
  envNames.forEach((name) => delete process.env[name]);
  process.env.OLLAMA_API_KEY = "test-ollama-key";
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "50";
  time += 120_000;
  Date.now = () => time;
  imageFetchDns.lookupAll = async () => [{ address: "203.0.113.10", family: 4 }];
  globalThis.fetch = () => { throw new Error("Unexpected fetch"); };
});
afterEach(() => {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  imageFetchDns.lookupAll = originalLookup;
  envNames.forEach((name, i) => {
    if (previous[i] === undefined) delete process.env[name];
    else process.env[name] = previous[i];
  });
});

const messages = [
  { role: "system", content: "Explain the note" },
  { role: "user", content: "What is Nostr?" },
];
function success(content = "An open protocol.") {
  return Response.json({ message: { role: "assistant", content }, done: true });
}
async function call({ method = "POST", token = crypto.randomUUID(), body = { messages, webSearch: false } } = {}) {
  const res = {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
  await handler({ method, headers: { host: "example.test", origin: "https://example.test", "x-inference-client": token }, body }, res);
  return res;
}

test("default backup talks directly to ollama.com with the cloud alias's API tag", async () => {
  process.env.INFERENCE_API_KEY = "legacy-gemini-key";
  process.env.GEMINI_MODEL = "gemini-only";
  process.env.INFERENCE_MODEL = "old-gemini-model";
  process.env.GEMINI_FALLBACK_ENABLED = "false";
  assert.equal((await call({ method: "GET" })).statusCode, 200);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://ollama.com/api/chat");
    assert.equal(options.headers.Authorization, "Bearer test-ollama-key");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gemma4:31b");
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.deepEqual(body.options, { num_predict: 2048, temperature: 0.3 });
    assert.deepEqual(body.messages, messages);
    assert.equal(body.tools, undefined);
    return success();
  };
  const response = await call({ body: { messages, webSearch: false, options: { reasoningEffort: "none", temperature: 0.3 } } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.model, "gemma4:31b");
  assert.equal(response.body.content, "An open protocol.");
});

test("Ollama never reuses Gemini credentials, even with an explicit selector", async () => {
  delete process.env.OLLAMA_API_KEY;
  process.env.INFERENCE_API_KEY = "legacy-gemini-key";
  process.env.GEMINI_API_KEY = "gemini-key";
  for (const provider of [undefined, "ollama"]) {
    if (provider) process.env.INFERENCE_PROVIDER = provider;
    const response = await call({ method: "GET" });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "missing_api_key");
  }
});

test("provider selection rejects typos and honors the disable flag", async () => {
  process.env.INFERENCE_PROVIDER = "olllama";
  assert.equal((await call()).body.error, "invalid_provider");
  process.env.INFERENCE_PROVIDER = "ollama";
  process.env.INFERENCE_FALLBACK_ENABLED = "false";
  assert.equal((await call()).body.error, "disabled");
});

test("provider-specific model takes precedence and ordinary model tags pass through", async () => {
  process.env.INFERENCE_PROVIDER = "ollama";
  process.env.INFERENCE_MODEL = "generic-model";
  process.env.OLLAMA_MODEL = "custom:cloud";
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, "custom:cloud");
    return success();
  };
  assert.equal((await call()).statusCode, 200);
  delete process.env.OLLAMA_MODEL;
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, "generic-model");
    return success();
  };
  assert.equal((await call()).statusCode, 200);
});

test("Ollama receives downloaded and inline images as base64", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url === "https://images.example.test/photo.png") {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    }
    assert.equal(url, "https://ollama.com/api/chat");
    assert.deepEqual(JSON.parse(options.body).messages, [{ role: "user", content: "Describe these", images: ["AQID", "BAUG"] }]);
    return success();
  };
  const response = await call({ body: { webSearch: false, messages: [{ role: "user", content: [
    { type: "image", url: "https://images.example.test/photo.png" },
    { type: "image", mediaType: "image/png", data: "BAUG" },
    { type: "text", text: "Describe these" },
  ] }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 2);
});

test("blocked image destinations never reach Ollama or a private host", async () => {
  imageFetchDns.lookupAll = async () => [{ address: "127.0.0.1", family: 4 }];
  let requests = 0;
  globalThis.fetch = async () => { requests++; return success(); };
  const response = await call({ body: { messages: [{ role: "user", content: [
    { type: "image", url: "https://127.0.0.1.nip.io/photo.png" },
    { type: "text", text: "Describe this" },
  ] }] } });
  assert.equal(response.statusCode, 502);
  assert.equal(requests, 0);
});

test("web search tools execute on ollama.com and append sources to the final answer", async () => {
  const paths = [];
  globalThis.fetch = async (url, options) => {
    paths.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-ollama-key");
    const body = JSON.parse(options.body);
    if (paths.length === 1) {
      assert.equal(body.tools[0].function.name, "web_search");
      return Response.json({ message: { role: "assistant", content: "", tool_calls: [
        { function: { name: "web_search", arguments: { query: "Nostr protocol" } } },
      ] } });
    }
    if (url.endsWith("/web_search")) {
      assert.deepEqual(body, { query: "Nostr protocol", max_results: 3 });
      return Response.json({ results: [{ title: "Nostr", url: "https://nostr.com", content: "A protocol" }] });
    }
    assert.equal(body.messages.at(-1).role, "tool");
    assert.equal(JSON.parse(body.messages.at(-1).content).results[0].url, "https://nostr.com");
    return success("Nostr is a protocol.");
  };
  const response = await call({ body: { messages, webSearch: true } });
  assert.equal(response.statusCode, 200);
  assert.match(response.body.content, /\[Nostr\]\(https:\/\/nostr.com\)/);
  assert.deepEqual(paths, ["https://ollama.com/api/chat", "https://ollama.com/api/web_search", "https://ollama.com/api/chat"]);
});

test("Ollama 429 starts a cooldown, preserves Retry-After and releases the daily allowance", async () => {
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "1";
  const token = crypto.randomUUID();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "30" } });
  };
  const response = await call({ token });
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.error, "rate_limited");
  assert.equal(response.headers["Retry-After"], "30");
  assert.equal((await call({ token: "other-browser" })).statusCode, 429);
  assert.equal(requests, 1);
  time += 30_000;
  globalThis.fetch = async () => success();
  assert.equal((await call({ token })).statusCode, 200);
  assert.equal((await call({ token })).body.error, "client_limit");
});

test("local request limits count failed attempts and block rotated browser tokens", async () => {
  process.env.OLLAMA_REQUESTS_PER_MINUTE = "1";
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("network failure"); };
  assert.equal((await call()).statusCode, 502);
  const blocked = await call();
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers["Retry-After"], "60");
  assert.equal(requests, 1);
  time += 60_000;
  globalThis.fetch = async () => success();
  assert.equal((await call()).statusCode, 200);
});

test("browser minute limits apply even when failed explanations release daily quota", async () => {
  process.env.OLLAMA_CLIENT_REQUESTS_PER_MINUTE = "1";
  const token = crypto.randomUUID();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response("Bad gateway", { status: 502 });
  };
  assert.equal((await call({ token })).statusCode, 503);
  assert.equal((await call({ token })).body.error, "rate_limited");
  assert.equal(requests, 1);
  assert.equal((await call()).statusCode, 503);
  time += 60_000;
  globalThis.fetch = async () => success();
  assert.equal((await call({ token })).statusCode, 200);
});

test("search and continuation calls use the same upstream request budget", async () => {
  process.env.OLLAMA_REQUESTS_PER_MINUTE = "2";
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    if (url.endsWith("/web_search")) return Response.json({ results: [] });
    return Response.json({ message: { role: "assistant", tool_calls: [
      { function: { name: "web_search", arguments: { query: "Nostr" } } },
    ] } });
  };
  const response = await call({ body: { messages, webSearch: true } });
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.error, "rate_limited");
  assert.equal(requests, 2);
});

test("search quota errors advise disabling search and do not retry the provider", async () => {
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    if (url.endsWith("/web_search")) return new Response("Quota", { status: 429 });
    return Response.json({ message: { role: "assistant", tool_calls: [
      { function: { name: "web_search", arguments: { query: "Nostr" } } },
    ] } });
  };
  const response = await call({ body: { messages, webSearch: true } });
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.error, "search_quota");
  assert.equal(response.headers["Retry-After"], "60");
  assert.equal(requests, 2);
});

test("search tools stop after two searches, and unexpected tools never execute", async () => {
  const paths = [];
  globalThis.fetch = async (url, options) => {
    paths.push(url);
    if (url.endsWith("/web_search")) return Response.json({ results: [] });
    const body = JSON.parse(options.body);
    if (paths.length === 5) {
      assert.equal(body.tools, undefined);
      return success();
    }
    return Response.json({ message: { role: "assistant", content: "", tool_calls: [
      { function: { name: "web_search", arguments: { query: "Nostr" } } },
    ] } });
  };
  assert.equal((await call({ body: { messages, webSearch: true } })).statusCode, 200);
  assert.equal(paths.length, 5);
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({ message: { role: "assistant", tool_calls: [
      { function: { name: "web_fetch", arguments: { url: "http://localhost" } } },
    ] } });
  };
  assert.equal((await call({ body: { messages, webSearch: true } })).statusCode, 502);
  assert.equal(requests, 1);
});

test("concurrent explanations are capped and slots recover after provider failure", async () => {
  process.env.OLLAMA_MAX_CONCURRENT = "1";
  let complete;
  globalThis.fetch = () => new Promise((resolve) => { complete = resolve; });
  const first = call();
  assert.equal((await call()).statusCode, 429);
  complete(new Response("Busy", { status: 503 }));
  assert.equal((await first).body.error, "provider_busy");
  globalThis.fetch = async () => success();
  assert.equal((await call()).statusCode, 200);
});

test("malformed, empty and timed out responses release the daily allowance", async () => {
  process.env.INFERENCE_CLIENT_DAILY_LIMIT = "1";
  const token = crypto.randomUUID();
  for (const response of [new Response("not-json"), Response.json({ message: { role: "assistant", content: "" } })]) {
    globalThis.fetch = async () => response;
    assert.equal((await call({ token })).statusCode, 502);
  }
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = () => AbortSignal.abort(new DOMException("Timed out", "TimeoutError"));
    assert.equal((await call({ token })).body.error, "provider_busy");
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
  globalThis.fetch = async () => success();
  assert.equal((await call({ token })).statusCode, 200);
});
