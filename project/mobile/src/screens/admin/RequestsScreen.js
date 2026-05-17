import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { api } from '../../services/api';
import { Card, StatusBadge, EmptyState } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function AdminRequestsScreen() {
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/equipment/requests/all');
      setRequests(data.requests || data || []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const renderItem = ({ item: r }) => (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={fonts.h3} numberOfLines={1}>{r.project_name || 'Project'}</Text>
        <StatusBadge status={r.status} />
      </View>
      <Text style={fonts.small}>PM: {r.requester_name || '—'}</Text>
      <Text style={fonts.small}>Foreman: {r.foreman_name || '—'}</Text>
      <Text style={fonts.tiny}>{r.line_count || 0} items • {r.created_at?.split('T')[0]}</Text>
    </Card>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={requests}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={<EmptyState message="No equipment requests" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
