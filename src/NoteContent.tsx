import { Fragment } from "react";
import { Image, Box } from "@chakra-ui/react";

export const NoteContent = ({ content }: { content: string }) => {
  const newlineRegex = /(\r?\n)/gi;
  const wavlakeRegex =
    /(https?:\/\/(?:player\.|www\.)?wavlake\.com\/(?!top|new|artists|account|activity|login|preferences|feed|profile)(?:(?:track|album)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|[a-z-]+))/gi;
  const imageUrlRegex =
    /(https?:\/\/.*\.(?:png|jpg|jpeg|jfif|gif|bmp|svg|webp))/gi;
  const videoUrlRegex = /(https?:\/\/.*\.(?:mp4|mov|ogg|webm|mkv|avi|m4v))/gi;
  const parts = content.split(
    new RegExp(
      `(?:${newlineRegex.source}|${wavlakeRegex.source}|${imageUrlRegex.source}|${videoUrlRegex.source})`,
      "gi"
    )
  );
  console.log(parts);
  const formattedContent = parts.map((part, index) => {
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
          style={{ borderRadius: 12, borderWidth: 0 }}
          src={convertedUrl}
          width="100%"
          height="380"
          loading="lazy"
          title="WavLake Embed"
        ></iframe>
      );
    }

    if (part.match(imageUrlRegex)) {
      return <Image key={index} src={part} alt={part} my={2} />;
    }

    if (part.match(videoUrlRegex)) {
      return (
        <Box key={index} my={2}>
          <video src={part} controls style={{ width: "100%" }}>
            {part}
          </video>
        </Box>
      );
    }

    return <Fragment key={index}>{part}</Fragment>;
  });

  return <>{formattedContent}</>;
};
