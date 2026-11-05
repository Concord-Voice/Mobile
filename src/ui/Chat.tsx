import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListViewToken,
} from 'react-native';
import { nativeErrorCode, shareAttachment } from '../ConcordCrypto';
import type {
  Attachment,
  ConcordApi,
  DmSummary,
  Gif,
} from '../core/ConcordApi';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

type Source = {
  uri: string;
  headers?: Record<string, string>;
  width?: number;
  height?: number;
};

/**
 * An inline image: a GIF message, a photo or an animated attachment. It fetches once it is
 * on screen (`active`), and not before a tap while it shows a `prompt`. Until then, or if it
 * fails, it shows `label`.
 */
function InlineImage({
  label,
  prompt,
  active,
  open,
  frame,
}: Readonly<{
  label: string;
  prompt: string | null;
  active: boolean;
  open: () => Promise<Source | null>;
  /** A size to hold while loading, so the list does not jump. */
  frame?: { width?: number; height?: number };
}>) {
  const [tapped, setTapped] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<{ width: number; height: number }>();
  const waiting = prompt !== null && !tapped;
  const load = active && !waiting;
  useEffect(() => {
    setSource(null);
    setFailed(false);
    if (!load) return;
    let live = true;
    open().then(
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
  }, [open, load]);
  if (waiting)
    return (
      <Pressable accessibilityRole="button" onPress={() => setTapped(true)}>
        <Text style={styles.attachment}>{prompt}</Text>
      </Pressable>
    );
  if (failed || (!source && !frame))
    return <Text style={styles.attachment}>{label}</Text>;
  if (!source)
    return <View style={[styles.gif, fit(frame?.width, frame?.height)]} />;
  const shape = source.width && source.height ? source : loaded;
  return (
    <Image
      accessibilityLabel={label}
      source={{ uri: source.uri, headers: source.headers }}
      style={[styles.gif, fit(shape?.width, shape?.height)]}
      onLoad={e => {
        const { width, height } = e.nativeEvent.source ?? {};
        if (width > 0 && height > 0) setLoaded({ width, height });
      }}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The tap an animated image waits for, as on desktop: when the user turned automatic GIF
 * loading off, or the phone asks for reduced motion. Null while the setting is unknown.
 */
function gifPrompt(auto: boolean | null, still: boolean): string | null {
  if (auto === false) return 'Tap to load GIF';
  return still ? 'Tap to play GIF' : null;
}

/** A GIF message, through Concord's proxy. */
function GifView({
  api,
  slug,
  visible,
  auto,
  still,
}: Readonly<{
  api: ConcordApi;
  slug: string;
  visible: boolean;
  auto: boolean | null;
  still: boolean;
}>) {
  // Headers are read after the lookup, so they carry a current access token.
  const open = useCallback(
    () =>
      lookupGif(api, slug).promise.then(gif =>
        gif
          ? api.mediaSource(gif.uri).then(media => ({ ...gif, ...media }))
          : null,
      ),
    [api, slug],
  );
  return (
    <InlineImage
      label="GIF"
      prompt={gifPrompt(auto, still)}
      active={visible && auto !== null}
      open={open}
      // A GIF seen before keeps its size while it reloads.
      frame={gifLookups.get(api)?.get(slug)?.gif ?? undefined}
    />
  );
}

const MIB = 1024 * 1024;
/** Photos and animated images up to this load on their own (the policy's mobile limit). */
const AUTO_LIMIT = 64 * MIB;
/** The largest file the phone downloads at all, on a tap. */
const OPEN_LIMIT = 256 * MIB;
/** Ciphertext overhead above the plaintext size: a header and 28 bytes per 8 MiB chunk. */
const OVERHEAD = 4096;

type OpenFile = (a: Attachment, limit: number) => Promise<string>;

/** What a failed open tells the user, by the native failure code. */
function openError(error: unknown): string {
  switch (nativeErrorCode(error)) {
    case 'E_CONCORD_CRYPTO_AUTHENTICATIONFAILED':
      return "Can't open: the file is damaged or was changed";
    case 'E_CONCORD_CRYPTO_UNSUPPORTEDFORMAT':
      return 'Update the app to open this file';
    case 'E_CONCORD_CRYPTO_TOOLARGE':
      return 'Too large to open on this phone';
    default:
      return "Couldn't open. Tap to try again";
  }
}

/**
 * An attachment, by Mark's display policy: photos and animated images show inline (up to
 * 64 MiB, animated ones by the GIF rules); anything else is a card that downloads only when
 * tapped, then opens the share sheet.
 */
function AttachmentView({
  attachment,
  openFile,
  visible,
  auto,
  still,
}: Readonly<{
  attachment: Attachment;
  openFile: OpenFile;
  visible: boolean;
  auto: boolean | null;
  still: boolean;
}>) {
  const { fileType, fileSize } = attachment;
  const label = attachmentLabel(attachment);
  // A file sent as small is held to that: the auto-load cap applies to the actual bytes.
  const open = useCallback(
    () =>
      openFile(
        attachment,
        (attachment.fileSize > AUTO_LIMIT ? OPEN_LIMIT : AUTO_LIMIT) + OVERHEAD,
      ).then(uri => ({ uri })),
    [openFile, attachment],
  );
  if (fileType === 'photo' || fileType === 'animated') {
    const animated = fileType === 'animated';
    let prompt: string | null = null;
    if (fileSize > AUTO_LIMIT) prompt = `${label}, tap to load`;
    else if (animated) prompt = gifPrompt(auto, still);
    return (
      <InlineImage
        label={label}
        prompt={prompt}
        active={visible && (!animated || auto !== null)}
        open={open}
      />
    );
  }
  return <FileCard attachment={attachment} openFile={openFile} />;
}

/** A file that waits for a tap, then downloads, decrypts and opens the share sheet. */
function FileCard({
  attachment,
  openFile,
}: Readonly<{ attachment: Attachment; openFile: OpenFile }>) {
  const [state, setState] = useState<string | null>(null);
  const tooLarge = attachment.fileSize > OPEN_LIMIT;
  const press = async () => {
    setState('Opening…');
    try {
      const uri = await openFile(attachment, OPEN_LIMIT + OVERHEAD);
      if (Platform.OS === 'ios') await Share.share({ url: uri });
      else await shareAttachment(uri, attachment.mimeType);
      setState(null);
    } catch (error) {
      setState(openError(error));
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      disabled={tooLarge || state === 'Opening…'}
      onPress={press}
    >
      <Text style={styles.attachment}>{attachmentLabel(attachment)}</Text>
      <Text style={styles.hint}>
        {tooLarge ? 'Too large to open on this phone' : state ?? 'Tap to open'}
      </Text>
    </Pressable>
  );
}

const KINDS = new Map([
  ['photo', 'Photo'],
  ['animated', 'Animated image'],
  ['video', 'Video'],
  ['audio', 'Audio'],
]);

/** "Photo, 2.0 KB": what the attachment is, before anything is downloaded. */
function attachmentLabel({ fileType, fileSize }: Attachment): string {
  const kind = KINDS.get(fileType) ?? 'File';
  if (fileSize < 1024) return `${kind}, ${fileSize} B`;
  if (fileSize < 1024 * 1024)
    return `${kind}, ${(fileSize / 1024).toFixed(1)} KB`;
  return `${kind}, ${(fileSize / 1024 / 1024).toFixed(1)} MB`;
}

// One attachment downloads at a time, each with fresh headers when its turn comes. An opened
// file is kept for the app run (its plaintext lives in the app cache until sign-out or the
// next launch), so scrolling back does not download it again.
let attachmentQueue: Promise<unknown> = Promise.resolve();
const openedFiles = new WeakMap<ConcordApi, Map<string, Promise<string>>>();

function openCached(
  api: ConcordApi,
  conversation: Pick<Conversation, 'openAttachment'>,
  a: Attachment,
  limit: number,
): Promise<string> {
  let opened = openedFiles.get(api);
  if (!opened) {
    opened = new Map();
    openedFiles.set(api, opened);
  }
  const known = opened.get(a.id);
  if (known) return known;
  const open = attachmentQueue.then(() =>
    conversation.openAttachment(a, limit),
  );
  attachmentQueue = open.catch(() => {});
  opened.set(a.id, open);
  // A failure is forgotten, so a tap tries again.
  open.catch(() => opened.delete(a.id));
  return open;
}

/** The phone's reduce-motion setting, live. */
function useReduceMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      on => {
        if (live) setStill(on);
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setStill,
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return still;
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
    | 'lines'
    | 'dropped'
    | 'onChange'
    | 'start'
    | 'send'
    | 'close'
    | 'openAttachment'
  >;
}) {
  const { api, identity, stage } = useSession();
  const insets = useSafeAreaInsets();
  // The keyboard already covers the bottom bar, so drop that inset while it is open.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    // iOS fires Will events in step with the avoiding view's animation; Android has only Did.
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(
      ios ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
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
  const still = useReduceMotion();
  const listState = useMemo(
    () => ({ seen, autoGifs, still }),
    [seen, autoGifs, still],
  );
  const openFile = useCallback<OpenFile>(
    (a, limit) =>
      api && conversation
        ? openCached(api, conversation, a, limit)
        : Promise.reject(new Error('Not signed in')),
    [api, conversation],
  );

  const lines = conversation?.lines ?? [];
  // Animated attachments follow the GIF setting too.
  const hasGifs = lines.some(
    l => l.gifSlug || l.attachments?.some(a => a.fileType === 'animated'),
  );

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
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { paddingTop: insets.top + 8 }]}
    >
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
                still={still}
              />
            ) : null}
            {item.attachments?.map(a => (
              <AttachmentView
                key={a.id}
                attachment={a}
                openFile={openFile}
                visible={seen.has(item.id)}
                auto={autoGifs}
                still={still}
              />
            ))}
            {item.text || item.gifSlug || item.attachments?.length ? null : (
              <Text style={styles.unreadable}>Empty message</Text>
            )}
          </View>
        )}
      />
      <View
        style={[
          styles.composer,
          { paddingBottom: (keyboardOpen ? 0 : insets.bottom) + 8 },
        ]}
      >
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
  screen: { flex: 1, backgroundColor: colors.bgPrimary },
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
  hint: { color: colors.accent, fontSize: 13, marginTop: 2 },
  gif: { borderRadius: 8, marginTop: 2 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
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
