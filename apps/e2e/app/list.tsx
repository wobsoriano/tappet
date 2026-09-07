import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const ROWS = Array.from({ length: 40 }, (_, index) => index + 1);

export default function List() {
  const router = useRouter();
  return (
    <View testID="list-screen" style={styles.screen}>
      <ScrollView testID="list" contentContainerStyle={styles.content}>
        {ROWS.map((row) => (
          <Text key={row} testID={`row-${String(row)}`} style={styles.row}>
            {`Row ${String(row)}`}
          </Text>
        ))}
        <Pressable
          testID="list-done"
          accessibilityRole="button"
          style={styles.button}
          onPress={() => router.replace('/')}
        >
          <Text style={styles.buttonLabel}>Done</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 64 },
  content: { gap: 12, padding: 24 },
  row: { fontSize: 20 },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonLabel: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
