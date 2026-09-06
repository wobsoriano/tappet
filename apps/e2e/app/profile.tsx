import { Redirect, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/auth";

export default function Profile() {
  const { session, signOut } = useAuth();
  const router = useRouter();

  switch (session.status) {
    case "signed-out":
      return <Redirect href="/login" />;
    case "signed-in":
      return (
        <View testID="profile" style={styles.screen}>
          <Text testID="profile-name" style={styles.heading}>
            {session.user.name}
          </Text>
          <Text testID="profile-email" style={styles.email}>
            {session.user.email}
          </Text>
          <Pressable
            testID="sign-out"
            accessibilityRole="button"
            style={styles.button}
            onPress={() => {
              signOut();
              router.replace("/");
            }}
          >
            <Text style={styles.buttonLabel}>Sign out</Text>
          </Pressable>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  heading: { fontSize: 28, fontWeight: "600" },
  email: { color: "#57606a", fontSize: 16 },
  button: {
    backgroundColor: "#1f6feb",
    borderRadius: 8,
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonLabel: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
