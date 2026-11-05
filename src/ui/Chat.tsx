import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListViewToken,
} from 'react-native';
import type {
  Attachment,
  ConcordApi,
  DmSummary,
  Gif,
} from '../core/ConcordApi';
import { Conversation } from '../state/conversation';
import { describeError, useSession } from '../state/session';
import { colors } from './theme';

// ponytail: GIF lookups are kept for the app run, because the proxy allows 30 a
// minute per user. Persist them if GIF-heavy conversations still hit that limit.
type Lookup = {
  promise: Promise<Gif | null>;
  gif?: Gif | null;
  failedAt?: number;
};
const gifLookups = new WeakMap<ConcordApi, Map<string, Lookup>>();
const GIF_RETRY_MS = 60_000;

function lookupGif(api: ConcordApi, slug: string): Lookup {
  let lookups = gifLookups.get(api);
  if (!lookups) {
    lookups = new Map();
    gifLookups.set(api, lookups);
  }
  const known = lookups.get(slug);
  // A failed lookup is tried again after a minute, not on every view of the message.
  if (
    known &&
    (known.failedAt === undefined || Date.now() - known.failedAt < GIF_RETRY_MS)
  )
    return known;
  const lookup: Lookup = { promise: api.gif(slug) };
  lookup.promise.then(
    gif => {
      lookup.gif = gif;
    },
    () => {
      lookup.failedAt = Date.now();
    },
  );
  lookups.set(slug, lookup);
  return lookup;
}

/** Fits a GIF inside 240 x 320 points, keeping its shape. */
function fit(width = 0, height = 0) {
  const [w, h] = width > 0 && height > 0 ? [width, height] : [200, 150];
  const scale = Math.min(1, 240 / w, 320 / h);
  return { width: w * scale, height: h * scale };
}

/**
 * A GIF message, through Concord's proxy. As on desktop, it loads once the message is
 * on screen, and only after a tap when the user turned automatic GIF loading off.
 */
function GifView({
  api,
  slug,
  visible,
  auto,
}: Readonly<{
  api: ConcordApi;
  slug: string;
  visible: boolean;
  auto: boolean | null;
}>) {
  const [tapped, setTapped] = useState(false);
  const [source, setSource] = useState<
    (Gif & { headers: Record<string, string> }) | null
  >(null);
  const [failed, setFailed] = useState(false);
  const load = visible && (auto === true || tapped);
  useEffect(() => {
    setSource(null);
    setFailed(false);
    if (!load) return;
    let live = true;
    // Headers are read after the lookup, so they carry a current access token.
    lookupGif(api, slug)
      .promise.then(gif =>
        gif
          ? api.mediaSource(gif.uri).then(media => ({ ...gif, ...media }))
          : null,
      )
      .then(
        next => {
          if (!live) return;
          if (next) setSource(next);
          else setFailed(true);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    return () => {
      live = false;
    };
  }, [api, slug, load]);
  if (auto === false && !tapped)
    return (
      <Pressable accessibilityRole="button" onPress={() => setTapped(true)}>
        <Text style={styles.attachment}>GIF, tap to load</Text>
      </Pressable>
    );
  if (failed) return <Text style={styles.attachment}>GIF</Text>;
  if (!source) {
    // A GIF seen before keeps its size while it reloads, so the list does not jump.
    const known = gifLookups.get(api)?.get(slug)?.gif;
    return known ? (
      <View style={[styles.gif, fit(known.width, known.height)]} />
    ) : (
      <Text style={styles.attachment}>GIF</Text>
    );
  }
  return (
    <Image
      accessibilityLabel="GIF"
      source={{ uri: source.uri, headers: source.headers }}
      style={[styles.gif, fit(source.width, source.height)]}
      onError={() => setFailed(true)}
    />
  );
}

const KINDS = new Map([
  ['photo', 'Photo'],
  ['animated', 'Animated image'],
  ['video', 'Video'],
  ['audio', 'Audio'],
]);

/** "Photo, 2.0 KB": attachments are named until the app can decrypt and show them. */
function attachmentLabel({ fileType, fileSize }: Attachment): string {
  const kind = KINDS.get(fileType) ?? 'File';
  if (fileSize < 1024) return `${kind}, ${fileSize} B`;
  if (fileSize < 1024 * 1024)
    return `${kind}, ${(fileSize / 1024).toFixed(1)} KB`;
  return `${kind}, ${(fileSize / 1024 / 1024).toFixed(1)} MB`;
}

/** One DM conversation: decrypted history, live messages and a composer. */
export function Chat({
  dm,
  onBack,
  open = (api, identity, id, me) => new Conversation(api, identity, id, me),
}: {
  dm: DmSummary;
  onBack: () => void;
  open?: (
    ...args: ConstructorParameters<typeof Conversation>
  ) => Pick<
    Conversation,
    'lines' | 'dropped' | 'onChange' | 'start' | 'send' | 'close'
  >;
}) {
  const { api, identity, stage } = useSession();
  const me = stage.kind === 'signed_in' ? stage.userId : '';
  const conversation = useMemo(
    () => (api && identity ? open(api, identity, dm.id, me) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one conversation per screen
    [api, identity, dm.id, me],
  );
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const liveConversation = useRef<typeof conversation>(null);
  // null until the privacy setting arrives; a failed read counts as off.
  const [autoGifs, setAutoGifs] = useState<boolean | null>(null);
  // Messages that have been on screen; a GIF starts loading once its message has.
  const [seen, markSeen] = useReducer(
    (prev: ReadonlySet<string>, ids: string[]) =>
      ids.every(id => prev.has(id)) ? prev : new Set([...prev, ...ids]),
    new Set<string>(),
  );
  const onViewable = useRef((info: { viewableItems: ListViewToken[] }) =>
    markSeen(info.viewableItems.map(v => v.key)),
  ).current;
  const listState = useMemo(() => ({ seen, autoGifs }), [seen, autoGifs]);

  const lines = conversation?.lines ?? [];
  const hasGifs = lines.some(l => l.gifSlug);

  useEffect(() => {
    // Read only for a conversation that has GIFs.
    if (!api || !hasGifs) return;
    let live = true;
    api.loadGifsAutomatically().then(
      on => {
        if (live) setAutoGifs(on);
      },
      () => {
        if (live) setAutoGifs(false);
      },
    );
    return () => {
      live = false;
    };
  }, [api, hasGifs]);

  useEffect(() => {
    if (!conversation) return;
    liveConversation.current = conversation;
    let live = true;
    setLoading(true);
    setSending(false);
    setError(null);
    conversation.onChange = () => {
      if (live) refresh();
    };
    conversation
      .start()
      .catch(e => {
        if (live) setError(describeError(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      liveConversation.current = null;
      conversation.onChange = null;
      conversation.close();
    };
  }, [conversation]);

  const send = async () => {
    const text = draft.trim();
    if (!conversation || liveConversation.current !== conversation || !text)
      return;
    setSending(true);
    setError(null);
    // Cleared now, so edits made while sending are kept; restored if the send fails.
    setDraft('');
    try {
      await conversation.send(text);
    } catch (e) {
      if (liveConversation.current === conversation) {
        setDraft(current => current || text);
        setError(describeError(e));
      }
    } finally {
      if (liveConversation.current === conversation) setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {dm.title}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {conversation?.dropped ? (
        <Text style={styles.error}>
          Disconnected. Go back and reopen the conversation to reconnect.
        </Text>
      ) : null}
      {loading && lines.length === 0 ? (
        <Text style={styles.note}>Decrypting messages…</Text>
      ) : null}
      {!loading && lines.length === 0 && !error ? (
        <Text style={styles.note}>No messages yet. Say hello.</Text>
      ) : null}
      <FlatList
        style={styles.list}
        // Inverted, so the newest message sits above the composer.
        inverted
        data={[...lines].reverse()}
        keyExtractor={l => l.id}
        extraData={listState}
        onViewableItemsChanged={onViewable}
        renderItem={({ item }) => (
          <View
            style={[styles.bubble, item.userId === me ? styles.mine : null]}
          >
            {item.userId === me ? null : (
              <Text style={styles.sender}>{item.sender || dm.title}</Text>
            )}
            {item.text ? (
              <Text style={item.unreadable ? styles.unreadable : styles.text}>
                {item.text}
              </Text>
            ) : null}
            {item.gifSlug && api ? (
              <GifView
                api={api}
                slug={item.gifSlug}
                visible={seen.has(item.id)}
                auto={autoGifs}
              />
            ) : null}
            {item.attachments?.map(a => (
              <Text key={a.id} style={styles.attachment}>
                {attachmentLabel(a)}
              </Text>
            ))}
            {item.text || item.gifSlug || item.attachments?.length ? null : (
              <Text style={styles.unreadable}>Empty message</Text>
            )}
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          accessibilityLabel="Message"
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.textMuted}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={sending || loading || !draft.trim()}
          onPress={send}
          style={styles.send}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 56 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { color: colors.accent, fontSize: 16, marginRight: 12 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
  note: { color: colors.textMuted, padding: 16, fontSize: 15 },
  error: { color: colors.danger, paddingHorizontal: 16, paddingTop: 8 },
  list: { flex: 1 },
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '80%',
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.bgSecondary,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.bgActive },
  sender: { color: colors.accent, fontSize: 12, marginBottom: 2 },
  text: { color: colors.text, fontSize: 16 },
  unreadable: { color: colors.textMuted, fontSize: 15, fontStyle: 'italic' },
  attachment: { color: colors.textMuted, fontSize: 15 },
  gif: { borderRadius: 8, marginTop: 2 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    paddingBottom: 28,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgSecondary,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.bgPrimary,
  },
  send: { paddingHorizontal: 14, paddingVertical: 10 },
  sendText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
});
