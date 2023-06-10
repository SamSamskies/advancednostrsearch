import { Image } from "@chakra-ui/react";

const replaceImageUrlsWithImages = (content: string) => {
  const imageUrlRegex =
    /(https?:\/\/.*\.(?:png|jpg|jpeg|jfif|gif|bmp|svg|webp))/gi;
  const parts = content.split(imageUrlRegex);

  return parts.map((part, index) => {
    if (part.match(imageUrlRegex)) {
      return <Image key={index} src={part} alt={part} my={2} />;
    }
    return part;
  });
};

export const NoteContent = ({ content }: { content: string }) => {
  let formattedContent = replaceImageUrlsWithImages(content);

  return <>{formattedContent}</>;
};
