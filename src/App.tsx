import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import * as nip19 from "nostr-tools/nip19";
import type { Filter } from "nostr-tools/filter";
import { NoteContent } from "./NoteContent";
import { IdentityCombobox } from "./IdentityCombobox";
import { NoteMenuIcon, OpenInDialog } from "./OpenInDialog";
import {
  IdentityError,
  resolveIdentity,
  type NostrIdentity,
} from "./identity";
import {
  SEARCH_RESULT_LIMIT,
  searchProfiles,
  shouldSuggestProfiles,
} from "./profile-search";
import {
  AUTHOR_CHUNK_SIZE,
  chunkArray,
  convertDateToUnixTimestamp,
  DEFAULT_RELAYS,
  FALLBACK_RELAYS,
  findNotes,
  formatCreateAtDate,
  getFollowedPubkeys,
  getUserReactionEventIds,
  getUserRelays,
  mergeLocatedEvents,
  NOTE_LIMIT,
  NOTE_SEARCH_RELAYS,
  type LocatedEvent,
} from "./nostr";

const INCLUDE_FOLLOWED_USERS_QUERY_PARAM = "followed";
const INCLUDE_ONLY_AUTHOR_QUERY_PARAM = "onlyAuthor";
const INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM =
  "onlyNotesAuthorReactedTo";

async function resolveSubmittedIdentity(raw: string): Promise<NostrIdentity> {
  const input = raw.trim();
  if (shouldSuggestProfiles(input)) {
    const matches = await searchProfiles(input, {
      limit: SEARCH_RESULT_LIMIT,
    });
    if (matches.length === 1) {
      return resolveIdentity(matches[0].npub);
    }
    if (matches.length > 1) {
      throw new IdentityError(
        "Multiple profiles match that name — pick one from the suggestions or use npub/NIP-05."
      );
    }
  }
  return resolveIdentity(input);
}

export default function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const [isSearching, setIsSearching] = useState(false);
  const [npub, setNpub] = useState(queryParams.get("npub") ?? "");
  const [include, setInclude] = useState(
    queryParams.get("include") ?? INCLUDE_ONLY_AUTHOR_QUERY_PARAM
  );
  const [query, setQuery] = useState(queryParams.get("query") ?? "");
  const [fromDate, setFromDate] = useState(queryParams.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(queryParams.get("toDate") ?? "");
  const [events, setEvents] = useState<LocatedEvent[]>([]);
  const [currentDataLength, setCurrentDataLength] = useState(0);
  const [openNote, setOpenNote] = useState<LocatedEvent | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    tone: "error" | "info";
  } | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchedRef = useRef(false);

  const includeNotesFromFollowedUsers =
    include === INCLUDE_FOLLOWED_USERS_QUERY_PARAM;
  const includeOnlyNotesAuthorReactedTo =
    include === INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM;

  const updateUrl = (params?: URLSearchParams) => {
    window.history.replaceState(
      null,
      "",
      params
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname
    );
  };

  const updateQueryParams = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    updateUrl(params);
  };

  const makeInputOnChangeHandler =
    (set: Dispatch<SetStateAction<string>>, key: string) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      updateQueryParams(key, event.target.value);
      set(event.target.value);
    };

  const handleIdentityChange = (value: string) => {
    updateQueryParams("npub", value);
    setNpub(value);
  };

  const handleIncludeChange = (value: string) => {
    updateQueryParams("include", value);
    setInclude(value);
  };

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    const rawIdentity = event
      ? String(new FormData(event.currentTarget).get("identity") ?? npub)
      : npub;

    setIsSearching(true);
    setMessage(null);

    try {
      const identity = await resolveSubmittedIdentity(rawIdentity);
      const encoded = nip19.npubEncode(identity.pubkey);
      if (encoded !== npub) {
        updateQueryParams("npub", encoded);
        setNpub(encoded);
      }

      const defaultKindOneFilter: Filter = {
        kinds: [1],
        limit: NOTE_LIMIT,
      };
      if (query) defaultKindOneFilter.search = query;
      if (fromDate) {
        defaultKindOneFilter.since = convertDateToUnixTimestamp(fromDate);
      }
      if (toDate) {
        defaultKindOneFilter.until = convertDateToUnixTimestamp(toDate);
      }

      let found: LocatedEvent[] = [];

      if (includeOnlyNotesAuthorReactedTo) {
        const reactionEventIds = await getUserReactionEventIds({
          identity,
          since: defaultKindOneFilter.since,
          until: defaultKindOneFilter.until,
        });

        if (reactionEventIds.length > 0) {
          const userRelays = await getUserRelays(identity);
          const relays = [
            ...(query ? NOTE_SEARCH_RELAYS : []),
            ...userRelays,
            ...DEFAULT_RELAYS,
          ];
          const chunks = await Promise.all(
            chunkArray(reactionEventIds, AUTHOR_CHUNK_SIZE).map((ids) =>
              findNotes(relays, { ...defaultKindOneFilter, ids })
            )
          );
          found = mergeLocatedEvents(chunks.flat());
        }
      } else {
        const followedAuthorPubkeys = includeNotesFromFollowedUsers
          ? await getFollowedPubkeys(identity.pubkey)
          : [];
        const authors = includeNotesFromFollowedUsers
          ? [...followedAuthorPubkeys, identity.pubkey]
          : [identity.pubkey];
        const dedupedAuthors = Array.from(new Set(authors));
        const userRelays = query ? [] : await getUserRelays(identity);
        const relays = query
          ? NOTE_SEARCH_RELAYS
          : userRelays.length > 0
            ? [...userRelays, ...DEFAULT_RELAYS]
            : [...DEFAULT_RELAYS, ...FALLBACK_RELAYS];

        const eventChunks = await Promise.all(
          chunkArray(dedupedAuthors, AUTHOR_CHUNK_SIZE).map((authorsChunk) =>
            findNotes(relays, {
              ...defaultKindOneFilter,
              authors: authorsChunk,
            })
          )
        );

        found = mergeLocatedEvents(eventChunks.flat());
      }

      if (found.length === 0) {
        setMessage({ text: "No notes found.", tone: "info" });
      }

      setCurrentDataLength(Math.min(5, found.length));
      setEvents(found);
    } catch (error) {
      setMessage({
        text:
          error instanceof Error ? error.message : "Something went wrong.",
        tone: "error",
      });
      setCurrentDataLength(0);
      setEvents([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    updateUrl();
    setNpub("");
    setInclude(INCLUDE_ONLY_AUTHOR_QUERY_PARAM);
    setQuery("");
    setFromDate("");
    setToDate("");
    setEvents([]);
    setCurrentDataLength(0);
    setOpenNote(null);
    setMessage(null);
  };

  useEffect(() => {
    if (searchedRef.current || !npub || !query) return;
    searchedRef.current = true;
    void handleSubmit();
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || currentDataLength >= events.length) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setCurrentDataLength((prev) =>
        prev + 5 < events.length ? prev + 5 : events.length
      );
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [currentDataLength, events.length]);

  const visibleEvents = events.slice(0, currentDataLength);

  return (
    <main className="page">
      <header className="hero">
        <h1>Advanced Nostr Search</h1>
        <p className="lede">
          Search notes by author, notes they reacted to, or people they follow.
        </p>
      </header>

      <form className="search-panel" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="identity">Author</label>
          <IdentityCombobox
            id="identity"
            name="identity"
            value={npub}
            onChange={handleIdentityChange}
            disabled={isSearching}
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="query">Search query</label>
          <input
            id="query"
            type="text"
            placeholder="optional keywords"
            onChange={makeInputOnChangeHandler(setQuery, "query")}
            value={query}
            disabled={isSearching}
          />
        </div>

        <fieldset className="include-set" disabled={isSearching}>
          <legend>Include</legend>
          <label className="radio-row">
            <input
              type="radio"
              name="include"
              value={INCLUDE_ONLY_AUTHOR_QUERY_PARAM}
              checked={include === INCLUDE_ONLY_AUTHOR_QUERY_PARAM}
              onChange={(event) => handleIncludeChange(event.target.value)}
            />
            <span>Include only author notes</span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="include"
              value={INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM}
              checked={include === INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM}
              onChange={(event) => handleIncludeChange(event.target.value)}
            />
            <span>Include only notes author has reacted to</span>
          </label>
          <label className="radio-row">
            <input
              type="radio"
              name="include"
              value={INCLUDE_FOLLOWED_USERS_QUERY_PARAM}
              checked={include === INCLUDE_FOLLOWED_USERS_QUERY_PARAM}
              onChange={(event) => handleIncludeChange(event.target.value)}
            />
            <span>
              Include notes from author as well as notes from users that the
              author follows
            </span>
          </label>
        </fieldset>

        <div className="date-row">
          <div className="field">
            <label htmlFor="fromDate">
              From date <span className="optional">(optional)</span>
            </label>
            <input
              id="fromDate"
              type="date"
              onChange={makeInputOnChangeHandler(setFromDate, "fromDate")}
              value={fromDate}
              disabled={isSearching}
            />
          </div>
          <div className="field">
            <label htmlFor="toDate">
              To date <span className="optional">(optional)</span>
            </label>
            <input
              id="toDate"
              type="date"
              onChange={makeInputOnChangeHandler(setToDate, "toDate")}
              value={toDate}
              disabled={isSearching}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" className="secondary" onClick={handleClear}>
            Clear
          </button>
          <button type="submit" className="primary" disabled={isSearching}>
            {isSearching ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {message ? (
        <p className={`status status-${message.tone}`} role="status">
          {message.text}
        </p>
      ) : null}

      <ol className="results">
        {visibleEvents.map((note) => (
          <li key={note.id} className="note">
            <button
              type="button"
              className="note-menu"
              aria-haspopup="dialog"
              aria-label="Open this note in…"
              title="Open this note in…"
              onClick={() => setOpenNote(note)}
            >
              <NoteMenuIcon />
            </button>
            <time dateTime={new Date(note.created_at * 1000).toISOString()}>
              {formatCreateAtDate(note.created_at)}
            </time>
            <div className="note-body">
              <NoteContent content={note.content} />
            </div>
          </li>
        ))}
      </ol>
      <div ref={sentinelRef} className="sentinel" aria-hidden="true" />

      {openNote ? (
        <OpenInDialog note={openNote} onClose={() => setOpenNote(null)} />
      ) : null}
    </main>
  );
}
