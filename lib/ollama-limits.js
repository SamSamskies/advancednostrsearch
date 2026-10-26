import { envInt } from "./env.js";

export function rateLimitError(retryAfter = 60, code = "rate_limited") {
  return Object.assign(new Error(code), {
    status: 429,
    retryAfter: Math.max(1, Math.ceil(retryAfter)),
  });
}

/** Per-process protection. Vercel instances do not share this state. */
export function createOllamaLimiter(now = () => Date.now()) {
  let requests = [];
  let active = 0;
  let cooldownUntil = 0;
  const clients = new Map();
  const minute = 60_000;

  function checkProvider() {
    const time = now();
    requests = requests.filter((at) => at > time - minute);
    if (cooldownUntil > time) {
      throw rateLimitError((cooldownUntil - time) / 1000);
    }
    if (requests.length >= envInt("OLLAMA_REQUESTS_PER_MINUTE", 20)) {
      throw rateLimitError((requests[0] + minute - time) / 1000);
    }
  }

  return {
    begin(clientId) {
      checkProvider();
      if (active >= envInt("OLLAMA_MAX_CONCURRENT", 2)) {
        throw rateLimitError(5);
      }
      const time = now();
      for (const [id, times] of clients) {
        if (times.at(-1) <= time - minute) clients.delete(id);
      }
      const times = (clients.get(clientId) || []).filter((at) => at > time - minute);
      if (times.length >= envInt("OLLAMA_CLIENT_REQUESTS_PER_MINUTE", 5)) {
        throw rateLimitError((times[0] + minute - time) / 1000);
      }
      times.push(time);
      clients.set(clientId, times);
      active++;
      let ended = false;
      return () => {
        if (!ended) active--;
        ended = true;
      };
    },
    consumeRequest() {
      checkProvider();
      // Attempts count even if the provider fails; retries cannot bypass limits.
      requests.push(now());
    },
    cooldown(retryAfter) {
      const seconds = Number(retryAfter);
      const parsedDate = Date.parse(retryAfter);
      const until = retryAfter && Number.isFinite(seconds) && seconds >= 0
        ? now() + seconds * 1000
        : Number.isFinite(parsedDate) ? parsedDate : now() + minute;
      cooldownUntil = Math.max(cooldownUntil, now() + 1000, until);
      return Math.ceil((cooldownUntil - now()) / 1000);
    },
  };
}

export const ollamaLimiter = createOllamaLimiter();
