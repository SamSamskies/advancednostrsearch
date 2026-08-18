import { Fragment, useEffect, useState } from "react";
import {
  classifyUrl,
  hyperlinkRegex,
  newlineRegex,
  normalizeHttpUrl,
} from "./media";
import {
  isUnmodifiedLeftClick,
  mentionLabel,
  njumpHref,
  noteRefLabel,
  nostrUriRegex,
  parseNostrEntity,
} from "./mentions";
import { isSafeHttpUrl, type Kind0Profile } from "./identity";
import type { OpenInKind } from "./nostr-clients";

const wavlakeRegex =
  /(https?:\/\/(?:player\.|www\.)?wavlake\.com\/(?!top|new|artists|account|activity|login|preferences|feed|profile|shows)(?:(?:track|album)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z-]+))/gi;

/** NIP-30 shortcodes: `:name:` with alphanumeric, hyphen, or underscore. */
const customEmojiRegex = /(:[A-Za-z0-9_-]+:)/g;
const SHORTCODE = /^[A-Za-z0-9_-]+$/;

function parseEmojiTags(tags: string[][]): Map<string, string> {
  const emojis = new Map<string, string>();
  for (const tag of tags) {
    if (tag[0] !== "emoji") continue;
    const shortcode = tag[1]?.trim();
    const url = tag[2]?.trim();
    if (!shortcode || !SHORTCODE.test(shortcode)) continue;
    if (!url || !isSafeHttpUrl(url)) continue;
    emojis.set(shortcode.toLowerCase(), url);
  }
  return emojis;
}

function CustomEmoji({
  shortcode,
  src,
}: {
  shortcode: string;
  src: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const token = `:${shortcode}:`;
  if (failed) return token;

  return (
    <img
      className="note-emoji"
      src={src}
      alt={token}
      title={token}
      referrerPolicy="no-referrer"
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export const NoteContent = ({
  content,
  tags = [],
  profiles = {},
  onOpen,
}: {
  content: string;
  tags?: string[][];
  profiles?: Record<string, Kind0Profile>;
  onOpen?: (kind: OpenInKind, code: string) => void;
}) => {
  const emojis = parseEmojiTags(tags);
  const parts = content.split(
    new RegExp(
      `(?:${newlineRegex.source}|${nostrUriRegex.source}|${hyperlinkRegex.source}${
        emojis.size > 0 ? `|${customEmojiRegex.source}` : ""
      })`,
      "gi"
    )
  );

  return (
    <>
      {parts.map((part, index) => {
        if (part === undefined || part === "") {
          return null;
        }

        if (part.match(newlineRegex)) {
          return <br key={index} />;
        }

        const entity = parseNostrEntity(part);
        if (entity) {
          const kind: OpenInKind = entity.type === "profile" ? "profile" : "note";
          const label =
            entity.type === "profile"
              ? mentionLabel(
                  entity.pubkey,
                  profiles[entity.pubkey]?.displayName
                )
              : noteRefLabel(entity.code);

          return (
            <a
              key={index}
              className="note-mention"
              href={njumpHref(entity.code)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!onOpen) return;
                if (!isUnmodifiedLeftClick(event)) return;
                event.preventDefault();
                onOpen(kind, entity.code);
              }}
            >
              {label}
            </a>
          );
        }

        if (/^https?:\/\//i.test(part) && part.match(wavlakeRegex)) {
          const convertedUrl = part.replace(
            /(?:player\.|www\.)?wavlake\.com/,
            "embed.wavlake.com"
          );

          return (
            <iframe
              key={index}
              className="note-embed"
              src={convertedUrl}
              loading="lazy"
              title="WavLake Embed"
            />
          );
        }

        const emojiMatch = /^:([A-Za-z0-9_-]+):$/.exec(part);
        const emojiUrl = emojiMatch
          ? emojis.get(emojiMatch[1].toLowerCase())
          : undefined;
        if (emojiUrl && emojiMatch) {
          return (
            <CustomEmoji
              key={index}
              shortcode={emojiMatch[1]}
              src={emojiUrl}
            />
          );
        }

        if (!/^https?:\/\//i.test(part)) {
          return <Fragment key={index}>{part}</Fragment>;
        }

        const url = normalizeHttpUrl(part);
        const media = classifyUrl(url, tags);

        if (media === "image") {
          return (
            <img
              key={index}
              className="note-image"
              src={url}
              alt=""
              loading="lazy"
            />
          );
        }

        if (media === "video") {
          return (
            <video key={index} className="note-video" src={url} controls>
              {url}
            </video>
          );
        }

        if (part.match(hyperlinkRegex)) {
          return (
            <a key={index} href={url} target="_blank" rel="noreferrer">
              {part}
            </a>
          );
        }

        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
};
