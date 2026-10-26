import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createOllamaLimiter } from "../lib/ollama-limits.js";

const envNames = ["OLLAMA_REQUESTS_PER_MINUTE", "OLLAMA_CLIENT_REQUESTS_PER_MINUTE", "OLLAMA_MAX_CONCURRENT"];
let previous;
beforeEach(() => {
  previous = envNames.map((name) => process.env[name]);
  process.env.OLLAMA_REQUESTS_PER_MINUTE = "2";
  process.env.OLLAMA_CLIENT_REQUESTS_PER_MINUTE = "1";
  process.env.OLLAMA_MAX_CONCURRENT = "1";
});
afterEach(() => envNames.forEach((name, i) => {
  if (previous[i] === undefined) delete process.env[name];
  else process.env[name] = previous[i];
}));

test("concurrency slots release once, while client attempts stay counted for a minute", () => {
  let time = 1_000_000;
  const limiter = createOllamaLimiter(() => time);
  const finish = limiter.begin("alice");
  assert.throws(() => limiter.begin("bob"), { status: 429, retryAfter: 5 });
  finish();
  finish();
  assert.throws(() => limiter.begin("alice"), { status: 429, retryAfter: 60 });
  const finishBob = limiter.begin("bob");
  assert.throws(() => limiter.begin("carol"), { status: 429 });
  finishBob();
  time += 60_000;
  limiter.begin("alice")();
});

test("provider attempt limits cover all clients and expire on a rolling window", () => {
  let time = 1_000_000;
  const limiter = createOllamaLimiter(() => time);
  limiter.consumeRequest();
  time += 10_000;
  limiter.consumeRequest();
  assert.throws(() => limiter.consumeRequest(), { status: 429, retryAfter: 50 });
  assert.throws(() => limiter.begin("another-browser"), { status: 429 });
  time += 50_000;
  limiter.consumeRequest();
  assert.throws(() => limiter.consumeRequest(), { status: 429, retryAfter: 10 });
});

test("upstream cooldown honors seconds, dates, and a safe default", () => {
  let time = 1_000_000;
  const limiter = createOllamaLimiter(() => time);
  assert.equal(limiter.cooldown("120"), 120);
  assert.throws(() => limiter.begin("alice"), { status: 429, retryAfter: 120 });
  time += 120_000;
  limiter.begin("alice")();
  assert.equal(limiter.cooldown(new Date(time + 90_000).toUTCString()), 90);
  time += 90_000;
  assert.equal(limiter.cooldown(null), 60);
  time += 60_000;
  assert.equal(limiter.cooldown("unreadable"), 60);
});
