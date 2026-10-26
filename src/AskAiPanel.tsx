import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import {
  canSearchWeb,
  completeChat,
  describeInferenceError,
  INFERENCE_BRIDGE_HREF,
  isAbortError,
  prepareInference,
  setHostedConsent,
  type ChatStatus,
  type InferenceGate,
  type InferenceMessage,
} from "./inference";
import { setWebSearchEnabled, useWebSearchEnabled } from "./settings";
import type { Kind0Profile } from "./identity";
import { profileLabel } from "./mentions";
import { AskAiMarkdown } from "./AskAiMarkdown";
import type { LocatedEvent } from "./nostr";
import {
  systemPrompt,
  noteContextUserContent,
  patchNoteContextHistory,
} from "./ask-ai-context";

function linkifyInferenceBridge(text: string) {
  const label = "Inference Bridge";
  return text.split(new RegExp(`(${label})`, "g")).map((part, index) =>
    part === label ? (
      <a
        key={`bridge-${index}`}
        href={INFERENCE_BRIDGE_HREF}
        target="_blank"
        rel="noreferrer"
      >
        {label}
      </a>
    ) : (
      part
    ),
  );
}

type VisibleMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      pending?: boolean;
      status?: ChatStatus;
    }
  | { id: string; role: "error"; content: string };

type Thread = {
  history: InferenceMessage[];
  visible: VisibleMessage[];
  introStarted: boolean;
};

const threads = new Map<string, Thread>();
const inflight = new Map<string, AbortController>();

let messageSeq = 0;
function nextId(): string {
  messageSeq += 1;
  return `ask-${messageSeq}`;
}

function emptyThread(): Thread {
  return { history: [], visible: [], introStarted: false };
}

function getThread(noteId: string): Thread {
  const existing = threads.get(noteId);
  if (existing) return existing;
  const created = emptyThread();
  threads.set(noteId, created);
  return created;
}

function snapshot(thread: Thread): Thread {
  return {
    history: [...thread.history],
    visible: [...thread.visible],
    introStarted: thread.introStarted,
  };
}

function isTurnLive(noteId: string): boolean {
  const controller = inflight.get(noteId);
  return controller != null && !controller.signal.aborted;
}

function abortTurn(noteId: string): void {
  const controller = inflight.get(noteId);
  if (!controller) return;
  inflight.delete(noteId);
  controller.abort();
}

function findPendingAssistant(
  visible: VisibleMessage[],
):
  | { message: Extract<VisibleMessage, { role: "assistant" }>; index: number }
  | undefined {
  for (let i = visible.length - 1; i >= 0; i--) {
    const message = visible[i];
    if (message.role === "assistant" && message.pending) {
      return { message, index: i };
    }
  }
  return undefined;
}

function settlePendingThread(noteId: string): string | undefined {
  const live = getThread(noteId);
  const pending = findPendingAssistant(live.visible);
  if (!pending) return undefined;

  const { message, index } = pending;
  const prev = live.visible[index - 1];
  const userVisibleId = prev?.role === "user" ? prev.id : undefined;
  const userText = prev?.role === "user" ? prev.content : undefined;

  if (!message.content) {
    live.visible = live.visible.filter(
      (item) => item.id !== message.id && item.id !== userVisibleId,
    );
    if (userText && live.history.at(-1)?.role === "user") {
      live.history.pop();
    }
    if (!live.visible.some((item) => item.role === "assistant")) {
      live.introStarted = false;
      live.history = [];
    }
    threads.set(noteId, live);
    return userText;
  }

  live.visible = live.visible.map((item) =>
    item.id === message.id && item.role === "assistant"
      ? { ...item, pending: false }
      : item,
  );
  if (live.history.at(-1)?.role !== "assistant") {
    live.history.push({ role: "assistant", content: message.content });
  }
  threads.set(noteId, live);
  return undefined;
}

const DRAWER_CLOSE_MS = 360;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type AskAiPanelHandle = {
  close: () => void;
};

function statusLabel(status: ChatStatus): string {
  if (status === "thinking") return "Thinking";
  if (status === "generating") return "Generating";
  return "Waiting";
}

export function AskAiPanel({
  note,
  profile,
  onClose,
  ref,
}: {
  note: LocatedEvent;
  profile?: Kind0Profile;
  onClose: () => void;
  ref?: Ref<AskAiPanelHandle>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const noteIdRef = useRef(note.id);
  const onCloseRef = useRef(onClose);
  const startCloseRef = useRef<() => void>(() => {});
  const closeTimerRef = useRef(0);
  onCloseRef.current = onClose;
  noteIdRef.current = note.id;

  useImperativeHandle(ref, () => ({
    close: () => startCloseRef.current(),
  }));

  const titleId = useId();
  const authorName = profileLabel(note.pubkey, profile?.displayName);

  const [thread, setThread] = useState<Thread>(() =>
    snapshot(getThread(note.id)),
  );
  const [draft, setDraft] = useState("");
  const [probe, setProbe] = useState<{
    noteId: string;
    gate: InferenceGate | "checking";
  }>({ noteId: note.id, gate: "checking" });
  if (probe.noteId !== note.id) {
    setProbe({ noteId: note.id, gate: "checking" });
  }
  const gate = probe.noteId === note.id ? probe.gate : "checking";
  const ready = gate === "ipa" || gate === "hosted";
  const busy = thread.visible.some(
    (message) => message.role === "assistant" && message.pending,
  );
  const webSearchEnabled = useWebSearchEnabled();
  const maySearchWeb = canSearchWeb();

  function persist(noteId: string, next: Thread) {
    threads.set(noteId, next);
    if (noteIdRef.current === noteId) {
      setThread(snapshot(next));
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) {
      dialog.classList.remove("is-closing");
      dialog.showModal();
    }

    const startClose = () => {
      if (!dialog.open || dialog.classList.contains("is-closing")) return;
      if (prefersReducedMotion()) {
        dialog.close();
        return;
      }
      dialog.classList.add("is-closing");
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        if (dialog.open && dialog.classList.contains("is-closing")) {
          dialog.close();
        }
      }, DRAWER_CLOSE_MS);
    };
    startCloseRef.current = startClose;

    const handleAnimationEnd = (event: AnimationEvent) => {
      if (event.target !== dialog) return;
      if (event.animationName !== "ask-ai-drawer-out") return;
      if (!dialog.classList.contains("is-closing")) return;
      window.clearTimeout(closeTimerRef.current);
      dialog.close();
    };

    const handleCancel = (event: Event) => {
      event.preventDefault();
      startClose();
    };

    const handleClose = () => {
      abortTurn(noteIdRef.current);
      settlePendingThread(noteIdRef.current);
      onCloseRef.current();
    };

    dialog.addEventListener("animationend", handleAnimationEnd);
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(closeTimerRef.current);
      startCloseRef.current = () => {};
      dialog.removeEventListener("animationend", handleAnimationEnd);
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog?.classList.contains("is-closing")) {
      window.clearTimeout(closeTimerRef.current);
      dialog.classList.remove("is-closing");
    }
    setThread(snapshot(getThread(note.id)));
    setDraft("");
  }, [note.id]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [thread.visible]);

  useEffect(() => {
    if (busy || !ready) return;
    inputRef.current?.focus();
  }, [busy, note.id, ready]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [draft]);

  async function runTurn(userText: string | null) {
    abortTurn(note.id);
    settlePendingThread(note.id);
    const controller = new AbortController();
    inflight.set(note.id, controller);
    const noteId = note.id;
    const canSearch = canSearchWeb();
    const contextContent = noteContextUserContent(note, authorName);
    const hasImages = Array.isArray(contextContent);

    const current = getThread(noteId);
    if (current.history.length === 0) {
      current.history = [
        { role: "system", content: systemPrompt(canSearch, hasImages) },
        { role: "user", content: contextContent },
      ];
    } else {
      patchNoteContextHistory(current.history, contextContent, canSearch);
    }

    let userVisibleId: string | undefined;
    if (userText) {
      userVisibleId = nextId();
      current.history.push({ role: "user", content: userText });
      current.visible.push({
        id: userVisibleId,
        role: "user",
        content: userText,
      });
    }

    const assistantId = nextId();
    current.visible.push({
      id: assistantId,
      role: "assistant",
      content: "",
      pending: true,
      status: "waiting",
    });
    current.introStarted = true;
    persist(noteId, current);

    const ownsTurn = () => inflight.get(noteId) === controller;

    const patchAssistant = (
      patch: Partial<Extract<VisibleMessage, { role: "assistant" }>>,
    ) => {
      if (!ownsTurn()) return;
      const live = getThread(noteId);
      live.visible = live.visible.map((message) =>
        message.id === assistantId && message.role === "assistant"
          ? { ...message, ...patch }
          : message,
      );
      persist(noteId, live);
    };

    const settleAborted = () => {
      if (!ownsTurn()) return;
      inflight.delete(noteId);
      const restored = settlePendingThread(noteId);
      persist(noteId, getThread(noteId));
      if (noteIdRef.current === noteId && restored) {
        setDraft(restored);
      }
    };

    try {
      const result = await completeChat({
        messages: current.history.map((message) => ({ ...message })),
        signal: controller.signal,
        onStatus(status) {
          patchAssistant({ status });
        },
        onDelta(text) {
          patchAssistant({ content: text });
        },
      });

      if (controller.signal.aborted || !ownsTurn()) {
        settleAborted();
        return;
      }

      const live = getThread(noteId);
      const content = result.content;
      if (!content) {
        if (userText && live.history.at(-1)?.role === "user") {
          live.history.pop();
        }
        live.visible = live.visible.filter(
          (message) =>
            message.id !== assistantId && message.id !== userVisibleId,
        );
        live.visible.push({
          id: nextId(),
          role: "error",
          content: "The model returned an empty reply.",
        });
        if (!live.visible.some((message) => message.role === "assistant")) {
          live.introStarted = false;
        }
        if (noteIdRef.current === noteId && userText) {
          setDraft(userText);
        }
      } else {
        live.history.push({ role: "assistant", content });
        live.visible = live.visible.map((message) =>
          message.id === assistantId && message.role === "assistant"
            ? { ...message, content, pending: false }
            : message,
        );
      }
      persist(noteId, live);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || !ownsTurn()) {
        settleAborted();
        return;
      }

      const live = getThread(noteId);
      const errorText = describeInferenceError(error);

      if (userText && live.history.at(-1)?.role === "user") {
        live.history.pop();
      }
      live.visible = live.visible.filter(
        (message) => message.id !== assistantId && message.id !== userVisibleId,
      );
      live.visible.push({
        id: nextId(),
        role: "error",
        content: errorText,
      });
      if (!live.visible.some((message) => message.role === "assistant")) {
        live.introStarted = false;
      }
      if (noteIdRef.current === noteId && userText) {
        setDraft(userText);
      }
      persist(noteId, live);
    } finally {
      if (inflight.get(noteId) === controller) inflight.delete(noteId);
    }
  }

  const runTurnRef = useRef(runTurn);
  runTurnRef.current = runTurn;

  useEffect(() => {
    let cancelled = false;
    void prepareInference().then((next) => {
      if (!cancelled) setProbe({ noteId: note.id, gate: next });
    });
    return () => {
      cancelled = true;
    };
  }, [note.id]);

  useEffect(() => {
    if (!ready) return;
    const noteId = note.id;
    if (!isTurnLive(noteId)) {
      abortTurn(noteId);
      settlePendingThread(noteId);
      persist(noteId, getThread(noteId));
    }
    const current = getThread(noteId);
    if (!current.introStarted && current.visible.length === 0) {
      current.introStarted = true;
      threads.set(noteId, current);
      void runTurnRef.current(null);
    }
    return () => {
      abortTurn(noteId);
      settlePendingThread(noteId);
    };
  }, [note.id, ready]);

  useEffect(() => {
    const current = getThread(note.id);
    const canSearch = canSearchWeb();
    const nextContent = noteContextUserContent(note, authorName);
    if (!patchNoteContextHistory(current.history, nextContent, canSearch))
      return;

    const restartingIntro =
      !current.visible.some((message) => message.role === "user") &&
      current.visible.some(
        (message) =>
          message.role === "assistant" && message.pending && !message.content,
      );
    if (restartingIntro) {
      current.visible = current.visible.filter(
        (message) =>
          !(
            message.role === "assistant" &&
            message.pending &&
            !message.content
          ),
      );
    }
    persist(note.id, current);
    if (restartingIntro) {
      void runTurnRef.current(null);
    }
  }, [note, authorName, webSearchEnabled]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setDraft("");
    void runTurn(content);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleClear() {
    if (busy) return;
    abortTurn(note.id);
    const fresh = emptyThread();
    persist(note.id, fresh);
    void runTurn(null);
  }

  function handleStop() {
    abortTurn(note.id);
    const restored = settlePendingThread(note.id);
    persist(note.id, getThread(note.id));
    if (restored) setDraft(restored);
  }

  const snippet = note.content.trim().replace(/\s+/g, " ");

  return (
    <dialog
      ref={dialogRef}
      className="ask-ai-dialog"
      aria-labelledby={titleId}
      onClick={(event) => {
        const dialog = event.currentTarget;
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          startCloseRef.current();
        }
      }}
    >
      <div className="ask-ai-sheet">
        <header className="ask-ai-header">
          <div className="ask-ai-heading">
            <h2 id={titleId}>
              Ask AI
              {maySearchWeb ? <span>May search the web</span> : null}
            </h2>
            <p className="ask-ai-about">
              About {authorName}
              {snippet ? ` · ${snippet}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="ask-ai-icon-btn"
            aria-label="Close"
            onClick={() => startCloseRef.current()}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3.15 3.15a.5.5 0 0 1 .7 0L7 6.29l3.15-3.14a.5.5 0 1 1 .7.7L7.71 7l3.14 3.15a.5.5 0 0 1-.7.7L7 7.71l-3.15 3.14a.5.5 0 0 1-.7-.7L6.29 7 3.15 3.85a.5.5 0 0 1 0-.7"
              />
            </svg>
          </button>
        </header>

        <label className="ask-ai-web-search">
          <input
            type="checkbox"
            checked={webSearchEnabled}
            onChange={(event) => setWebSearchEnabled(event.target.checked)}
          />
          <span>Search the web when helpful</span>
        </label>
        <div ref={logRef} className="ask-ai-log" aria-live="polite">
          {gate === "checking" ? (
            <div className="ask-ai-msg assistant pending">
              <span className="ask-ai-msg-label">Assistant</span>
              <span className="ask-ai-typing" aria-label="Checking inference">
                <span className="ask-ai-typing-label">Waiting</span>
                <span className="ask-ai-typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </div>
          ) : null}
          {gate === "consent" ? (
            <div className="ask-ai-consent">
              <p>
                No inference extension was found. We can still run Ask AI
                through a hosted model. The note and your questions will be sent
                to our server, then to that model provider.
              </p>
              <p>
                Install{" "}
                <a
                  href={INFERENCE_BRIDGE_HREF}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inference Bridge
                </a>{" "}
                to choose your own provider instead, like OpenAI, Anthropic,
                Gemini, OpenRouter, Ollama, and more.
              </p>
              <div className="ask-ai-consent-actions">
                <button
                  type="button"
                  className="ask-ai-secondary"
                  onClick={() => startCloseRef.current()}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="ask-ai-send"
                  onClick={() => {
                    setHostedConsent(true);
                    setProbe({ noteId: note.id, gate: "hosted" });
                  }}
                >
                  Use hosted
                </button>
              </div>
            </div>
          ) : null}
          {gate === "unavailable" ? (
            <div className="ask-ai-msg error">
              Ask AI needs an Inference Provider extension such as{" "}
              <a href={INFERENCE_BRIDGE_HREF} target="_blank" rel="noreferrer">
                Inference Bridge
              </a>
              , or a hosted inference endpoint.
            </div>
          ) : null}
          {ready
            ? thread.visible.map((message) => {
                if (message.role === "error") {
                  return (
                    <div key={message.id} className="ask-ai-msg error">
                      {linkifyInferenceBridge(message.content)}
                    </div>
                  );
                }
                if (message.role === "user") {
                  return (
                    <div key={message.id} className="ask-ai-msg user">
                      <span className="ask-ai-msg-label">You</span>
                      {message.content}
                    </div>
                  );
                }
                const waiting = Boolean(message.pending && !message.content);
                return (
                  <div
                    key={message.id}
                    className={`ask-ai-msg assistant${waiting ? " pending" : ""}`}
                  >
                    <span className="ask-ai-msg-label">Assistant</span>
                    {waiting ? (
                      <span
                        className="ask-ai-typing"
                        aria-label={`${statusLabel(message.status ?? "waiting")} for response`}
                      >
                        <span className="ask-ai-typing-label">
                          {statusLabel(message.status ?? "waiting")}
                        </span>
                        <span className="ask-ai-typing-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      </span>
                    ) : null}
                    {message.content ? (
                      <div className="ask-ai-msg-body">
                        <AskAiMarkdown>{message.content}</AskAiMarkdown>
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}
        </div>

        {ready ? (
          <form className="ask-ai-form" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              rows={1}
              aria-label="Ask a follow-up"
              value={draft}
              placeholder="Ask a follow-up…"
              autoComplete="off"
              enterKeyHint="send"
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="ask-ai-actions">
              <button
                type="button"
                className="ask-ai-secondary"
                disabled={
                  busy ||
                  (thread.introStarted && thread.visible.length === 0 && !draft)
                }
                onClick={handleClear}
              >
                Clear
              </button>
              {busy ? (
                <button
                  type="button"
                  className="ask-ai-secondary"
                  onClick={handleStop}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="ask-ai-send"
                  disabled={!draft.trim()}
                >
                  Ask
                </button>
              )}
            </div>
          </form>
        ) : null}
      </div>
    </dialog>
  );
}
