import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../services/api';
import { StatusBadge, EmptyState } from '../../components/UI';
import { colors, fonts, spacing, card } from '../../theme';

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/notifications?limit=50');
      setNotifications(data.notifications || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const markRead = async (id) => {
    try { await api(`/notifications/${id}/read`, { method: 'PATCH' }); load(); } catch {}
  };

  const renderItem = ({ item: n }) => {
    const isActionable = n.category === 'actionable';
    return (
      <TouchableOpacity style={[card, { marginBottom: spacing.sm, borderLeftWidth: 3, borderLeftColor: isActionable ? colors.yellow : colors.text3 }, !n.read && { backgroundColor: colors.bg3 }]}
        onPress={() => !n.read && markRead(n.id)}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={[fonts.h3, { flex: 1 }]} numberOfLines={1}>{n.title}</Text>
          {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 4 }} />}
        </View>
        <Text style={fonts.small} numberOfLines={2}>{n.body}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={fonts.tiny}>{n.created_at?.split('T')[0]}</Text>
          <StatusBadge status={isActionable ? 'pending' : 'completed'} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={notifications}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={<EmptyState message="No notifications" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
});
