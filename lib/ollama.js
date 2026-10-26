import { ollamaLimiter, rateLimitError } from "./ollama-limits.js";

const API_BASE = "https://ollama.com/api";
const MAX_SEARCHES = 2;
const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information. Cite useful result URLs in your answer.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
};

function providerError(status = 502, code = "provider_error") {
  return Object.assign(new Error(code), { status });
}

async function post(path, body, key, signal) {
  signal.throwIfAborted();
  ollamaLimiter.consumeRequest();
  const response = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    // Do not forward credentials to redirects from the hosted API.
    redirect: "error",
    signal,
  });
  if (response.status === 429) {
    const retryAfter = ollamaLimiter.cooldown(response.headers.get("retry-after"));
    throw rateLimitError(retryAfter, path === "web_search" ? "search_quota" : "rate_limited");
  }
  if (!response.ok) {
    throw providerError(
      response.status >= 500 ? 503 : 502,
      response.status >= 500 ? "provider_busy" : "provider_error",
    );
  }
  return response.json();
}

/** Convert the validated prompt, after shared image fetching, to native chat. */
function toMessages(prompt) {
  const messages = [];
  if (prompt.system) messages.push({ role: "system", content: prompt.system });
  for (const turn of prompt.contents) {
    const text = [];
    const images = [];
    for (const part of turn.parts) {
      if (typeof part.text === "string") text.push(part.text);
      else if (part.inlineData) images.push(part.inlineData.data);
      // Ollama requires base64 bytes. Never silently omit an unreadable image.
      else if (part.fileData) throw providerError();
    }
    messages.push({
      role: turn.role === "model" ? "assistant" : "user",
      content: text.join("\n\n"),
      ...(images.length ? { images } : {}),
    });
  }
  return messages;
}

export async function completeOllama({ prompt, model, key, options, webSearch, signal }) {
  const messages = toMessages(prompt);
  const body = {
    // :cloud is the app/CLI alias; ollama.com uses the catalog's API tag.
    model: model === "gemma4:cloud" ? "gemma4:31b" : model,
    messages,
    stream: false,
    options: { num_predict: 2048, ...(options.temperature === undefined ? {} : { temperature: options.temperature }) },
  };
  if (options.reasoningEffort && options.reasoningEffort !== "auto") {
    body.think = options.reasoningEffort !== "none";
  }
  let searches = 0;
  const sources = new Map();
  // At most two searches and three chat calls, within one shared timeout.
  for (let round = 0; round <= MAX_SEARCHES; round++) {
    const data = await post("chat", {
      ...body,
      ...(webSearch && searches < MAX_SEARCHES ? { tools: [SEARCH_TOOL] } : {}),
    }, key, signal);
    const message = data?.message;
    if (data?.error || !message || message.role !== "assistant") throw providerError();
    const calls = message.tool_calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      const text = typeof message.content === "string" ? message.content.trim() : "";
      if (!text) throw providerError();
      return { content: text, model: body.model, sources: [...sources.values()] };
    }
    if (!webSearch || searches >= MAX_SEARCHES || calls.length > MAX_SEARCHES - searches) {
      throw providerError();
    }
    messages.push(message);
    for (const call of calls) {
      const query = call?.function?.arguments?.query;
      if (call?.function?.name !== "web_search" || typeof query !== "string" || !query.trim() || query.length > 1000) {
        throw providerError();
      }
      searches++;
      const result = await post("web_search", { query: query.trim(), max_results: 3 }, key, signal);
      if (!Array.isArray(result?.results)) throw providerError();
      const results = result.results.slice(0, 3).flatMap((item) => {
        if (typeof item?.url !== "string" || !/^https?:\/\//i.test(item.url)) return [];
        const title = typeof item.title === "string" ? item.title.slice(0, 300) : item.url;
        sources.set(item.url, { title, uri: item.url });
        return [{ title, url: item.url, content: typeof item.content === "string" ? item.content.slice(0, 4000) : "" }];
      });
      messages.push({ role: "tool", tool_name: "web_search", content: JSON.stringify({ results }) });
    }
  }
  throw providerError();
}
