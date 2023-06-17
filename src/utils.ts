import { nip19 } from "nostr-tools";

export const formatCreateAtDate = (unixTimestamp: number) => {
  const date = new Date(unixTimestamp * 1000);
  const options: Intl.DateTimeFormatOptions = { month: "short" };
  const monthName = date.toLocaleString(navigator.language, options);
  const day = date.getDate();

  return `${monthName} ${day}`;
};

export const convertDateToUnixTimestamp = (date: string) =>
  new Date(date).getTime() / 1000;

export const decodeNpub = (npub: string) => {
  const { type, data } = nip19.decode(npub);

  if (type === "npub") {
    return data as string;
  }
};
