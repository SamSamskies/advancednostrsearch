import { Fragment } from "react";
import { Image, Box } from "@chakra-ui/react";

export const NoteContent = ({ content }: { content: string }) => {
  const imageUrlRegex =
    /(https?:\/\/.*\.(?:png|jpg|jpeg|jfif|gif|bmp|svg|webp))/gi;
  const videoUrlRegex = /(https?:\/\/.*\.(?:mp4|mov|ogg|webm|mkv|avi|m4v))/gi;
  const parts = content.split(
    new RegExp(`(?:${imageUrlRegex.source}|${videoUrlRegex.source})`, "gi")
  );
  const formattedContent = parts.map((part, index) => {
    if (part === undefined) {
      return null;
    }

    if (part.match(imageUrlRegex)) {
      return <Image key={index} src={part} alt={part} my={2} />;
    }

    if (part.match(videoUrlRegex)) {
      return (
        <Box my={2}>
          <video key={index} src={part} controls style={{ width: "100%" }}>
            {part}
          </video>
        </Box>
      );
    }

    return <Fragment key={index}>{part}</Fragment>;
  });

  return <>{formattedContent}</>;
};
