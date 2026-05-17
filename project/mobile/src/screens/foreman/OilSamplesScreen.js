import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, ScrollView, RefreshControl, StyleSheet, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, uploadFile } from '../../services/api';
import { Card, Button, Input, ProjectRefField, StatusBadge, EmptyState } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function OilSamplesScreen() {
  const [samples, setSamples] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState(null); // extraction result to verify

  const load = useCallback(async () => {
    try { const d = await api('/oil-samples'); setSamples(d.samples || []); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (verifying) return <VerifyExtraction data={verifying} onDone={() => { setVerifying(null); load(); }} />;
  if (creating) return <NewSample onResult={(r) => { setCreating(false); setVerifying(r); }} onCancel={() => setCreating(false)} />;

  return (
    <View style={styles.container}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <Button title="+ New Oil Sample" onPress={() => setCreating(true)} />
      </View>
      <FlatList
        data={samples}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        renderItem={({ item: s }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={fonts.h3}>{s.equipment_id_field || 'Unknown Equipment'}</Text>
              <StatusBadge status={s.status} />
            </View>
            <Text style={fonts.small}>{s.project_name || '—'} • {s.sample_date || '—'}</Text>
            <Text style={fonts.tiny}>{s.equipment_location || '—'}</Text>
          </Card>
        )}
        ListEmptyComponent={<EmptyState message="No oil samples submitted" />}
      />
    </View>
  );
}

function NewSample({ onResult, onCancel }) {
  const [recentItems, setRecentItems] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [photoUri, setPhotoUri] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const recent = await api('/projects/recent?limit=5');
        const fmt = p => ({
          value: p.id,
          label: p.name,
          customer: p.customer_name,
          project_numbers: p.project_numbers || [],
        });
        setRecentItems((recent.projects || []).map(fmt));
      } catch {}
    })();
  }, []);

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Permission needed', 'Camera access required');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: false });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const submit = async () => {
    if (!projectId) return Alert.alert('Error', 'Select a project');
    if (!photoUri) return Alert.alert('Error', 'Take or select a photo');
    setLoading(true);
    try {
      const data = await uploadFile('/oil-samples/upload', photoUri, 'photo', { project_id: projectId });
      onResult(data);
    } catch (e) { Alert.alert('Error', e.message); }
    setLoading(false);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={[fonts.h2, { marginBottom: spacing.md }]}>New Oil Sample</Text>
      <ProjectRefField label="Project" recentItems={recentItems} value={projectId} onChange={setProjectId} />

      <Text style={[fonts.small, { marginBottom: spacing.sm }]}>Photo of filled form</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Button title="Take Photo" onPress={takePhoto} style={{ flex: 1 }} />
        <Button title="Choose Photo" variant="outline" onPress={pickPhoto} style={{ flex: 1 }} />
      </View>

      {photoUri && <Image source={{ uri: photoUri }} style={{ width: '100%', height: 250, borderRadius: 8, marginBottom: spacing.md }} resizeMode="contain" />}

      <Button title={loading ? 'Uploading & Analyzing...' : 'Upload & Extract'} onPress={submit} loading={loading} disabled={!projectId || !photoUri} />
      <Button title="Cancel" variant="outline" onPress={onCancel} style={{ marginTop: spacing.sm }} />
    </ScrollView>
  );
}

function VerifyExtraction({ data, onDone }) {
  const extraction = data.extraction || {};
  const fields = extraction.fields || {};
  const confidence = extraction.confidence || {};
  const sample = data.sample || {};
  const [edits, setEdits] = useState({ ...fields });

  const updateField = (key, val) => setEdits({ ...edits, [key]: val });

  const confirm = async () => {
    try {
      await api(`/oil-samples/${sample.id}/confirm-data`, {
        method: 'POST',
        body: JSON.stringify({
          extracted_fields: edits,
          equipment_id_field: edits.equipment_id || edits.equipment_id_field || null,
          equipment_location: edits.equipment_location || null,
          sample_date: edits.sample_date || null,
          sample_type: edits.sample_type || null,
          condition_notes: edits.condition_notes || null,
        }),
      });
      Alert.alert('Confirmed', 'Oil sample data saved. Pending physical return.');
      onDone();
    } catch (e) { Alert.alert('Error', e.message); }
  };

  const confColor = (v) => {
    if (typeof v !== 'number') return colors.text3;
    return v >= 0.7 ? colors.green : v >= 0.4 ? colors.yellow : colors.red;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={[fonts.h2, { marginBottom: 4 }]}>Verify Extracted Data</Text>
      <Text style={[fonts.small, { marginBottom: spacing.md }]}>
        {extraction.method === 'llava' ? 'Llava' : extraction.method === 'claude_vision' ? 'Claude Vision' : extraction.method || 'AI'} •{' '}
        {extraction.processing_time_ms ? `${(extraction.processing_time_ms / 1000).toFixed(1)}s` : '—'} •{' '}
        {extraction.overall_confidence ? `${(extraction.overall_confidence * 100).toFixed(0)}% confidence` : ''}
      </Text>

      {Object.entries(edits).map(([key, val]) => (
        <View key={key} style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
            <Text style={[fonts.small, { flex: 1 }]}>{key.replace(/_/g, ' ')}</Text>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: confColor(confidence[key]) }} />
          </View>
          {typeof val === 'boolean' ? (
            <Button title={val ? '✓ Yes' : '✗ No'} variant={val ? 'primary' : 'outline'}
              onPress={() => updateField(key, !val)} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <Input value={String(val ?? '')} onChangeText={v => updateField(key, v)} style={{ marginBottom: 0 }} />
          )}
        </View>
      ))}

      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <Button title="Confirm — Data is Correct" onPress={confirm} />
        <Button title="Back" variant="outline" onPress={onDone} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
