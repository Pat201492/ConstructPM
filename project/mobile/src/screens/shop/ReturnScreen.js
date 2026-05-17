import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../../services/api';
import { Card, Button } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function ReturnScreen() {
  const [scanning, setScanning] = useState(false);
  const [equipment, setEquipment] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();

  const onScanned = async ({ data }) => {
    setScanning(false);
    try {
      const eq = await api(`/equipment/barcode/${data}`);
      setEquipment(eq);
    } catch (e) { Alert.alert('Not Found', e.message); }
  };

  const confirmReturn = async () => {
    try {
      await api(`/equipment/${equipment.id}/return`, { method: 'POST' });
      Alert.alert('Returned', `${equipment.equipment_name} marked as available.`);
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
          <Text style={[fonts.body, { textAlign: 'center', marginBottom: spacing.sm }]}>Scan equipment barcode to return</Text>
          <Button title="Cancel" variant="outline" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  if (equipment) {
    return (
      <View style={[styles.container, { padding: spacing.md }]}>
        <Card>
          <Text style={fonts.h2}>{equipment.equipment_name}</Text>
          <Text style={fonts.small}>Barcode: {equipment.barcode_id}</Text>
          <Text style={fonts.small}>Status: {equipment.status}</Text>
          {equipment.checked_out_to_project && <Text style={fonts.small}>Project: {equipment.project_name}</Text>}
        </Card>
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Button title="Confirm Return" onPress={confirmReturn} />
          <Button title="Scan Another" variant="outline" onPress={() => { setEquipment(null); setScanning(true); }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { justifyContent: 'center', padding: spacing.lg }]}>
      <Text style={[fonts.h2, { textAlign: 'center', marginBottom: spacing.lg }]}>Return Equipment</Text>
      <Button title="Scan Barcode" onPress={() => setScanning(true)} />
    </View>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
