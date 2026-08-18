import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  SEARCH_DEBOUNCE_MS,
  searchProfiles,
  shouldSuggestProfiles,
  suggestionValue,
  type ProfileSuggestion,
} from "./profile-search";

function SuggestAvatar({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <span className="suggest-avatar suggest-avatar-empty" aria-hidden="true" />
    );
  }

  return (
    <img
      className="suggest-avatar"
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

type IdentityComboboxProps = {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
};

export function IdentityCombobox({
  id,
  name,
  value,
  onChange,
  disabled,
  required,
  autoFocus,
}: IdentityComboboxProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<ProfileSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const searchAbort = useRef<AbortController | undefined>(undefined);
  const debounceTimer = useRef<number | undefined>(undefined);

  const closeSuggestions = () => {
    searchGeneration.current += 1;
    searchAbort.current?.abort();
    searchAbort.current = undefined;
    if (debounceTimer.current !== undefined) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = undefined;
    }
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
    setStatus(null);
  };

  const selectSuggestion = (index: number) => {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    const next = suggestionValue(suggestion);
    if (inputRef.current) inputRef.current.value = next;
    onChange(next);
    closeSuggestions();
    inputRef.current?.focus();
  };

  useEffect(() => {
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
    setStatus(null);

    if (!shouldSuggestProfiles(value)) {
      searchGeneration.current += 1;
      searchAbort.current?.abort();
      return;
    }

    const controller = new AbortController();
    searchAbort.current = controller;
    const generation = ++searchGeneration.current;
    debounceTimer.current = window.setTimeout(async () => {
      if (generation !== searchGeneration.current || controller.signal.aborted) {
        return;
      }
      setStatus("Searching profiles…");
      setOpen(true);

      const results = await searchProfiles(value, { signal: controller.signal });
      if (generation !== searchGeneration.current || controller.signal.aborted) {
        return;
      }
      setStatus(null);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current !== undefined) {
        window.clearTimeout(debounceTimer.current);
        debounceTimer.current = undefined;
      }
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;

    const onFormSubmit = () => {
      if (!open || activeIndex < 0) return;
      const suggestion = suggestions[activeIndex];
      if (!suggestion) return;
      const next = suggestionValue(suggestion);
      if (inputRef.current) inputRef.current.value = next;
      onChange(next);
      closeSuggestions();
    };

    form.addEventListener("submit", onFormSubmit, { capture: true });
    return () => {
      form.removeEventListener("submit", onFormSubmit, { capture: true });
    };
  }, [open, activeIndex, suggestions, onChange]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1
      );
      return;
    }

    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSuggestions();
    }
  };

  const onBlur = () => {
    window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        closeSuggestions();
      }
    }, 120);
  };

  const activeOptionId =
    open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;

  return (
    <div className="identity-combobox" ref={rootRef}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder="name, npub, nprofile, nip05, or pubkey"
        value={value}
        required={required}
        disabled={disabled}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      <ul
        id={listboxId}
        className="suggest-list"
        role="listbox"
        hidden={!open}
      >
        {status ? <li className="suggest-status">{status}</li> : null}
        {suggestions.map((item, index) => (
          <li
            key={item.pubkey}
            id={`${listboxId}-${index}`}
            className={
              index === activeIndex ? "suggest-option active" : "suggest-option"
            }
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectSuggestion(index)}
          >
            <SuggestAvatar src={item.picture} />
            <span className="suggest-copy">
              <span className="suggest-name">
                {item.displayName?.trim() || `${item.npub.slice(0, 16)}…`}
              </span>
              {item.nip05 ? (
                <span className="suggest-handle">{item.nip05}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
