import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import test, { afterEach, mock } from "node:test";
import handler from "../api/preview.js";

const url = "http://93.184.216.34/article";
afterEach(() => mock.restoreAll());

async function call({ target = url, method = "GET", origin } = {}) {
  const req = { method, headers: { host: "app.example", ...(origin ? { origin } : {}) }, query: { url: target } };
  const res = {
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return res;
}

function respond(responses) {
  const calls = [];
  mock.method(http, "request", (options, onResponse) => {
    calls.push(options);
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const response = responses.shift();
      assert.ok(response, "Unexpected additional HTTP request");
      const incoming = new EventEmitter();
      incoming.statusCode = response.status ?? 200;
      incoming.headers = { "content-type": "text/html", ...response.headers };
      incoming.destroy = () => {};
      onResponse(incoming);
      incoming.emit("data", Buffer.from(response.html ?? ""));
      incoming.emit("end");
    });
    return req;
  });
  return calls;
}

test("unfurls metadata, resolves relative images, and pins the public destination", async () => {
  const calls = respond([{ html: `<title>Fallback</title>
    <meta property="og:title" content="Nostr &amp; friends">
    <meta content="A public article" name="description">
    <meta property="og:image" content="/image.png">` }]);
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    url, title: "Nostr & friends", description: "A public article",
    image: "http://93.184.216.34/image.png", domain: "93.184.216.34",
  });
  assert.equal(calls[0].hostname, "93.184.216.34");
  assert.equal(calls[0].headers.Host, "93.184.216.34");
  assert.equal(res.headers["Cache-Control"], "public, s-maxage=3600");
});

test("rejects private destinations, unsupported schemes, and credentials before fetching", async () => {
  const calls = respond([]);
  for (const target of ["http://localhost", "http://127.0.0.1", "http://10.0.0.1", "http://169.254.169.254", "http://[::1]", "http://[::ffff:127.0.0.1]", "file:///etc/passwd", "http://user:password@93.184.216.34"]) {
    assert.equal((await call({ target })).statusCode, 400, target);
  }
  assert.equal(calls.length, 0);
});

test("revalidates redirects and refuses a redirect to a private address", async () => {
  const calls = respond([{ status: 302, headers: { location: "http://127.0.0.1/secret" } }]);
  assert.equal((await call()).statusCode, 400);
  assert.equal(calls.length, 1);
});

test("follows public redirects and uses the final page URL", async () => {
  const calls = respond([
    { status: 302, headers: { location: "/next" } },
    { html: "<title>Final page</title>" },
  ]);
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.url, "http://93.184.216.34/next");
  assert.equal(calls[1].path, "/next");
});

test("empty metadata, non-HTML pages, and oversized bodies produce fallback responses", async () => {
  respond([
    { html: "<html></html>" },
    { headers: { "content-type": "image/png" } },
    { html: "x".repeat(1_000_001) },
  ]);
  assert.equal((await call()).statusCode, 404);
  assert.equal((await call()).statusCode, 502);
  assert.equal((await call()).statusCode, 413);
});

test("rejects foreign origins and unsupported methods without fetching", async () => {
  const calls = respond([]);
  assert.equal((await call({ origin: "https://foreign.example" })).statusCode, 403);
  assert.equal((await call({ method: "POST" })).statusCode, 405);
  assert.equal(calls.length, 0);
});
