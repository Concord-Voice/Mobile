import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DmSummary } from '../core/ConcordApi';
import { describeError, useSession } from '../state/session';
import { colors } from './theme';

const TABS = ['Messages', 'Servers', 'Alerts', 'You'] as const;
type Tab = (typeof TABS)[number];

function Messages() {
  const api = useSession(s => s.api);
  const [dms, setDms] = useState<DmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      ?.conversations()
      .then(list => live && setDms(list))
      .catch(e => live && setError(describeError(e)));
    return () => {
      live = false;
    };
  }, [api]);
  if (error) return <Text style={styles.note}>{error}</Text>;
  if (!dms) return <Text style={styles.note}>Loading conversations…</Text>;
  if (dms.length === 0)
    return <Text style={styles.note}>No conversations yet.</Text>;
  return (
    <FlatList
      data={dms}
      keyExtractor={d => d.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {item.unreadCount > 0 ? (
            <Text style={styles.badge}>{item.unreadCount}</Text>
          ) : null}
        </View>
      )}
    />
  );
}

function You() {
  const signOut = useSession(s => s.signOut);
  return (
    <View style={styles.pane}>
      <Pressable
        accessibilityRole="button"
        style={styles.signOut}
        onPress={signOut}
      >
        <Text style={styles.signOutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

export function Home() {
  const [tab, setTab] = useState<Tab>('Messages');
  return (
    <View style={styles.screen}>
      <Text style={styles.header}>{tab}</Text>
      <View style={styles.pane}>
        {tab === 'Messages' ? <Messages /> : null}
        {tab === 'You' ? <You /> : null}
        {tab === 'Servers' || tab === 'Alerts' ? (
          <Text style={styles.note}>Coming next.</Text>
        ) : null}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map(t => (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: t === tab }}
            style={styles.tab}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, t === tab && styles.tabActive]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgPrimary, paddingTop: 56 },
  header: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  pane: { flex: 1 },
  note: { color: colors.textMuted, padding: 16, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { flex: 1, color: colors.text, fontSize: 16 },
  badge: {
    color: colors.bgPrimary,
    backgroundColor: colors.accent,
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 7,
    fontSize: 12,
    fontWeight: '700',
  },
  tabs: {
    flexDirection: 'row',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgSecondary,
    paddingBottom: 24,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: colors.textMuted, fontSize: 13 },
  tabActive: { color: colors.accent, fontWeight: '700' },
  signOut: {
    margin: 16,
    padding: 14,
    borderRadius: 10,
    borderColor: colors.danger,
    borderWidth: 1,
    alignItems: 'center',
  },
  signOutText: { color: colors.danger, fontSize: 16 },
});
