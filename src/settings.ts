import { useSyncExternalStore } from "react";

const WEB_SEARCH_KEY = "advancednostrsearch.webSearch";
const listeners = new Set<() => void>();
let cached: boolean | undefined;

export function isWebSearchEnabled(): boolean {
  if (cached !== undefined) return cached;
  try {
    cached = localStorage.getItem(WEB_SEARCH_KEY) !== "0";
  } catch {
    cached = true;
  }
  return cached;
}

export function setWebSearchEnabled(enabled: boolean): void {
  cached = enabled;
  try {
    localStorage.setItem(WEB_SEARCH_KEY, enabled ? "1" : "0");
  } catch {
    // Keep the preference usable when browser storage is unavailable.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== WEB_SEARCH_KEY && event.key !== null) return;
    cached = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useWebSearchEnabled(): boolean {
  return useSyncExternalStore(subscribe, isWebSearchEnabled, () => true);
}
