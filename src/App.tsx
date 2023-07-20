import {
  useState,
  type FormEventHandler,
  type ChangeEvent,
  type SetStateAction,
  type Dispatch,
} from "react";
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
import InfiniteScroll from "react-infinite-scroll-component";
import { NoteContent } from "./NoteContent";
import { convertDateToUnixTimestamp, formatCreateAtDate } from "./utils";

export default function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const [isSearching, setIsSearching] = useState(false);
  const [fromDate, setFromDate] = useState<string>(
    queryParams.get("fromDate") ?? ""
  );
  const [toDate, setToDate] = useState<string>(queryParams.get("toDate") ?? "");
  const [events, setEvents] = useState<Event[]>([]);
  const [currentDataLength, setCurrentDataLength] = useState(0);
  const toast = useToast();
  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();

    setIsSearching(true);
    const relay = relayInit("wss://relay.damus.io");

    relay.on("connect", async () => {
      console.log(`connected to ${relay.url}`);
      const events = await relay.list([
        {
          kinds: [1],
          authors: [
            "ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74",
          ],
          since: fromDate ? convertDateToUnixTimestamp(fromDate) : undefined,
          until: toDate ? convertDateToUnixTimestamp(toDate) : undefined,
        },
      ]);

      if (events.length === 0) {
        toast({
          title: "no events found",
          status: "info",
        });
      }

      setCurrentDataLength(Math.min(5, events.length));
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

  const updateUrl = (queryParams: URLSearchParams) => {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${queryParams.toString()}`
    );
  };
  const makeOnChangeHandler =
    (set: Dispatch<SetStateAction<string>>, key: string) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const queryParams = new URLSearchParams(window.location.search);

      if (e.target.value) {
        queryParams.set(key, e.target.value);
      } else {
        queryParams.delete(key);
      }

      updateUrl(queryParams);
      set(e.target.value);
    };
  const updateCurrentDataLength = () => {
    setCurrentDataLength((prev) =>
      prev + 5 < events.length ? prev + 5 : events.length
    );
  };

  return (
    <Container mt={16} pb={100}>
      <Heading mb={2}>Advanced Nostr Search</Heading>
      <form onSubmit={handleSubmit}>
        <VStack>
          <HStack w="100%">
            <FormControl>
              <FormLabel>From Date</FormLabel>
              <Input
                placeholder="since"
                size="md"
                type="date"
                onChange={makeOnChangeHandler(setFromDate, "fromDate")}
                value={fromDate}
              />
            </FormControl>
            <FormControl>
              <FormLabel>To Date</FormLabel>
              <Input
                placeholder="until"
                size="md"
                type="date"
                onChange={makeOnChangeHandler(setToDate, "toDate")}
                value={toDate}
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
      <InfiniteScroll
        dataLength={currentDataLength}
        next={updateCurrentDataLength}
        loader={null}
        hasMore={currentDataLength < events.length}
      >
        {events
          .slice(0, currentDataLength)
          .map(({ id, content, created_at }) => {
            const noteId = nip19.noteEncode(id);

            return (
              <Card key={id} p={4} mt={8}>
                <Text fontWeight="bold" mb={2}>
                  {formatCreateAtDate(created_at)}
                </Text>
                <NoteContent content={content} />
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
      </InfiniteScroll>
    </Container>
  );
}
