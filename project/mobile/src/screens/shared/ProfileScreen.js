import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { Button, Card } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const role = (user?.role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Card style={{ alignItems: 'center', marginBottom: spacing.lg }}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.first_name?.[0] || '') + (user?.last_name?.[0] || '')}
          </Text>
        </View>
        <Text style={fonts.h2}>{user?.first_name} {user?.last_name}</Text>
        <Text style={[fonts.small, { marginTop: 4 }]}>{role}</Text>
        <Text style={[fonts.tiny, { marginTop: 2 }]}>{user?.email}</Text>
      </Card>

      <Button title="Sign Out" variant="outline" onPress={logout} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm,
  },
  avatarText: { color: colors.white, fontSize: 22, fontWeight: '700' },
});
