import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../../services/api';
import { Card, Button } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function MaintenanceScreen() {
  const [scanning, setScanning] = useState(false);
  const [equipment, setEquipment] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();

  const onScanned = async ({ data }) => {
    setScanning(false);
    try { setEquipment(await api(`/equipment/barcode/${data}`)); } catch (e) { Alert.alert('Not Found', e.message); }
  };

  const flagStatus = async (status) => {
    try {
      await api(`/equipment/${equipment.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      Alert.alert('Updated', `${equipment.equipment_name} → ${status.replace(/_/g, ' ')}`);
      setEquipment(null);
    } catch (e) { Alert.alert('Error', e.message); }
  };

  if (scanning) {
    if (!permission?.granted) {
      return (
        <View style={[styles.container, { justifyContent: 'center', padding: spacing.lg }]}>
          <Button title="Grant Camera Permission" onPress={requestPermission} />
          <Button title="Cancel" variant="outline" onPress={() => setScanning(false)} style={{ marginTop: spacing.sm }} />
        </View>
      );
    }
    return (
      <View style={styles.container}>
        <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }} onBarcodeScanned={onScanned} />
        <View style={{ padding: spacing.md }}>
          <Button title="Cancel" variant="outline" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  if (equipment) {
    return (
      <View style={[styles.container, { padding: spacing.md }]}>
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={fonts.h2}>{equipment.equipment_name}</Text>
          <Text style={fonts.small}>Barcode: {equipment.barcode_id}</Text>
          <Text style={fonts.small}>Current: {(equipment.status || '').replace(/_/g, ' ')}</Text>
        </Card>
        <Text style={[fonts.h3, { marginBottom: spacing.sm }]}>Set Status:</Text>
        <View style={{ gap: spacing.sm }}>
          <Button title="Flag: Maintenance Required" onPress={() => flagStatus('maintenance_required')} style={{ backgroundColor: colors.yellow }} />
          <Button title="In Maintenance" onPress={() => flagStatus('in_maintenance')} style={{ backgroundColor: colors.red }} />
          <Button title="Back to Available" onPress={() => flagStatus('available')} style={{ backgroundColor: colors.green }} />
          <Button title="Retire" onPress={() => { Alert.alert('Confirm', 'Retire this equipment?', [
            { text: 'Cancel' }, { text: 'Retire', onPress: () => flagStatus('retired'), style: 'destructive' },
          ]); }} variant="outline" />
        </View>
        <Button title="Scan Another" variant="outline" onPress={() => { setEquipment(null); setScanning(true); }} style={{ marginTop: spacing.lg }} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { justifyContent: 'center', padding: spacing.lg }]}>
      <Text style={[fonts.h2, { textAlign: 'center', marginBottom: spacing.lg }]}>Equipment Maintenance</Text>
      <Button title="Scan Barcode" onPress={() => setScanning(true)} />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
