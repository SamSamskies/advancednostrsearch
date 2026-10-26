import {
  lazy,
  Suspense,
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
import { Avatar } from "./Avatar";
import { NoteMenuIcon, OpenInDialog, type OpenInTarget } from "./OpenInDialog";
import {
  addIdentities,
  collectMentionIdentities,
  isUnmodifiedLeftClick,
  njumpHref,
  profileLabel,
} from "./mentions";
import {
  IdentityError,
  resolveIdentity,
  type Kind0Profile,
  type NostrIdentity,
} from "./identity";
import {
  SEARCH_RESULT_LIMIT,
  searchProfiles,
  shouldSuggestProfiles,
} from "./profile-search";
import { matchesMediaFilters } from "./media";
import { encodeNevent } from "./nostr-clients";
import {
  AUTHOR_CHUNK_SIZE,
  chunkArray,
  convertDateToUnixTimestamp,
  DEFAULT_RELAYS,
  FALLBACK_RELAYS,
  findNotes,
  formatCreateAtDate,
  getFollowedPubkeys,
  getKind0Profiles,
  getUserReactionEventIds,
  getUserRelays,
  matchesSearchQuery,
  mergeLocatedEvents,
  NOTE_KINDS,
  NOTE_LIMIT,
  NOTE_SEARCH_RELAYS,
  type LocatedEvent,
} from "./nostr";
import {
  INCLUDE_FOLLOWED_USERS_QUERY_PARAM,
  INCLUDE_ONLY_AUTHOR_QUERY_PARAM,
  INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM,
  clearRecents,
  loadRecents,
  pubkeyFromNpub,
  saveRecent,
  toQueryString,
  withAuthorNames,
  type RecentSearch,
  type SearchFields,
} from "./recent-searches";
import { RecentsDrawer } from "./RecentsDrawer";
import { Icon, OstrichMark } from "./Icons";
import { AskAiButton } from "./AskAiButton";

const AskAiPanel = lazy(() =>
  import("./AskAiPanel").then((module) => ({ default: module.AskAiPanel })),
);

const queryFlagEnabled = (value: string | null) => value === "1";

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
        "Multiple profiles match that name — pick one from the suggestions or use npub/NIP-05.",
      );
    }
  }
  return resolveIdentity(input);
}

function encodeNpub(pubkey: string): string {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return "";
  }
}

function NoteAuthor({
  pubkey,
  createdAt,
  profile,
  onOpenProfile,
}: {
  pubkey: string;
  createdAt: number;
  profile?: Kind0Profile;
  onOpenProfile: (code: string) => void;
}) {
  const code = encodeNpub(pubkey);
  const name = profileLabel(pubkey, profile?.displayName);
  const timestamp = (
    <time dateTime={new Date(createdAt * 1000).toISOString()}>
      {formatCreateAtDate(createdAt)}
    </time>
  );

  const body = (
    <>
      <Avatar src={profile?.picture} />
      <span className="note-author-copy">
        <span className="note-author-name">{name}</span>
        {timestamp}
      </span>
    </>
  );

  if (!code) {
    return <div className="note-author">{body}</div>;
  }

  return (
    <a
      className="note-author"
      href={njumpHref(code)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!isUnmodifiedLeftClick(event)) return;
        event.preventDefault();
        onOpenProfile(code);
      }}
    >
      {body}
    </a>
  );
}

export default function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const [isSearching, setIsSearching] = useState(false);
  const [npub, setNpub] = useState(queryParams.get("npub") ?? "");
  const [include, setInclude] = useState(
    queryParams.get("include") ?? INCLUDE_ONLY_AUTHOR_QUERY_PARAM,
  );
  const [query, setQuery] = useState(queryParams.get("query") ?? "");
  const [fromDate, setFromDate] = useState(queryParams.get("fromDate") ?? "");
  const [toDate, setToDate] = useState(queryParams.get("toDate") ?? "");
  const [hasImage, setHasImage] = useState(
    queryFlagEnabled(queryParams.get("hasImage")),
  );
  const [hasVideo, setHasVideo] = useState(
    queryFlagEnabled(queryParams.get("hasVideo")),
  );
  const [events, setEvents] = useState<LocatedEvent[]>([]);
  const [currentDataLength, setCurrentDataLength] = useState(0);
  const [askNote, setAskNote] = useState<LocatedEvent | null>(null);
  const [openTarget, setOpenTarget] = useState<OpenInTarget | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Kind0Profile>>({});
  const [message, setMessage] = useState<{
    text: string;
    tone: "error" | "info";
  } | null>(null);
  const [recents, setRecents] = useState<RecentSearch[]>(loadRecents);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const updateUrl = (params?: URLSearchParams) => {
    window.history.replaceState(
      null,
      "",
      params
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname,
    );
  };

  const writeFieldsToUrl = (fields: SearchFields) => {
    const query = toQueryString(fields);
    updateUrl(query ? new URLSearchParams(query) : undefined);
  };

  const applyFields = (fields: SearchFields) => {
    setNpub(fields.npub);
    setInclude(fields.include);
    setQuery(fields.query);
    setFromDate(fields.fromDate);
    setToDate(fields.toDate);
    setHasImage(fields.hasImage);
    setHasVideo(fields.hasVideo);
    writeFieldsToUrl(fields);
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

  const handleMediaFilterChange =
    (key: "hasImage" | "hasVideo", set: Dispatch<SetStateAction<boolean>>) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const checked = event.target.checked;
      updateQueryParams(key, checked ? "1" : "");
      set(checked);
    };

  const handleSubmit = async (
    event?: FormEvent<HTMLFormElement>,
    fieldsOverride?: SearchFields,
  ) => {
    event?.preventDefault();

    const fields: SearchFields = {
      ...(fieldsOverride ?? {
        npub: event
          ? String(new FormData(event.currentTarget).get("identity") ?? npub)
          : npub,
        include,
        query,
        fromDate,
        toDate,
        hasImage,
        hasVideo,
      }),
    };

    const includeNotesFromFollowedUsers =
      fields.include === INCLUDE_FOLLOWED_USERS_QUERY_PARAM;
    const includeOnlyNotesAuthorReactedTo =
      fields.include === INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM;

    setAskNote(null);
    setIsSearching(true);
    setMessage(null);

    try {
      const identity = await resolveSubmittedIdentity(fields.npub);
      const encoded = nip19.npubEncode(identity.pubkey);
      if (encoded !== fields.npub) {
        fields.npub = encoded;
        updateQueryParams("npub", encoded);
        setNpub(encoded);
      }

      const defaultNoteFilter: Filter = {
        kinds: NOTE_KINDS,
        limit: NOTE_LIMIT,
      };
      if (fields.fromDate) {
        defaultNoteFilter.since = convertDateToUnixTimestamp(fields.fromDate);
      }
      if (fields.toDate) {
        defaultNoteFilter.until = convertDateToUnixTimestamp(fields.toDate);
      }
      const searchFilter: Filter | undefined = fields.query
        ? { ...defaultNoteFilter, search: fields.query }
        : undefined;

      let found: LocatedEvent[] = [];

      if (includeOnlyNotesAuthorReactedTo) {
        const reactionEventIds = await getUserReactionEventIds({
          identity,
          since: defaultNoteFilter.since,
          until: defaultNoteFilter.until,
        });

        if (reactionEventIds.length > 0) {
          const userRelays = await getUserRelays(identity);
          const relays = [...userRelays, ...DEFAULT_RELAYS];
          const chunks = await Promise.all(
            chunkArray(reactionEventIds, AUTHOR_CHUNK_SIZE).flatMap((ids) => {
              const jobs = [findNotes(relays, { ...defaultNoteFilter, ids })];
              if (searchFilter) {
                jobs.push(
                  findNotes(NOTE_SEARCH_RELAYS, { ...searchFilter, ids }),
                );
              }
              return jobs;
            }),
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
        const userRelays = await getUserRelays(identity);
        const authorRelays =
          userRelays.length > 0
            ? [...userRelays, ...DEFAULT_RELAYS]
            : [...DEFAULT_RELAYS, ...FALLBACK_RELAYS];

        const eventChunks = await Promise.all(
          chunkArray(dedupedAuthors, AUTHOR_CHUNK_SIZE).flatMap(
            (authorsChunk) => {
              const jobs = [
                findNotes(authorRelays, {
                  ...defaultNoteFilter,
                  authors: authorsChunk,
                }),
              ];
              if (searchFilter) {
                jobs.push(
                  findNotes(NOTE_SEARCH_RELAYS, {
                    ...searchFilter,
                    authors: authorsChunk,
                  }),
                );
              }
              return jobs;
            },
          ),
        );

        found = mergeLocatedEvents(eventChunks.flat());
      }

      if (fields.query) {
        found = found.filter((note) => matchesSearchQuery(note, fields.query));
      }

      const relayCount = found.length;

      if (fields.hasImage || fields.hasVideo) {
        found = found.filter((note) =>
          matchesMediaFilters(note, fields.hasImage, fields.hasVideo),
        );
      }

      if (found.length === 0) {
        let text = "No notes found.";
        if ((fields.hasImage || fields.hasVideo) && relayCount > 0) {
          const media =
            fields.hasImage && fields.hasVideo
              ? "image or video"
              : fields.hasImage
                ? "image"
                : "video";
          text =
            fields.fromDate || fields.toDate
              ? `None of the notes in this range (latest ${NOTE_LIMIT}) have a detectable ${media}.`
              : `None of the latest ${NOTE_LIMIT} notes have a detectable ${media}.`;
        }
        setMessage({ text, tone: "info" });
      }

      setCurrentDataLength(Math.min(5, found.length));
      setEvents(found);
      setRecents((prev) =>
        saveRecent(
          {
            ...fields,
            authorName: profiles[identity.pubkey.toLowerCase()]?.displayName,
          },
          prev,
        ),
      );
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Something went wrong.",
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
    setHasImage(false);
    setHasVideo(false);
    setEvents([]);
    setCurrentDataLength(0);
    setOpenTarget(null);
    setAskNote(null);
    setProfiles({});
    setMessage(null);
  };

  const handleRestoreRecent = (recent: RecentSearch) => {
    const fields: SearchFields = {
      npub: recent.npub,
      include: recent.include,
      query: recent.query,
      fromDate: recent.fromDate,
      toDate: recent.toDate,
      hasImage: recent.hasImage,
      hasVideo: recent.hasVideo,
    };
    applyFields(fields);
    setDrawerOpen(false);
    void handleSubmit(undefined, fields);
  };

  const handleClearRecents = () => {
    setRecents(clearRecents());
  };

  useEffect(() => {
    const identities = recents
      .filter((recent) => !recent.authorName)
      .map((recent) => pubkeyFromNpub(recent.npub))
      .filter((pubkey): pubkey is string => pubkey !== null)
      .map((pubkey) => ({ pubkey }));
    if (identities.length === 0) return;

    let cancelled = false;
    void getKind0Profiles(identities).then((found) => {
      if (cancelled) return;
      setProfiles((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [pubkey, profile] of Object.entries(found)) {
          if (prev[pubkey] === profile) continue;
          next[pubkey] = profile;
          changed = true;
        }
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [recents]);

  useEffect(() => {
    setRecents((prev) => withAuthorNames(prev, profiles));
  }, [profiles]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || currentDataLength >= events.length) return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setCurrentDataLength((prev) =>
        prev + 5 < events.length ? prev + 5 : events.length,
      );
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [currentDataLength, events.length]);

  const visibleEvents = events.slice(0, currentDataLength);

  useEffect(() => {
    const visible = events.slice(0, currentDataLength);
    if (visible.length === 0) return;

    const identities = addIdentities(
      collectMentionIdentities(visible.map((note) => note.content)),
      visible.map((note) => ({
        pubkey: note.pubkey,
        relayHints: note.seenOn.filter((url) => url.startsWith("wss://")),
      })),
    );

    let cancelled = false;
    void getKind0Profiles(identities).then((found) => {
      if (cancelled) return;
      setProfiles((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [pubkey, profile] of Object.entries(found)) {
          if (prev[pubkey] === profile) continue;
          next[pubkey] = profile;
          changed = true;
        }
        return changed ? next : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [events, currentDataLength]);

  return (
    <RecentsDrawer
      recents={recents}
      open={drawerOpen}
      isSearching={isSearching}
      onOpenChange={setDrawerOpen}
      onRestore={handleRestoreRecent}
      onClear={handleClearRecents}
    >
      <main className="page">
        <header className="hero">
          <div className="hero-brand">
            <OstrichMark />
            <h1>
              Advanced
              <br />
              Nostr Search
            </h1>
          </div>
          <p className="lede">
            Search notes by author, the people they follow, or the notes they
            reacted to.
          </p>
        </header>

        <form className="search-panel" onSubmit={handleSubmit}>
          <div className="search-fields">
            <div className="field">
              <label htmlFor="identity">Who are you looking for?</label>
              <div className="input-with-icon">
                <Icon name="user" />
                <IdentityCombobox
                  id="identity"
                  name="identity"
                  value={npub}
                  onChange={handleIdentityChange}
                  disabled={isSearching}
                  required
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="query">
                Search for <span className="optional">Optional</span>
              </label>
              <div className="input-with-icon">
                <Icon name="search" />
                <input
                  id="query"
                  type="text"
                  placeholder="Keywords or a phrase"
                  onChange={makeInputOnChangeHandler(setQuery, "query")}
                  value={query}
                  disabled={isSearching}
                />
              </div>
            </div>
          </div>

          <div className="search-filters">
            <fieldset className="scope-set" disabled={isSearching}>
              <legend>Search in</legend>
              <div className="scope-options">
                <label className="scope-option">
                  <input
                    type="radio"
                    name="include"
                    value={INCLUDE_ONLY_AUTHOR_QUERY_PARAM}
                    checked={include === INCLUDE_ONLY_AUTHOR_QUERY_PARAM}
                    onChange={(event) =>
                      handleIncludeChange(event.target.value)
                    }
                  />
                  <span>Author’s notes</span>
                </label>
                <label className="scope-option">
                  <input
                    type="radio"
                    name="include"
                    value={INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM}
                    checked={
                      include ===
                      INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM
                    }
                    onChange={(event) =>
                      handleIncludeChange(event.target.value)
                    }
                  />
                  <span>Reacted to</span>
                </label>
                <label className="scope-option">
                  <input
                    type="radio"
                    name="include"
                    value={INCLUDE_FOLLOWED_USERS_QUERY_PARAM}
                    checked={include === INCLUDE_FOLLOWED_USERS_QUERY_PARAM}
                    onChange={(event) =>
                      handleIncludeChange(event.target.value)
                    }
                  />
                  <span>Author + following</span>
                </label>
              </div>
            </fieldset>

            <div className="filter-row">
              <div className="date-range">
                <div className="field">
                  <label htmlFor="fromDate">
                    From <span className="optional">Optional</span>
                  </label>
                  <input
                    id="fromDate"
                    type="date"
                    onChange={makeInputOnChangeHandler(setFromDate, "fromDate")}
                    value={fromDate}
                    disabled={isSearching}
                  />
                </div>
                <span className="date-separator" aria-hidden="true">
                  –
                </span>
                <div className="field">
                  <label htmlFor="toDate">
                    To <span className="optional">Optional</span>
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
              <fieldset className="media-set" disabled={isSearching}>
                <legend>With media</legend>
                <div className="media-options">
                  <label className="media-option">
                    <input
                      type="checkbox"
                      name="hasImage"
                      checked={hasImage}
                      onChange={handleMediaFilterChange(
                        "hasImage",
                        setHasImage,
                      )}
                    />
                    <span>
                      <Icon name="image" />
                      Images
                    </span>
                  </label>
                  <label className="media-option">
                    <input
                      type="checkbox"
                      name="hasVideo"
                      checked={hasVideo}
                      onChange={handleMediaFilterChange(
                        "hasVideo",
                        setHasVideo,
                      )}
                    />
                    <span>
                      <Icon name="video" />
                      Videos
                    </span>
                  </label>
                </div>
              </fieldset>
            </div>
          </div>

          <div className="actions">
            <button
              type="button"
              className="clear-button"
              onClick={handleClear}
              disabled={isSearching}
            >
              Reset filters
            </button>
            <button
              type="submit"
              className="primary search-button"
              disabled={isSearching}
            >
              {isSearching ? "Searching…" : "Search notes"}
              {isSearching ? (
                <span className="search-spinner" aria-hidden="true" />
              ) : (
                <Icon name="arrow" />
              )}
            </button>
          </div>
        </form>
        <p className="search-hint">
          The open network, a little easier to explore.
        </p>

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
                onClick={() => {
                  try {
                    setOpenTarget({ kind: "note", code: encodeNevent(note) });
                  } catch {}
                }}
              >
                <NoteMenuIcon />
              </button>
              <NoteAuthor
                pubkey={note.pubkey}
                createdAt={note.created_at}
                profile={profiles[note.pubkey.toLowerCase()]}
                onOpenProfile={(code) =>
                  setOpenTarget({ kind: "profile", code })
                }
              />
              <div className="note-body">
                <NoteContent
                  content={note.content}
                  tags={note.tags}
                  profiles={profiles}
                  onOpen={(kind, code) => setOpenTarget({ kind, code })}
                />
              </div>
              <div className="note-footer-actions">
                <AskAiButton
                  pressed={askNote?.id === note.id}
                  onClick={() => setAskNote(note)}
                />
              </div>
            </li>
          ))}
        </ol>
        <div ref={sentinelRef} className="sentinel" aria-hidden="true" />

        {askNote ? (
          <Suspense
            fallback={
              <p className="status" role="status">
                Loading Ask AI…
              </p>
            }
          >
            <AskAiPanel
              note={askNote}
              profile={profiles[askNote.pubkey.toLowerCase()]}
              onClose={() => setAskNote(null)}
            />
          </Suspense>
        ) : null}

        {openTarget ? (
          <OpenInDialog
            target={openTarget}
            onClose={() => setOpenTarget(null)}
          />
        ) : null}
      </main>
    </RecentsDrawer>
  );
}
