import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { JSX } from 'react';
import { useAuth, type Session } from '../src/auth';

export default function Home() {
  const { session } = useAuth();
  return (
    <View testID="home" style={styles.screen}>
      {content(session)}
    </View>
  );
}

function content(session: Session): JSX.Element {
  switch (session.status) {
    case 'signed-out':
    case 'signing-in':
      return <SignedOut />;
    case 'signed-in':
      return <SignedIn name={session.user.name} />;
  }
}

function SignedOut() {
  const router = useRouter();
  return (
    <>
      <Text style={styles.heading}>Welcome</Text>
      <Pressable
        testID="sign-in-link"
        accessibilityRole="button"
        style={styles.button}
        onPress={() => router.push('/login')}
      >
        <Text style={styles.buttonLabel}>Sign in</Text>
      </Pressable>
    </>
  );
}

function SignedIn({ name }: { name: string }) {
  const router = useRouter();
  return (
    <>
      <Text testID="greeting" style={styles.heading}>{`Hi, ${name}`}</Text>
      <Pressable
        testID="profile-link"
        accessibilityRole="button"
        style={styles.button}
        onPress={() => router.push('/profile')}
      >
        <Text style={styles.buttonLabel}>Profile</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 },
  heading: { fontSize: 28, fontWeight: '600' },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
