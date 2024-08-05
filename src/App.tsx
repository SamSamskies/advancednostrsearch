import {
  useState,
  useEffect,
  type ChangeEvent,
  type SetStateAction,
  type Dispatch,
  type FormEvent,
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
  RadioGroup,
  Radio,
  Stack,
} from "@chakra-ui/react";
import * as nip19 from "nostr-tools/nip19";
import type { Event } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import copy from "copy-to-clipboard";
import InfiniteScroll from "react-infinite-scroll-component";
import { NoteContent } from "./NoteContent";
import {
  convertDateToUnixTimestamp,
  formatCreateAtDate,
  decodeNpub,
  chunkArray,
  getUserReactionEventIds,
  getFollowedPubkeys,
  findFromRelays,
} from "./utils";

const INCLUDE_FOLLOWED_USERS_QUERY_PARAM = "followed";
const INCLUDE_ONLY_AUTHOR_QUERY_PARAM = "onlyAuthor";
const INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM =
  "onlyNotesAuthorReactedTo";

export default function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const [isSearching, setIsSearching] = useState(false);
  const [npub, setNpub] = useState<string>(queryParams.get("npub") ?? "");
  const [include, setInclude] = useState<string>(
    queryParams.get("include") ?? INCLUDE_ONLY_AUTHOR_QUERY_PARAM
  );
  const includeNotesFromFollowedUsers =
    include === INCLUDE_FOLLOWED_USERS_QUERY_PARAM;
  const includeOnlyNotesAuthorReactedTo =
    include === INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM;
  const [query, setQuery] = useState<string>(queryParams.get("query") ?? "");
  const [fromDate, setFromDate] = useState<string>(
    queryParams.get("fromDate") ?? ""
  );
  const [toDate, setToDate] = useState<string>(queryParams.get("toDate") ?? "");
  const [events, setEvents] = useState<Event[]>([]);
  const [currentDataLength, setCurrentDataLength] = useState(0);
  const toast = useToast();
  const handleSubmit = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();

    let decodedNpub: string = "";

    try {
      decodedNpub = decodeNpub(npub) ?? "";
    } catch (err) {
      if (err instanceof Error) {
        toast({
          title: err.message,
          status: "error",
        });
      }
    }

    if (!decodedNpub) {
      return;
    }

    setIsSearching(true);

    const relays = ["wss://relay.nostr.band"];

    const fetchEvents = async () => {
      const defaultKindOneFilter = {
        kinds: [1],
        search: query && query.length > 0 ? query : undefined,
        since: fromDate ? convertDateToUnixTimestamp(fromDate) : undefined,
        until: toDate ? convertDateToUnixTimestamp(toDate) : undefined,
      };

      if (includeOnlyNotesAuthorReactedTo) {
        const reactionEventIds = await getUserReactionEventIds({
          pubkey: decodedNpub,
          since: defaultKindOneFilter.since,
          until: defaultKindOneFilter.until,
        });

        return findFromRelays(relays, {
          ...defaultKindOneFilter,
          ids: reactionEventIds,
        } as Filter);
      }

      const followedAuthorPubkeys = includeNotesFromFollowedUsers
        ? await getFollowedPubkeys(decodedNpub)
        : [];
      const authors = includeNotesFromFollowedUsers
        ? [...followedAuthorPubkeys, decodedNpub]
        : [decodedNpub];
      const dedupedAuthors = Array.from(new Set(authors));
      const eventPromises = chunkArray(dedupedAuthors, 256).map(
        (authorsChunk) => {
          return findFromRelays(relays, {
            ...defaultKindOneFilter,
            authors: authorsChunk,
          } as Filter);
        }
      );

      const eventChunks = await Promise.all(eventPromises);

      return eventChunks
        .flat()
        .filter((event): event is Event => event !== null)
        .sort((a, b) => b.created_at - a.created_at);
    };

    try {
      const events = (await fetchEvents()) ?? [];

      if (events.length === 0) {
        toast({
          title: "no events found",
          status: "info",
        });
      }

      setCurrentDataLength(Math.min(5, events.length));
      setEvents(events);
    } catch (error) {
      toast({
        title:
          error instanceof Error ? error.message : "Something went wrong :(",
        status: "error",
      });
      setCurrentDataLength(0);
      setEvents([]);
    } finally {
      setIsSearching(false);
    }
  };

  const updateUrl = (queryParams?: URLSearchParams) => {
    window.history.replaceState(
      null,
      "",
      queryParams
        ? `${window.location.pathname}?${queryParams.toString()}`
        : window.location.pathname
    );
  };
  const updateQueryParams = (key: string, value: string) => {
    const queryParams = new URLSearchParams(window.location.search);

    if (value) {
      queryParams.set(key, value);
    } else {
      queryParams.delete(key);
    }

    updateUrl(queryParams);
  };
  const makeInputOnChangeHandler =
    (set: Dispatch<SetStateAction<string>>, key: string) =>
    (e: ChangeEvent<HTMLInputElement>) => {
      updateQueryParams(key, e.target.value);
      set(e.target.value);
    };
  const handleIncludeChange = (value: string) => {
    updateQueryParams("include", value);
    setInclude(value);
  };
  const updateCurrentDataLength = () => {
    setCurrentDataLength((prev) =>
      prev + 5 < events.length ? prev + 5 : events.length
    );
  };
  const handleClear = () => {
    updateUrl();
    setNpub("");
    setInclude(INCLUDE_ONLY_AUTHOR_QUERY_PARAM);
    setQuery("");
    setFromDate("");
    setToDate("");
    setEvents([]);
  };

  useEffect(() => {
    if (npub && query) {
      handleSubmit();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Container mt={16} pb={100}>
      <Heading mb={2}>Advanced Nostr Search</Heading>
      <form onSubmit={handleSubmit}>
        <VStack>
          <Input
            autoFocus
            placeholder="author npub"
            onChange={makeInputOnChangeHandler(setNpub, "npub")}
            value={npub}
            required
          />
          <Input
            placeholder="search query"
            onChange={makeInputOnChangeHandler(setQuery, "query")}
            value={query}
          />
          <Card p={4}>
            <RadioGroup
              colorScheme="purple"
              onChange={handleIncludeChange}
              value={include}
            >
              <Stack>
                <Radio value={INCLUDE_ONLY_AUTHOR_QUERY_PARAM}>
                  Include only author notes
                </Radio>
                <Radio value={INCLUDE_ONLY_NOTES_AUTHOR_REACTED_TO_QUERY_PARAM}>
                  Include only notes author has reacted to
                </Radio>
                <Radio value={INCLUDE_FOLLOWED_USERS_QUERY_PARAM}>
                  Include notes from author as well as notes from users that the
                  author follows
                </Radio>
              </Stack>
            </RadioGroup>
          </Card>
          <HStack w="100%">
            <FormControl>
              <FormLabel>From Date</FormLabel>
              <Input
                placeholder="since"
                size="md"
                type="date"
                onChange={makeInputOnChangeHandler(setFromDate, "fromDate")}
                value={fromDate}
              />
            </FormControl>
            <FormControl>
              <FormLabel>To Date</FormLabel>
              <Input
                placeholder="until"
                size="md"
                type="date"
                onChange={makeInputOnChangeHandler(setToDate, "toDate")}
                value={toDate}
              />
            </FormControl>
          </HStack>
        </VStack>
        <Flex justifyContent="flex-end" mt={4}>
          <Button mr={2} onClick={handleClear}>
            Clear
          </Button>
          <Button colorScheme="purple" type="submit" isLoading={isSearching}>
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
                  <Link href={`https://njump.me/${noteId}`} isExternal>
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
