import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("Vite serves the server-only shared proxy alongside note previews", async () => {
  const previous = { ...process.env };
  const upstreamRequests = [];
  const upstream = createHttpServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    upstreamRequests.push({ url: req.url, headers: req.headers, body });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.method === "GET" ? { ok: true } : { content: "Local answer", provider: "replit" }));
  });
  let vite;
  try {
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    delete process.env.VERCEL_ENV;
    Object.assign(process.env, {
      SHARED_INFERENCE_ENABLED: "true",
      SHARED_INFERENCE_PROVIDER: "replit",
      SHARED_INFERENCE_URL: `http://127.0.0.1:${upstream.address().port}/api/inference`,
      SHARED_INFERENCE_APP_SECRET: "local-app-secret",
      SHARED_INFERENCE_REPLIT_API_KEY: "local-provider-key",
      INFERENCE_FALLBACK_ENABLED: "true",
      REPLIT_INFERENCE_MODEL: "local/model",
    });
    vite = await createServer({
      configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
      logLevel: "silent", server: { host: "127.0.0.1", port: 0 },
    });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    assert.deepEqual(await (await fetch(`${origin}/api/inference`)).json(), { ok: true });
    const response = await fetch(`${origin}/api/inference?provider=forged`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Inference-Client": "vite-client" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }], webSearch: false }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, "Local answer");
    assert.equal(upstreamRequests[1].url, "/api/inference?provider=replit");
    assert.equal(upstreamRequests[1].headers["x-inference-app"], "advancednostrsearch");
    assert.equal(upstreamRequests[1].headers.authorization, "Bearer local-app-secret");
    const posted = JSON.parse(upstreamRequests[1].body);
    assert.equal(posted.model, "local/model");
    assert.deepEqual(posted.options, {});
    const oversized = await fetch(`${origin}/api/inference`, {
      method: "POST", headers: { Origin: origin }, body: "😀".repeat(26_000),
    });
    assert.equal(oversized.status, 413);
    assert.equal(upstreamRequests.length, 2);
    // The unrelated preview middleware is still present and rejects invalid URLs.
    assert.equal((await fetch(`${origin}/api/preview?url=file:///private`)).status, 400);
    const browserModule = await (await fetch(`${origin}/src/hosted-backend.ts`)).text();
    assert.ok(!browserModule.includes("local-app-secret"));
    assert.ok(!browserModule.includes("local-provider-key"));
  } finally {
    await vite?.close();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
    for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
    Object.assign(process.env, previous);
  }
});
