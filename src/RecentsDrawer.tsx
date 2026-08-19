import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  matchesRecentFilter,
  recentSummary,
  recentTitle,
  toQueryString,
  type RecentSearch,
} from "./recent-searches";

export const GITHUB_REPO_URL =
  "https://github.com/SamSamskies/advancednostrsearch";

export function RecentsDrawer({
  recents,
  open,
  isSearching,
  onOpenChange,
  onRestore,
  onClear,
  children,
}: {
  recents: RecentSearch[];
  open: boolean;
  isSearching: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (recent: RecentSearch) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState("");
  const visibleRecents = useMemo(
    () => recents.filter((recent) => matchesRecentFilter(recent, filter)),
    [recents, filter]
  );

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className={open ? "app drawer-open" : "app"}>
      <header className="site-chrome">
        <button
          type="button"
          className="drawer-toggle"
          aria-expanded={open}
          aria-controls="recents-drawer"
          aria-label="Recent searches"
          title="Recent searches"
          onClick={() => onOpenChange(!open)}
        >
          <HistoryIcon />
        </button>
      </header>

      {open ? (
        <button
          type="button"
          className="drawer-scrim"
          tabIndex={-1}
          aria-label="Close recent searches"
          onClick={() => onOpenChange(false)}
        />
      ) : null}

      <aside
        id="recents-drawer"
        className="drawer"
        aria-labelledby="recents-heading"
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        inert={!open || undefined}
      >
        <div className="drawer-header">
          <h2 id="recents-heading" className="drawer-heading">
            Recent searches
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="drawer-close"
            aria-label="Close recent searches"
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </button>
        </div>

        {recents.length > 0 ? (
          <div className="drawer-body">
            <label className="recents-filter">
              <span className="visually-hidden">Filter recent searches</span>
              <input
                type="search"
                value={filter}
                placeholder="Filter recents"
                autoComplete="off"
                onChange={(event) => setFilter(event.target.value)}
              />
            </label>
            {visibleRecents.length > 0 ? (
              <ul className="recents-list">
                {visibleRecents.map((recent) => (
                  <li key={toQueryString(recent)}>
                    <button
                      type="button"
                      className="recent-link"
                      disabled={isSearching}
                      onClick={() => onRestore(recent)}
                    >
                      <span className="recent-title">{recentTitle(recent)}</span>
                      <span className="recent-summary">
                        {recentSummary(recent)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drawer-empty">No matching searches.</p>
            )}
            <button
              type="button"
              className="recents-clear"
              aria-label="Clear recent searches"
              onClick={onClear}
            >
              Clear
            </button>
          </div>
        ) : (
          <p className="drawer-empty">
            Run a search and it will show up here.
          </p>
        )}

        <div className="drawer-footer">
          <a
            className="drawer-github"
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            <GitHubIcon />
            Source on GitHub
          </a>
        </div>
      </aside>

      <div className="app-main" inert={open || undefined}>
        {children}
      </div>
    </div>
  );
}

function HistoryIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="13"
        r="7.25"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M12 9.5V13l2.4 1.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 4.8 6 7.2l2.4.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 6l12 12M18 6 6 18"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 98 96"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        id="github-logo"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}
