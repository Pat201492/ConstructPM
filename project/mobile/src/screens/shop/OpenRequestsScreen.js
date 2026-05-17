import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../../services/api';
import { Card, Button, StatusBadge, EmptyState } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function OpenRequestsScreen() {
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(null); // { requestId, lineId }
  const [permission, requestPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    try { const d = await api('/equipment/requests/open'); setRequests(d.requests || d || []); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const onBarcodeScanned = async ({ data }) => {
    if (!scanning) return;
    setScanning(null);
    try {
      // Look up equipment by barcode
      const eq = await api(`/equipment/barcode/${data}`);
      if (!eq) return Alert.alert('Not Found', `No equipment with barcode ${data}`);

      // Assign to the line item
      await api(`/equipment/requests/${scanning.requestId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ line_id: scanning.lineId, equipment_id: eq.id }),
      });
      Alert.alert('Assigned', `${eq.equipment_name} assigned to line item`);
      load();
    } catch (e) { Alert.alert('Error', e.message); }
  };

  if (scanning) {
    if (!permission?.granted) {
      return (
        <View style={[styles.container, { justifyContent: 'center', padding: spacing.lg }]}>
          <Text style={[fonts.body, { textAlign: 'center', marginBottom: spacing.md }]}>Camera permission needed for barcode scanning</Text>
          <Button title="Grant Permission" onPress={requestPermission} />
          <Button title="Cancel" variant="outline" onPress={() => setScanning(null)} style={{ marginTop: spacing.sm }} />
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }} onBarcodeScanned={onBarcodeScanned} />
        <View style={{ padding: spacing.md }}>
          <Text style={[fonts.body, { textAlign: 'center', marginBottom: spacing.sm }]}>Scan equipment barcode</Text>
          <Button title="Cancel" variant="outline" onPress={() => setScanning(null)} />
        </View>
      </View>
    );
  }

  const renderItem = ({ item: r }) => (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={fonts.h3}>{r.project_name || 'Project'}</Text>
        <StatusBadge status={r.status} />
      </View>
      <Text style={fonts.small}>Requested by: {r.requester_name || '—'}</Text>
      {(r.lines || []).map((line, i) => (
        <View key={line.id || i} style={styles.lineRow}>
          <View style={{ flex: 1 }}>
            <Text style={fonts.body}>{line.item_description} ×{line.quantity}</Text>
            {line.assigned_name && <Text style={[fonts.tiny, { color: colors.green }]}>Assigned: {line.assigned_name}</Text>}
          </View>
          {!line.assigned_equipment_id && (
            <Button title="Scan" onPress={() => setScanning({ requestId: r.id, lineId: line.id })} style={{ paddingHorizontal: 12, paddingVertical: 6 }} />
          )}
        </View>
      ))}
      {r.status !== 'filled' && (r.lines || []).every(l => l.assigned_equipment_id) && (
        <Button title="Mark Filled" onPress={async () => {
          try { await api(`/equipment/requests/${r.id}/fill`, { method: 'POST' }); load(); } catch (e) { Alert.alert('Error', e.message); }
        }} style={{ marginTop: spacing.sm }} />
      )}
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
        ListEmptyComponent={<EmptyState message="No open requests" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6 },
});
