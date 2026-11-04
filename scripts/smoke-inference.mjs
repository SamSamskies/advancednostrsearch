/** Public-proxy smoke; no provider/app credentials needed. Follow-up adds one generation. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";

const { values } = parseArgs({ options: {
  url: { type: "string" },
  vision: { type: "boolean", default: false },
  search: { type: "boolean", default: false },
  checks: { type: "boolean", default: false },
  provider: { type: "string" },
  vercel: { type: "boolean", default: false },
  "image-url": { type: "string" },
  followup: { type: "boolean", default: false },
} });
if (!values.url) throw new Error("Usage: npm run smoke:inference -- --url https://HOST/api/inference [--provider replit] [--checks] [--vision | --image-url URL] [--search] [--followup] [--vercel]");
if (values.provider && !["ollama", "gemini", "replit"].includes(values.provider)) throw new Error("Invalid expected provider");
const endpoint = new URL(values.url);
if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
    endpoint.search || endpoint.hash || endpoint.pathname !== "/api/inference") throw new Error("Invalid proxy URL");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
const headers = {
  "Content-Type": "application/json",
  Origin: endpoint.origin,
  "X-Inference-Client": crypto.randomUUID(),
  ...(bypass && !values.vercel ? { "x-vercel-protection-bypass": bypass } : {}),
};
async function request(method, body, extra = {}, query = "") {
  if (values.vercel) {
    // CLI supplies the protected-preview bypass internally. Never log its value.
    const args = ["curl", endpoint.pathname + query, "--deployment", endpoint.origin, "--",
      "--silent", "--show-error", "--max-time", "195", "--write-out", "\n%{http_code}", "--request", method];
    for (const [name, value] of Object.entries({ ...headers, ...extra })) args.push("--header", `${name}: ${value}`);
    if (body !== undefined) args.push("--data-binary", "@-");
    const command = process.env.VERCEL_CLI_PATH;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command ? process.execPath : "vercel", command ? [command, ...args] : args,
        { stdio: ["pipe", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.resume();
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`Vercel curl exited ${code}`)));
      child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
    });
    const split = result.lastIndexOf("\n");
    const status = Number(result.slice(split + 1));
    let data;
    try { data = JSON.parse(result.slice(0, split)); } catch { throw new Error(`Proxy returned non-JSON HTTP ${status}`); }
    return { status, data };
  }
  const response = await fetch(endpoint.href + query, {
    method, headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error", signal: AbortSignal.timeout(195_000),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`Proxy returned non-JSON HTTP ${response.status}`); }
  if (bypass) assert.ok(!JSON.stringify(data).includes(bypass), "Credential echo in proxy response");
  return { status: response.status, data };
}
const messages = [{ role: "user", content: "Reply with the word ready." }];
const probe = await request("GET");
assert.equal(probe.status, 200, "Availability probe failed");
assert.equal(probe.data.ok, true);
if (values.checks) {
  for (const [method, body, extra, status] of [
    ["PUT", undefined, {}, 405],
    ["POST", { messages, webSearch: false }, { Origin: "https://invalid-origin.example" }, 403],
    ["POST", { messages: [], webSearch: false }, {}, 400],
    ["POST", { messages, webSearch: false, options: { temperature: 10 } }, {}, 400],
    ["POST", { messages, webSearch: false }, { "X-Inference-Client": "" }, 400],
    ["POST", { messages: [{ role: "user", content: "😀".repeat(26_000) }], webSearch: false }, {}, 413],
  ]) {
    const result = await request(method, body, extra);
    assert.equal(result.status, status, `Negative ${method} check failed`);
  }
  console.log("PASS: methods, origin, prompt/options/client validation and UTF-8 limit");
}

// An inline image avoids external image hosts. It is a 64x64 red PNG.
const image = { type: "image", mediaType: "image/png", data:
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdLep8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3IPanc8OLDQitxAAAAAElFTkSuQmCC" };
const prompt = [
  ...(values.vision ? ["Describe the color in this image in one short sentence."] : []),
  ...(values["image-url"] ? ["Describe the main visible scene in this photo in two sentences."] : []),
  ...(values.search ? ["Search the web for the official Nostr protocol repository. Include an HTTPS source link."] : []),
].join(" ") || "Reply with the word ready.";
const noteImage = values["image-url"] ? { type: "image", url: values["image-url"] } : values.vision ? image : null;
const conversation = [{ role: "user", content: noteImage ? [noteImage, { type: "text", text: prompt }] : prompt }];
const generated = await request("POST", {
  messages: conversation,
  webSearch: values.search,
  // Browser selectors must have no effect on the backend-owned provider/model.
  provider: "forged-provider", model: "forged-model", stream: true,
}, {
  Authorization: "Bearer smoke-forged-auth",
  "X-Inference-App": "smoke-forged-app",
  "X-Inference-Provider-Key": "smoke-forged-key",
}, "?provider=forged-provider&provider=second-forgery&model=forged-model");
assert.equal(generated.status, 200, "Generation failed; inspect sanitized status/error metadata in the deployment");
assert.ok(typeof generated.data.content === "string" && generated.data.content.trim(), "Missing content");
assert.ok(typeof generated.data.model === "string" && generated.data.model !== "forged-model", "Invalid backend model");
if (values.provider) assert.equal(generated.data.provider, values.provider, "Unexpected backend provider");
for (const forged of ["smoke-forged-auth", "smoke-forged-key", "smoke-forged-app"]) {
  assert.ok(!JSON.stringify(generated.data).includes(forged), "Forged credential echo");
}
if (values["image-url"]) console.log(`Full-size image description: ${generated.data.content}`);
if (values.search) assert.match(generated.data.content, /https:\/\//, "Search smoke requires an HTTPS citation");
if (values.vision) assert.match(generated.data.content, /\bred\b/i, "Vision smoke requires the correct image color");
console.log(`PASS: generation, backend selectors, non-streaming JSON${values.provider ? `, provider ${values.provider}` : ""}${values.vision ? ", image color" : ""}${values.search ? ", search citation (inspect provider usage to confirm search execution)" : ""}`);

if (values.followup) {
  conversation.push({ role: "assistant", content: generated.data.content },
    { role: "user", content: "Summarize your previous answer in one short sentence." });
  const result = await request("POST", { messages: conversation, webSearch: false });
  assert.equal(result.status, 200, "Follow-up failed");
  assert.ok(typeof result.data.content === "string" && result.data.content.trim());
  assert.equal(result.data.model, generated.data.model);
  console.log("PASS: follow-up conversation, provider-default reasoning");
}
