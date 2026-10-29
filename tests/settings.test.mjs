import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete globalThis.localStorage;
});

test("note images default on, persist across reloads, and stay independent of web search", async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const settings = await import("../src/settings.ts?initial");
  assert.equal(settings.isIncludeImagesEnabled(), true);
  assert.equal(settings.isWebSearchEnabled(), true);
  settings.setIncludeImagesEnabled(false);
  assert.equal(values.get("advancednostrsearch.includeImages"), "0");
  assert.equal(settings.isWebSearchEnabled(), true);
  const reloaded = await import("../src/settings.ts?reloaded");
  assert.equal(reloaded.isIncludeImagesEnabled(), false);
  reloaded.setWebSearchEnabled(false);
  reloaded.setIncludeImagesEnabled(true);
  assert.equal(reloaded.isWebSearchEnabled(), false);
  assert.equal(values.get("advancednostrsearch.includeImages"), "1");
  assert.equal((await import("../src/settings.ts?enabled")).isIncludeImagesEnabled(), true);
});

test("note images remain usable when browser storage is unavailable", async () => {
  globalThis.localStorage = {
    getItem() { throw new Error("Storage unavailable"); },
    setItem() { throw new Error("Storage unavailable"); },
  };
  const settings = await import("../src/settings.ts?unavailable");
  assert.equal(settings.isIncludeImagesEnabled(), true);
  settings.setIncludeImagesEnabled(false);
  assert.equal(settings.isIncludeImagesEnabled(), false);
  settings.setIncludeImagesEnabled(true);
  assert.equal(settings.isIncludeImagesEnabled(), true);
});
