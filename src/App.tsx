import { useState, type FormEventHandler } from "react";
import {
  Container,
  Heading,
  Input,
  FormControl,
  FormLabel,
  Button,
  HStack,
  VStack,
  Card,
  Text,
  Link,
  useToast,
  Box,
  Flex,
} from "@chakra-ui/react";
import { relayInit, nip19, type Event } from "nostr-tools";
import copy from "copy-to-clipboard";

export default function App() {
  const [isSearching, setIsSearching] = useState(false);
  const [npub, setNpub] = useState<string>();
  const [query, setQuery] = useState<string>();
  const [fromDate, setFromDate] = useState<number>();
  const [toDate, setToDate] = useState<number>();
  const [events, setEvents] = useState<Event[]>([]);
  const toast = useToast();
  const decodeNpub = (npub: string) => {
    try {
      const { type, data } = nip19.decode(npub);

      if (type === "npub") {
        return data as string;
      }
    } catch (err) {
      if (err instanceof Error) {
        toast({
          title: err.message,
          status: "error",
        });
      }
    }
  };
  const handleSubmit: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();

    if (!npub && !query) {
      toast({
        title: "npub or search query is required",
        status: "warning",
      });
      return;
    }

    setIsSearching(true);
    const relay = relayInit("wss://relay.nostr.band");

    relay.on("connect", async () => {
      console.log(`connected to ${relay.url}`);

      const decodedNpub = npub && decodeNpub(npub);
      const events = await relay.list([
        {
          kinds: [1],
          authors: decodedNpub ? [decodedNpub] : undefined,
          search: query && query.length > 0 ? query : undefined,
          since: fromDate,
          until: toDate,
        },
      ]);

      if (events.length === 0) {
        toast({
          title: "no events found",
          status: "info",
        });
      }

      setEvents(events);
      setIsSearching(false);
      relay.close();
    });

    relay.on("error", () => {
      console.log(`failed to connect to ${relay.url}`);
      setIsSearching(false);
    });

    relay.connect();
  };
  const formatCreateAtDate = (unixTimestamp: number) => {
    const date = new Date(unixTimestamp * 1000);
    const options: Intl.DateTimeFormatOptions = { month: "short" };
    const monthName = date.toLocaleString(navigator.language, options);
    const day = date.getDate();

    return `${monthName} ${day}`;
  };

  return (
    <Container mt={16}>
      <Heading mb={2}>Advanced Nostr Search</Heading>
      <form onSubmit={handleSubmit}>
        <VStack>
          <Input
            autoFocus
            placeholder="author npub"
            onChange={(e) => setNpub(e.target.value)}
          />
          <Input
            placeholder="search query"
            onChange={(e) => setQuery(e.target.value)}
          />
          <HStack w="100%">
            <FormControl>
              <FormLabel>From Date</FormLabel>
              <Input
                placeholder="since"
                size="md"
                type="date"
                onChange={(e) =>
                  setFromDate(
                    e.target.value
                      ? new Date(e.target.value).getTime() / 1000
                      : undefined
                  )
                }
              />
            </FormControl>
            <FormControl>
              <FormLabel>To Date</FormLabel>
              <Input
                placeholder="until"
                size="md"
                type="date"
                onChange={(e) =>
                  setToDate(
                    e.target.value
                      ? new Date(e.target.value).getTime() / 1000
                      : undefined
                  )
                }
              />
            </FormControl>
          </HStack>
        </VStack>
        <Flex justifyContent="flex-end">
          <Button
            mt={4}
            colorScheme="purple"
            type="submit"
            isLoading={isSearching}
          >
            Submit
          </Button>
        </Flex>
      </form>
      {events.map(({ id, content, created_at }) => {
        const noteId = nip19.noteEncode(id);

        return (
          <Card key={id} p={4} mt={8}>
            <Text fontWeight="bold">{formatCreateAtDate(created_at)}</Text>
            <Text>{content}</Text>
            <HStack mt={4} justifyContent="right">
              <Link href={`nostr:${noteId}`} isExternal>
                <Button>Open</Button>
              </Link>
              <Button
                onClick={() => {
                  toast({
                    render: () => (
                      <Box
                        p={3}
                        bg="purple.100"
                        textAlign="center"
                        borderRadius={8}
                      >
                        copied to clipboard
                      </Box>
                    ),
                  });
                  copy(noteId);
                }}
              >
                Copy ID
              </Button>
            </HStack>
          </Card>
        );
      })}
    </Container>
  );
}
