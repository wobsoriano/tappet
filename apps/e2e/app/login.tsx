import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../src/auth";

export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);

  function submit() {
    const result = signIn(email, password);
    if (result.ok) {
      setFailed(false);
      router.replace("/profile");
      return;
    }
    switch (result.reason) {
      case "invalid-credentials":
        setFailed(true);
        return;
    }
  }

  // The password field is not secureTextEntry and both fields opt out of AutoFill.
  // iOS reads a secure field next to an email field as a real credential and covers
  // the next screen with a "Save Password?" system alert once sign-in succeeds.
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
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        testID="password"
        accessibilityLabel="Password"
        style={styles.input}
        placeholder="Password"
        textContentType="none"
        value={password}
        onChangeText={setPassword}
      />
      {failed ? (
        <Text testID="error" style={styles.error}>
          Wrong email or password
        </Text>
      ) : null}
      <Pressable testID="sign-in" accessibilityRole="button" style={styles.button} onPress={submit}>
        <Text style={styles.buttonLabel}>Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", gap: 16, padding: 24 },
  heading: { fontSize: 28, fontWeight: "600" },
  input: { borderColor: "#d0d7de", borderRadius: 8, borderWidth: 1, fontSize: 16, padding: 12 },
  error: { color: "#cf222e", fontSize: 15 },
  button: {
    alignItems: "center",
    backgroundColor: "#1f6feb",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonLabel: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
