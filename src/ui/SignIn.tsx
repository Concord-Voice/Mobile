import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MfaCodeMethod } from '../core/ConcordApi';
import { useSession } from '../state/session';
import { colors } from './theme';

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  keyboard?: 'email-address' | 'url' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure}
        keyboardType={props.keyboard}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

function Submit(props: {
  title: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const busy = useSession(s => s.busy);
  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.button, props.disabled && styles.buttonDisabled]}
      disabled={props.disabled || busy}
      onPress={props.onPress}
    >
      {busy ? (
        <ActivityIndicator color={colors.bgPrimary} />
      ) : (
        <Text style={styles.buttonText}>{props.title}</Text>
      )}
    </Pressable>
  );
}

function ErrorLine() {
  const error = useSession(s => s.error);
  return error ? <Text style={styles.error}>{error}</Text> : null;
}

export function SignIn() {
  const signIn = useSession(s => s.signIn);
  const [server, setServer] = useState('https://');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Concord Voice</Text>
      <Field
        label="Server"
        value={server}
        onChangeText={setServer}
        keyboard="url"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboard="email-address"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secure
      />
      <ErrorLine />
      <Submit
        title="Log in"
        disabled={!email || !password || server.length < 9}
        onPress={() => signIn(server, email, password)}
      />
    </View>
  );
}

const METHOD_LABELS: Record<MfaCodeMethod, string> = {
  totp: 'Authenticator code',
  email: 'Emailed code',
  backup_code: 'Backup code',
};

export function MfaCode({ methods }: { methods: string[] }) {
  const { verifyMfa, sendMfaEmail, signOut } = useSession();
  const usable = (Object.keys(METHOD_LABELS) as MfaCodeMethod[]).filter(m =>
    methods.includes(m),
  );
  const [method, setMethod] = useState<MfaCodeMethod | undefined>(usable[0]);
  const [code, setCode] = useState('');
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Two-step check</Text>
      {usable.length === 0 ? (
        <Text style={styles.body}>
          This account needs a passkey, which the app cannot use yet.
        </Text>
      ) : (
        <View style={styles.methods}>
          {usable.map(m => (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityState={{ selected: m === method }}
              style={[styles.chip, m === method && styles.chipActive]}
              onPress={() => setMethod(m)}
            >
              <Text style={styles.chipText}>{METHOD_LABELS[m]}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {method ? (
        <Field
          label={METHOD_LABELS[method]}
          value={code}
          onChangeText={setCode}
          keyboard={method === 'backup_code' ? undefined : 'number-pad'}
        />
      ) : null}
      {method === 'email' ? (
        <Pressable accessibilityRole="button" onPress={sendMfaEmail}>
          <Text style={styles.link}>Email me a code</Text>
        </Pressable>
      ) : null}
      <ErrorLine />
      <Submit
        title="Continue"
        disabled={!method || !code}
        onPress={() => method && verifyMfa(method, code)}
      />
      <Pressable accessibilityRole="button" onPress={signOut}>
        <Text style={styles.link}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 14,
    backgroundColor: colors.bgPrimary,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },
  body: { color: colors.textSecondary, fontSize: 15 },
  field: { gap: 6 },
  label: { color: colors.textSecondary, fontSize: 13 },
  input: {
    color: colors.text,
    backgroundColor: colors.bgSecondary,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.bgPrimary, fontSize: 16, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14 },
  link: { color: colors.accent, textAlign: 'center', padding: 8 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.bgActive, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
});
