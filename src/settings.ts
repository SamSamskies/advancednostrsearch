import { useSyncExternalStore } from "react";

function booleanPreference(key: string) {
  const listeners = new Set<() => void>();
  let cached: boolean | undefined;

  function get(): boolean {
    if (cached !== undefined) return cached;
    try {
      cached = localStorage.getItem(key) !== "0";
    } catch {
      cached = true;
    }
    return cached;
  }

  function set(enabled: boolean): void {
    cached = enabled;
    try {
      localStorage.setItem(key, enabled ? "1" : "0");
    } catch {
      // Keep the preference usable when browser storage is unavailable.
    }
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      cached = undefined;
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  function useEnabled(): boolean {
    return useSyncExternalStore(subscribe, get, () => true);
  }

  return { get, set, useEnabled };
}

const webSearch = booleanPreference("advancednostrsearch.webSearch");
export const isWebSearchEnabled = webSearch.get;
export const setWebSearchEnabled = webSearch.set;
export const useWebSearchEnabled = webSearch.useEnabled;

const includeImages = booleanPreference("advancednostrsearch.includeImages");
export const isIncludeImagesEnabled = includeImages.get;
export const setIncludeImagesEnabled = includeImages.set;
export const useIncludeImagesEnabled = includeImages.useEnabled;
