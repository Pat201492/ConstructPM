import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, StyleSheet, Alert } from 'react-native';
import { api } from '../../services/api';
import { Card, Button, Input, SearchDropdown, StatusBadge, EmptyState } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function PMRequestsScreen() {
  const [requests, setRequests] = useState([]);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const d = await api('/equipment/requests/mine'); setRequests(d.requests || d || []); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (creating) return <CreateRequest onDone={() => { setCreating(false); load(); }} />;

  return (
    <View style={styles.container}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Button title="+ New Equipment Request" onPress={() => setCreating(true)} />
      </View>
      <FlatList
        data={requests}
        keyExtractor={i => i.id}
        renderItem={({ item: r }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={fonts.h3}>{r.project_name || 'Project'}</Text>
              <StatusBadge status={r.status} />
            </View>
            <Text style={fonts.small}>{r.line_count || 0} items • {r.created_at?.split('T')[0]}</Text>
          </Card>
        )}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListEmptyComponent={<EmptyState message="No equipment requests yet" />}
      />
    </View>
  );
}

function CreateRequest({ onDone }) {
  const [projects, setProjects] = useState([]);
  const [foremen, setForemen] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [foremanId, setForemanId] = useState(null);
  const [items, setItems] = useState([{ description: '', quantity: 1 }]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try { const d = await api('/projects?status=active&limit=100'); setProjects((d.projects || []).map(p => ({ value: p.id, label: p.name }))); } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const d = await api(`/projects/${projectId}/team`);
        const team = (d.assignments || []).filter(a => a.role === 'field_staff').map(a => ({ value: a.user_id, label: `${a.first_name} ${a.last_name}` }));
        setForemen(team);
      } catch {}
    })();
  }, [projectId]);

  const addItem = () => setItems([...items, { description: '', quantity: 1 }]);
  const removeItem = (i) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i, field, val) => { const n = [...items]; n[i][field] = val; setItems(n); };

  const submit = async () => {
    if (!projectId) return Alert.alert('Error', 'Select a project');
    const validItems = items.filter(i => i.description.trim());
    if (validItems.length === 0) return Alert.alert('Error', 'Add at least one item');
    setLoading(true);
    try {
      await api('/equipment/requests', { method: 'POST', body: JSON.stringify({
        project_id: projectId,
        assigned_foreman_id: foremanId || null,
        items: validItems.map(i => ({ item_description: i.description, quantity: parseInt(i.quantity) || 1 })),
      }) });
      Alert.alert('Success', 'Equipment request created');
      onDone();
    } catch (e) { Alert.alert('Error', e.message); }
    setLoading(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={fonts.h2}>New Equipment Request</Text>
      <SearchDropdown label="Project" items={projects} value={projectId} onChange={setProjectId} placeholder="Select project..." />
      {foremen.length > 0 && <SearchDropdown label="Assigned Foreman" items={foremen} value={foremanId} onChange={setForemanId} placeholder="Optional..." />}

      <Text style={[fonts.h3, { marginBottom: spacing.sm }]}>Items</Text>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          <Input label="" value={item.description} onChangeText={v => updateItem(i, 'description', v)} placeholder="Item description" style={{ flex: 1, marginBottom: 0 }} />
          <Input label="" value={String(item.quantity)} onChangeText={v => updateItem(i, 'quantity', v)} keyboardType="numeric" style={{ width: 60, marginBottom: 0 }} />
          {items.length > 1 && <Button title="×" variant="outline" onPress={() => removeItem(i)} style={{ paddingHorizontal: 10 }} />}
        </View>
      ))}
      <Button title="+ Add Item" variant="outline" onPress={addItem} style={{ marginBottom: spacing.lg }} />

      <Button title="Submit Request" onPress={submit} loading={loading} />
      <Button title="Cancel" variant="outline" onPress={onDone} style={{ marginTop: spacing.sm }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
