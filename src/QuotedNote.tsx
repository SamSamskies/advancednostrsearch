import { useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { NoteContent } from "./NoteContent";
import { nip19 } from "nostr-tools";
import type { Kind0Profile } from "./identity";
import {
  isUnmodifiedLeftClick,
  njumpHref,
  noteRefLabel,
  profileLabel,
  type NoteRef,
} from "./mentions";
import type { OpenInKind } from "./nostr-clients";
import {
  fetchEventById,
  formatCreateAtDate,
  getKind0Profiles,
  readCachedKind0Profiles,
} from "./nostr";

/** Kind 1 text notes and NIP-22 comments (1111) render as compact quote cards. */
export const QUOTEABLE_NOTE_KINDS = new Set([1, 1111]);

export function isQuoteableNoteKind(kind: number | undefined): boolean {
  return kind === undefined || QUOTEABLE_NOTE_KINDS.has(kind);
}

type Status =
  | { kind: "loading" }
  | {
      kind: "ready";
      content: string;
      tags: string[][];
      pubkey: string;
      createdAt: number;
      profile?: Kind0Profile;
    }
  | { kind: "fallback" };

function FallbackLink({
  code,
  onOpen,
}: {
  code: string;
  onOpen?: (kind: OpenInKind, code: string) => void;
}) {
  return (
    <a
      className="note-mention"
      href={njumpHref(code)}
      target="_blank"
      rel="noreferrer"
      title={code}
      onClick={(event) => {
        if (!onOpen) return;
        if (!isUnmodifiedLeftClick(event)) return;
        event.preventDefault();
        onOpen("note", code);
      }}
    >
      {noteRefLabel(code)}
    </a>
  );
}

export function QuotedNote({
  noteRef,
  profiles = {},
  onOpen,
}: {
  noteRef: NoteRef;
  profiles?: Record<string, Kind0Profile>;
  onOpen?: (kind: OpenInKind, code: string) => void;
}) {
  const [status, setStatus] = useState<Status>(() => {
    if (!isQuoteableNoteKind(noteRef.kind)) {
      return { kind: "fallback" };
    }
    return { kind: "loading" };
  });

  useEffect(() => {
    if (!isQuoteableNoteKind(noteRef.kind)) {
      setStatus({ kind: "fallback" });
      return;
    }

    let cancelled = false;
    setStatus({ kind: "loading" });

    void fetchEventById(
      noteRef.id,
      noteRef.relayHints,
      noteRef.author
    ).then(async (event) => {
      if (cancelled) return;
      if (!event || !QUOTEABLE_NOTE_KINDS.has(event.kind)) {
        setStatus({ kind: "fallback" });
        return;
      }

      const pubkey = event.pubkey.toLowerCase();
      const cached =
        profiles[pubkey] ?? readCachedKind0Profiles([pubkey])[pubkey];
      setStatus({
        kind: "ready",
        content: event.content,
        tags: event.tags,
        pubkey,
        createdAt: event.created_at,
        profile: cached,
      });

      if (!cached) {
        const found = await getKind0Profiles([
          { pubkey, relayHints: noteRef.relayHints },
        ]);
        if (cancelled) return;
        const profile = found[pubkey];
        if (!profile) return;
        setStatus((prev) =>
          prev.kind === "ready" && prev.pubkey === pubkey
            ? { ...prev, profile }
            : prev
        );
      }
    });

    return () => {
      cancelled = true;
    };
    // `code` encodes id / relays / author; ignore profiles + array identity churn.
  }, [noteRef.code]);

  if (status.kind === "fallback") {
    return <FallbackLink code={noteRef.code} onOpen={onOpen} />;
  }

  if (status.kind === "loading") {
    return (
      <span className="note-quote note-quote-loading" aria-hidden>
        <span className="note-quote-author">
          <span className="avatar avatar-empty" />
          <span className="note-quote-author-copy">
            <span className="note-link-preview-skeleton note-link-preview-skeleton-sm" />
            <span className="note-link-preview-skeleton note-link-preview-skeleton-md" />
          </span>
        </span>
        <span className="note-quote-skeleton-lines">
          <span className="note-link-preview-skeleton" />
          <span className="note-link-preview-skeleton note-link-preview-skeleton-md" />
        </span>
      </span>
    );
  }

  const { content, tags, pubkey, createdAt } = status;
  const profile = profiles[pubkey] ?? status.profile;
  const name = profileLabel(pubkey, profile?.displayName);
  const npub = nip19.npubEncode(pubkey);

  const nameEl = npub ? (
    <a
      className="note-quote-author-name"
      href={njumpHref(npub)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        if (!onOpen) return;
        if (!isUnmodifiedLeftClick(event)) return;
        event.preventDefault();
        onOpen("profile", npub);
      }}
    >
      {name}
    </a>
  ) : (
    <span className="note-quote-author-name">{name}</span>
  );

  return (
    <div className="note-quote">
      <div className="note-quote-author">
        <Avatar src={profile?.picture} />
        <span className="note-quote-author-copy">
          {nameEl}
          <a
            className="note-quote-permalink"
            href={njumpHref(noteRef.code)}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (!onOpen || !isUnmodifiedLeftClick(event)) return;
              event.preventDefault();
              onOpen("note", noteRef.code);
            }}
          >
            <time dateTime={new Date(createdAt * 1000).toISOString()}>
              {formatCreateAtDate(createdAt)}
            </time>
          </a>
        </span>
      </div>
      <div className="note-quote-content">
        <NoteContent
          renderPreviews={false}
          content={content}
          tags={tags}
          profiles={profiles}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}
