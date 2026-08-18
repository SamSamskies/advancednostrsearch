import { Fragment } from "react";
import {
  classifyUrl,
  hyperlinkRegex,
  newlineRegex,
  normalizeHttpUrl,
} from "./media";
import {
  mentionLabel,
  mentionRegex,
  njumpProfileHref,
  parseMention,
} from "./mentions";
import type { Kind0Profile } from "./identity";

const wavlakeRegex =
  /(https?:\/\/(?:player\.|www\.)?wavlake\.com\/(?!top|new|artists|account|activity|login|preferences|feed|profile|shows)(?:(?:track|album)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z-]+))/gi;

export const NoteContent = ({
  content,
  tags = [],
  profiles = {},
  onOpenProfile,
}: {
  content: string;
  tags?: string[][];
  profiles?: Record<string, Kind0Profile>;
  onOpenProfile?: (code: string) => void;
}) => {
  const parts = content.split(
    new RegExp(
      `(?:${newlineRegex.source}|${mentionRegex.source}|${hyperlinkRegex.source})`,
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

        const mention = parseMention(part);
        if (mention) {
          return (
            <a
              key={index}
              className="note-mention"
              href={njumpProfileHref(mention.code)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (!onOpenProfile) return;
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                onOpenProfile(mention.code);
              }}
            >
              {mentionLabel(
                mention.pubkey,
                profiles[mention.pubkey]?.displayName
              )}
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
