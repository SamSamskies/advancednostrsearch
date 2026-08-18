import { Fragment } from "react";
import {
  classifyUrl,
  hyperlinkRegex,
  newlineRegex,
  normalizeHttpUrl,
} from "./media";

const wavlakeRegex =
  /(https?:\/\/(?:player\.|www\.)?wavlake\.com\/(?!top|new|artists|account|activity|login|preferences|feed|profile|shows)(?:(?:track|album)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z-]+))/gi;

export const NoteContent = ({
  content,
  tags = [],
}: {
  content: string;
  tags?: string[][];
}) => {
  const parts = content.split(
    new RegExp(`(?:${newlineRegex.source}|${hyperlinkRegex.source})`, "gi")
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
