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
const gifLookups = new WeakMap<ConcordApi, Map<string, Promise<Gif | null>>>();

function lookupGif(api: ConcordApi, slug: string): Promise<Gif | null> {
  let lookups = gifLookups.get(api);
  if (!lookups) gifLookups.set(api, (lookups = new Map()));
  let lookup = lookups.get(slug);
  if (!lookup) {
    lookup = api.gif(slug);
    lookups.set(slug, lookup);
    // A failed lookup is forgotten, so the next view of the message retries it.
    lookup.catch(() => lookups.delete(slug));
  }
  return lookup;
}

/** Fits a GIF inside 240 x 320 points, keeping its shape. */
function fit(width = 0, height = 0) {
  const [w, h] = width > 0 && height > 0 ? [width, height] : [200, 150];
  const scale = Math.min(1, 240 / w, 320 / h);
  return { width: w * scale, height: h * scale };
}

/** A GIF message, loaded through Concord's proxy. Shows "GIF" while loading or if it fails. */
function GifView({ api, slug }: { api: ConcordApi; slug: string }) {
  const [source, setSource] = useState<
    (Gif & { headers: Record<string, string> }) | null
  >(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    // Headers are read per view: they carry the current access token.
    Promise.all([lookupGif(api, slug), api.headers()]).then(
      ([gif, headers]) => {
        if (!live) return;
        if (gif) setSource({ ...gif, headers });
        else setFailed(true);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api, slug]);
  if (failed || !source) return <Text style={styles.attachment}>GIF</Text>;
  return (
    <Image
      accessibilityLabel="GIF"
      source={{ uri: source.uri, headers: source.headers }}
      style={[styles.gif, fit(source.width, source.height)]}
      onError={() => setFailed(true)}
    />
  );
}

const KINDS: Record<string, string> = {
  photo: 'Photo',
  animated: 'Animated image',
  video: 'Video',
  audio: 'Audio',
};

/** "Photo, 2.0 KB": attachments are named until the app can decrypt and show them. */
function attachmentLabel({ fileType, fileSize }: Attachment): string {
  const size =
    fileSize < 1024
      ? `${fileSize} B`
      : fileSize < 1024 * 1024
      ? `${(fileSize / 1024).toFixed(1)} KB`
      : `${(fileSize / 1024 / 1024).toFixed(1)} MB`;
  return `${KINDS[fileType] ?? 'File'}, ${size}`;
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

  const lines = conversation?.lines ?? [];
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
              <GifView api={api} slug={item.gifSlug} />
            ) : null}
            {item.attachments?.map((a, i) => (
              <Text key={i} style={styles.attachment}>
                {attachmentLabel(a)}
              </Text>
            ))}
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
