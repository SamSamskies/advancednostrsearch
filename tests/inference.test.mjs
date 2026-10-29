import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  createHostedBackend,
  setHostedConsent,
} from "../src/hosted-backend.ts";
import { systemPrompt } from "../src/ask-ai-context.ts";
import {
  canSearchWeb,
  completeChat,
  prepareInference,
  describeInferenceError,
} from "../src/inference.ts";
import { setWebSearchEnabled } from "../src/settings.ts";

const originalFetch = globalThis.fetch;
const originals = Object.fromEntries(
  ["window", "location", "localStorage", "sessionStorage"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function setup() {
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  globalThis.location = { origin: "https://example.test" };
  globalThis.window = { isSecureContext: true };
  setWebSearchEnabled(true);
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else Object.defineProperty(globalThis, key, value);
  }
});
async function drain(stream) {
  const result = [];
  for await (const chunk of stream) result.push(chunk);
  return result;
}

const messages = [
  { role: "system", content: "Explain a note" },
  { role: "user", content: "Hello Nostr" },
];

test("IPA takes priority and streams status, deltas, and the final answer", async () => {
  setup();
  const statuses = [],
    deltas = [];
  window.inference = {
    getFeatures: () => ({ webSearch: true }),
    async *request(payload) {
      assert.deepEqual(payload.messages, messages);
      assert.deepEqual(payload.tools, [{ type: "web_search" }]);
      yield { type: "accepted" };
      yield { type: "reasoning_delta", content: "Checking" };
      yield { type: "delta", content: "Hello " };
      yield { type: "delta", content: "reader" };
      yield {
        type: "done",
        model: "test",
        message: { role: "assistant", content: "Hello reader." },
      };
    },
  };
  globalThis.fetch = () => {
    throw new Error("IPA must not send a hosted request");
  };
  assert.equal(await prepareInference(), "ipa");
  const result = await completeChat({
    messages,
    onStatus: (v) => statuses.push(v),
    onDelta: (v) => deltas.push(v),
  });
  assert.equal(result.content, "Hello reader.");
  assert.equal(result.model, "test");
  assert.deepEqual(statuses, ["generating", "thinking"]);
  assert.deepEqual(deltas, ["Hello ", "Hello reader", "Hello reader."]);
});

test("web search toggle omits tools and vision-capable IPA gets proxied images", async () => {
  setup();
  setWebSearchEnabled(false);
  window.inference = {
    getFeatures: () => ({ imageInput: true, webSearch: true }),
    async *request(payload) {
      assert.equal(payload.tools, undefined);
      assert.equal(
        payload.messages[0].content[0].url,
        "https://wsrv.nl/?url=https%3A%2F%2Fexample.com%2Fimage.png",
      );
      yield {
        type: "done",
        message: { role: "assistant", content: "A picture" },
      };
    },
  };
  await completeChat({
    messages: [
      {
        role: "user",
        content: [
          { type: "image", url: "https://example.com/image.png" },
          { type: "text", text: "Describe this" },
        ],
      },
    ],
  });
});

test("text-only IPA still answers notes containing images without hosted consent", async () => {
  setup();
  window.inference = {
    getFeatures: () => ({}),
    async *request(payload) {
      assert.equal(
        payload.messages[0].content,
        "Describe this https://example.com/a.png",
      );
      yield {
        type: "done",
        message: { role: "assistant", content: "Text reply" },
      };
    },
  };
  globalThis.fetch = () => {
    throw new Error("No hosted request without consent");
  };
  await completeChat({
    messages: [
      {
        role: "user",
        content: [
          { type: "image", url: "https://example.com/a.png" },
          { type: "text", text: "Describe this https://example.com/a.png" },
        ],
      },
    ],
  });
});

test("text-only IPA with hosted consent can search on the image fallback path", async () => {
  setup();
  setHostedConsent(true);
  window.inference = {
    getFeatures: () => ({}),
    async *request() {
      throw new Error("IPA must not handle consented image fallback");
    },
  };
  let posted;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "GET") return Response.json({ ok: true });
    posted = JSON.parse(options.body);
    return Response.json({ content: "Hosted vision answer" });
  };
  assert.equal(canSearchWeb(false), false);
  assert.equal(canSearchWeb(true), true);
  const result = await completeChat({
    messages: [
      {
        role: "user",
        content: [
          { type: "image", url: "https://example.com/a.png" },
          { type: "text", text: "Describe this" },
        ],
      },
    ],
  });
  assert.equal(result.content, "Hosted vision answer");
  assert.equal(posted.webSearch, true);
});

test("text-only IPA drops the vision prompt and keeps imeta-only image URLs", async () => {
  setup();
  const imageUrl = "https://example.com/imeta-only.webp";
  const noteText =
    "A public Nostr note:\nAuthor: Alice\n\nNote:\n(no text — media-only note)";
  window.inference = {
    getFeatures: () => ({}),
    async *request(payload) {
      assert.equal(
        payload.messages[0].content,
        systemPrompt(true, false, "es-ES"),
      );
      assert.equal(payload.messages[1].content, `${noteText}\n\n${imageUrl}`);
      yield {
        type: "done",
        message: { role: "assistant", content: "A photo" },
      };
    },
  };
  globalThis.fetch = () => {
    throw new Error("No hosted request without consent");
  };
  await completeChat({
    messages: [
      { role: "system", content: systemPrompt(true, true, "es-ES") },
      {
        role: "user",
        content: [
          { type: "image", url: imageUrl },
          { type: "text", text: noteText },
        ],
      },
    ],
  });
});

for (const path of ["ipa", "hosted"]) {
  test(`${path} receives the shared language prompt for initial explanations and follow-ups`, async () => {
    setup();
    setWebSearchEnabled(false);
    const prompt = systemPrompt(false, false, "es-ES");
    const history = [
      { role: "system", content: prompt },
      {
        role: "user",
        content: "A public Nostr note:\nNote:\nNostr is an open protocol.",
      },
    ];
    const received = [];
    if (path === "ipa") {
      window.inference = {
        getFeatures: () => ({}),
        async *request(payload) {
          received.push(payload.messages);
          yield {
            type: "done",
            message: { role: "assistant", content: "Test answer" },
          };
        },
      };
    } else {
      setHostedConsent(true);
      globalThis.fetch = async (_url, options = {}) => {
        if (options.method === "GET") return Response.json({ ok: true });
        received.push(JSON.parse(options.body).messages);
        return Response.json({ content: "Test answer" });
      };
    }
    for (const question of [
      null,
      "Was ist ein Relay?",
      "Reply in French: what is a relay?",
    ]) {
      if (question) history.push({ role: "user", content: question });
      const result = await completeChat({ messages: [...history] });
      const request = received.at(-1);
      assert.equal(request[0].content, prompt);
      assert.deepEqual(request, history);
      history.push({ role: "assistant", content: result.content });
    }
    assert.equal(received.length, 3);
  });
}

test("hosted probe requires consent before sending note content", async () => {
  setup();
  let posts = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "GET") return new Response('{"ok":true}');
    posts++;
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.ok(options.headers["X-Inference-Client"]);
    assert.deepEqual(JSON.parse(options.body).messages, messages);
    assert.equal(JSON.parse(options.body).options.reasoningEffort, "none");
    return Response.json({ content: "Hosted answer", model: "test-model" });
  };
  assert.equal(await prepareInference(), "consent");
  const session = await createHostedBackend().create();
  await assert.rejects(
    () => drain(session.request({ method: "chat", messages })),
    (error) => error.code === "permission_denied",
  );
  assert.equal(posts, 0);
  setHostedConsent(true);
  assert.equal(await prepareInference(), "hosted");
  const result = await completeChat({ messages });
  assert.equal(result.content, "Hosted answer");
  assert.equal(posts, 1);
});

test("Stop aborts an in-flight IPA response", async () => {
  setup();
  const controller = new AbortController();
  window.inference = {
    getFeatures: () => ({}),
    async *request(payload) {
      yield { type: "accepted" };
      if (payload.signal.aborted)
        throw new DOMException("Stopped", "AbortError");
      await new Promise((resolve, reject) =>
        payload.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Stopped", "AbortError")),
          { once: true },
        ),
      );
    },
  };
  await assert.rejects(
    () =>
      completeChat({
        messages,
        signal: controller.signal,
        onStatus: () => controller.abort(),
      }),
    (error) => error.name === "AbortError",
  );
});

test("unavailable fallback and quota errors give actionable messages", async () => {
  setup();
  globalThis.fetch = async () => new Response("", { status: 503 });
  assert.equal(await prepareInference(), "unavailable");
  assert.match(
    describeInferenceError(
      Object.assign(new Error("client_limit"), { code: "unavailable" }),
    ),
    /allowance/,
  );
  assert.match(
    describeInferenceError(new DOMException("Stopped", "AbortError")),
    /Stopped/,
  );
});
