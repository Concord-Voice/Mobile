import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { DmSummary } from '../core/ConcordApi';
import { Conversation } from '../state/conversation';
import { describeError, useSession } from '../state/session';
import { colors } from './theme';

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

  useEffect(() => {
    if (!conversation) return;
    conversation.onChange = refresh;
    conversation
      .start()
      .catch(e => setError(describeError(e)))
      .finally(() => setLoading(false));
    return () => conversation.close();
  }, [conversation]);

  const send = async () => {
    const text = draft.trim();
    if (!conversation || !text) return;
    setSending(true);
    setError(null);
    // Cleared now, so edits made while sending are kept; restored if the send fails.
    setDraft('');
    try {
      await conversation.send(text);
    } catch (e) {
      setDraft(current => current || text);
      setError(describeError(e));
    } finally {
      setSending(false);
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
            <Text style={item.unreadable ? styles.unreadable : styles.text}>
              {item.text}
            </Text>
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
