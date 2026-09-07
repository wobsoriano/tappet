import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth';

export default function Login() {
  const { session, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [failed, setFailed] = useState(false);
  const pending = session.status === 'signing-in';

  async function submit() {
    setFailed(false);
    const result = await signIn(email, password);
    if (result.ok) {
      router.replace('/profile');
      return;
    }
    switch (result.reason) {
      case 'invalid-credentials':
        setFailed(true);
        return;
    }
  }

  // The password field is not secureTextEntry and both fields opt out of AutoFill.
  // iOS reads a secure field next to an email field as a real credential and covers
  // the next screen with a "Save Password?" system alert once sign-in succeeds.
  //
  // Neither field passes `value`. A controlled TextInput pushes the last rendered
  // string back into the native field, and on a slow CI runner that write lands
  // while the driver is still typing, truncating the text after the driver has
  // already read the full value back. Uncontrolled, the native field keeps every
  // keystroke and `onChangeText` delivers the final string.
  return (
    <View testID="login" style={styles.screen}>
      <Text style={styles.heading}>Sign in</Text>
      <TextInput
        testID="email"
        accessibilityLabel="Email"
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="none"
        onChangeText={setEmail}
      />
      <TextInput
        testID="password"
        accessibilityLabel="Password"
        style={styles.input}
        placeholder="Password"
        textContentType="none"
        onChangeText={setPassword}
      />
      {failed ? (
        <Text testID="error" style={styles.error}>
          Wrong email or password
        </Text>
      ) : null}
      {pending ? (
        <Text testID="signing-in" style={styles.pending}>
          Signing in...
        </Text>
      ) : null}
      <Pressable
        testID="sign-in"
        accessibilityRole="button"
        accessibilityState={{ disabled: pending }}
        disabled={pending}
        style={[styles.button, pending ? styles.buttonDisabled : null]}
        onPress={() => void submit()}
      >
        <Text style={styles.buttonLabel}>Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', gap: 16, padding: 24 },
  heading: { fontSize: 28, fontWeight: '600' },
  input: { borderColor: '#d0d7de', borderRadius: 8, borderWidth: 1, fontSize: 16, padding: 12 },
  error: { color: '#cf222e', fontSize: 15 },
  pending: { color: '#57606a', fontSize: 15 },
  button: {
    alignItems: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonDisabled: { backgroundColor: '#8fb8f5' },
  buttonLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
