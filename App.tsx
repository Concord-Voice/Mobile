/**
 * Concord Voice mobile client (#206). Screens follow the internal design prototype's
 * Concord dark scheme; the app is dark-only until the other schemes land.
 */
import { StatusBar } from 'react-native';
import { useSession } from './src/state/session';
import { Home } from './src/ui/Home';
import { MfaCode, SignIn } from './src/ui/SignIn';

export default function App() {
  const stage = useSession(s => s.stage);
  return (
    <>
      <StatusBar barStyle="light-content" />
      {stage.kind === 'signed_in' ? <Home /> : null}
      {stage.kind === 'mfa' ? <MfaCode methods={stage.methods} /> : null}
      {stage.kind === 'signed_out' ? <SignIn /> : null}
    </>
  );
}
