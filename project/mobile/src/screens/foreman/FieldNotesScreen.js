import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { api } from '../../services/api';
import { Card, Button, Input, ProjectRefField, EmptyState } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';

// Shared hook — fetches recent submissions for current user.
// Recent is exact: last 5 projects this user submitted to. No fallback.
// Drops the all-projects fetch — foremen now type project numbers directly.
function useRecentProjects() {
  const [recentItems, setRecentItems] = useState([]);

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

  return { recentItems };
}

export default function FieldNotesScreen() {
  const [tab, setTab] = useState('add');

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, tab === 'add' && styles.tabActive]} onPress={() => setTab('add')}>
          <Text style={[styles.tabText, tab === 'add' && styles.tabTextActive]}>Add Note</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'edit' && styles.tabActive]} onPress={() => setTab('edit')}>
          <Text style={[styles.tabText, tab === 'edit' && styles.tabTextActive]}>Edit Notes</Text>
        </TouchableOpacity>
      </View>
      {tab === 'add' ? <AddNote /> : <EditNotes />}
    </View>
  );
}

function AddNote() {
  const { recentItems } = useRecentProjects();
  const [projectId, setProjectId] = useState(null);
  const [noteDate, setNoteDate] = useState(new Date().toISOString().split('T')[0]);
  const [noteText, setNoteText] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!projectId) return Alert.alert('Error', 'Enter a valid project reference first');
    if (!noteText.trim()) return Alert.alert('Error', 'Enter note text');
    setLoading(true);
    try {
      // Capture the foreman's device timezone so the note shows the
      // author's local clock when read later, not the reader's clock.
      let timezone = null;
      try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
      await api('/field-notes', { method: 'POST', body: JSON.stringify({
        project_id: projectId, note_date: noteDate, note_text: noteText.trim(),
        timezone,
      }) });
      Alert.alert('Saved', 'Field note added');
      setNoteText('');
    } catch (e) { Alert.alert('Error', e.message); }
    setLoading(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md }}>
      <ProjectRefField label="Project" recentItems={recentItems} value={projectId} onChange={setProjectId} />
      <Input label="Date" value={noteDate} onChangeText={setNoteDate} placeholder="YYYY-MM-DD" />
      <Input label="Note" value={noteText} onChangeText={setNoteText} placeholder="Write your field note..." multiline numberOfLines={6} style={{ minHeight: 140, textAlignVertical: 'top' }} />
      <Button title="Save Note" onPress={submit} loading={loading} disabled={!projectId} />
    </ScrollView>
  );
}

function EditNotes() {
  const { user } = useAuth();
  const { recentItems } = useRecentProjects();
  const [projectId, setProjectId] = useState(null);
  const [notes, setNotes] = useState([]);
  const [editing, setEditing] = useState(null);

  const loadNotes = useCallback(async () => {
    if (!projectId) return;
    try { const d = await api(`/field-notes?project_id=${projectId}&foreman_id=${user.id}`); setNotes(d.notes || []); } catch {}
  }, [projectId, user.id]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  if (editing) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <Text style={fonts.h3}>Edit Note — {editing.note_date}</Text>
        <Input label="Date" value={editing.note_date} onChangeText={v => setEditing({ ...editing, note_date: v })} />
        <Input label="Note" value={editing.note_text} onChangeText={v => setEditing({ ...editing, note_text: v })} multiline numberOfLines={6} style={{ minHeight: 140, textAlignVertical: 'top' }} />
        <Button title="Save Changes" onPress={async () => {
          try {
            await api(`/field-notes/${editing.id}`, { method: 'PUT', body: JSON.stringify({ note_date: editing.note_date, note_text: editing.note_text }) });
            setEditing(null); loadNotes();
          } catch (e) { Alert.alert('Error', e.message); }
        }} />
        <Button title="Cancel" variant="outline" onPress={() => setEditing(null)} style={{ marginTop: spacing.sm }} />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing.md, paddingBottom: 0 }}>
        <ProjectRefField label="Select Project" recentItems={recentItems} value={projectId} onChange={setProjectId} placeholder="Type project number to see your notes..." />
      </View>
      <FlatList
        data={notes}
        keyExtractor={i => i.id}
        contentContainerStyle={{ padding: spacing.md }}
        renderItem={({ item: n }) => (
          <Card style={{ marginBottom: spacing.sm }} onPress={() => setEditing({ ...n })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={fonts.h3}>{n.note_date}</Text>
              <Text style={fonts.tiny}>tap to edit</Text>
            </View>
            <Text style={fonts.body} numberOfLines={4}>{n.note_text}</Text>
          </Card>
        )}
        ListEmptyComponent={<EmptyState message={projectId ? 'No notes for this project' : 'Type a project reference above'} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { ...fonts.body, color: colors.text3 },
  tabTextActive: { color: colors.primary, fontWeight: '600' },
});
