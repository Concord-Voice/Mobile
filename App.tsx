/**
 * Concord Voice mobile client (#206). Screens follow the internal design prototype's
 * Concord dark scheme; the app is dark-only until the other schemes land.
 */
import { useEffect } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { useSession } from './src/state/session';
import { Home } from './src/ui/Home';
import { MfaCode, SignIn } from './src/ui/SignIn';
import { colors } from './src/ui/theme';

export default function App() {
  const stage = useSession(s => s.stage);
  const restore = useSession(s => s.restore);
  useEffect(() => {
    restore();
  }, [restore]);
  return (
    <>
      <StatusBar barStyle="light-content" />
      {stage.kind === 'starting' ? <View style={styles.starting} /> : null}
      {stage.kind === 'signed_in' ? <Home /> : null}
      {stage.kind === 'mfa' ? <MfaCode methods={stage.methods} /> : null}
      {stage.kind === 'signed_out' ? <SignIn /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  starting: { flex: 1, backgroundColor: colors.bgPrimary },
});
