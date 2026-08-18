import { Fragment } from "react";

const newlineRegex = /(\r?\n)/gi;
const hyperlinkRegex = /(https?:\/\/[^\s]+)/gi;
const wavlakeRegex =
  /(https?:\/\/(?:player\.|www\.)?wavlake\.com\/(?!top|new|artists|account|activity|login|preferences|feed|profile|shows)(?:(?:track|album)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z-]+))/gi;
const imageUrlRegex =
  /(https?:\/\/.*\.(?:png|jpg|jpeg|jfif|gif|bmp|svg|webp))/gi;
const videoUrlRegex = /(https?:\/\/.*\.(?:mp4|mov|ogg|webm|mkv|avi|m4v))/gi;

export const NoteContent = ({ content }: { content: string }) => {
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

        if (part.match(wavlakeRegex)) {
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

        if (part.match(imageUrlRegex)) {
          return (
            <img key={index} className="note-image" src={part} alt="" />
          );
        }

        if (part.match(videoUrlRegex)) {
          return (
            <video key={index} className="note-video" src={part} controls>
              {part}
            </video>
          );
        }

        if (part.match(hyperlinkRegex)) {
          return (
            <a key={index} href={part} target="_blank" rel="noreferrer">
              {part}
            </a>
          );
        }

        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
};
