import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fonts, card as cardStyle, input as inputStyle, btn, btnText, btnOutline, btnOutlineText } from '../theme';
import { api } from '../services/api';

// ── HEADER WITH BELL ICON ──────────────────────────────────
export function HeaderBell({ navigation }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const load = async () => {
      try { const d = await api('/notifications/unread-count'); setUnread(d.unread || 0); } catch {}
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <TouchableOpacity onPress={() => navigation.navigate('Notifications')} style={{ marginRight: 16, position: 'relative' }}>
      <Ionicons name="notifications-outline" size={24} color={colors.text} />
      {unread > 0 && (
        <View style={styles.bellBadge}>
          <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── STATUS BADGE ────────────────────────────────────────────
export function StatusBadge({ status, style }) {
  const map = {
    active: colors.green, open: colors.yellow, pending: colors.yellow,
    pending_return: colors.yellow, pending_data_confirm: colors.yellow,
    returned: colors.green, filled: colors.green, completed: colors.green,
    draft: colors.text3, cancelled: colors.red, closed: colors.text3,
    partially_filled: colors.yellow,
  };
  const bg = map[status] || colors.text3;
  return (
    <View style={[styles.badge, { backgroundColor: bg + '22', borderColor: bg }, style]}>
      <Text style={[styles.badgeText, { color: bg }]}>{(status || '').replace(/_/g, ' ')}</Text>
    </View>
  );
}

// ── CARD ────────────────────────────────────────────────────
export function Card({ children, style, onPress }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return <Wrapper style={[cardStyle, style]} onPress={onPress}>{children}</Wrapper>;
}

// ── STAT CARD ───────────────────────────────────────────────
export function StatCard({ label, value, sub }) {
  return (
    <View style={[cardStyle, { flex: 1, minWidth: 100, alignItems: 'center' }]}>
      <Text style={fonts.tiny}>{label}</Text>
      <Text style={[fonts.h2, { marginTop: 2 }]}>{value}</Text>
      {sub ? <Text style={fonts.tiny}>{sub}</Text> : null}
    </View>
  );
}

// ── BUTTON ──────────────────────────────────────────────────
export function Button({ title, onPress, variant = 'primary', loading: isLoading, style, disabled }) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      style={[isPrimary ? btn : btnOutline, disabled && { opacity: 0.5 }, style]}
      onPress={onPress} disabled={disabled || isLoading}
    >
      {isLoading ? <ActivityIndicator color={isPrimary ? colors.white : colors.primary} /> :
        <Text style={isPrimary ? btnText : btnOutlineText}>{title}</Text>}
    </TouchableOpacity>
  );
}

// ── TEXT INPUT ───────────────────────────────────────────────
export function Input({ label, ...props }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && <Text style={[fonts.small, { marginBottom: 4 }]}>{label}</Text>}
      <TextInput style={inputStyle} placeholderTextColor={colors.text3} {...props} />
    </View>
  );
}

// ── SEARCHABLE DROPDOWN ─────────────────────────────────────
export function SearchDropdown({ label, items, value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');
  const selected = items.find(i => i.value === value);
  const filtered = items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && <Text style={[fonts.small, { marginBottom: 4 }]}>{label}</Text>}
      <TouchableOpacity style={inputStyle} onPress={() => setVisible(true)}>
        <Text style={{ color: selected ? colors.text : colors.text3 }}>
          {selected ? selected.label : (placeholder || 'Select...')}
        </Text>
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <TextInput
              style={[inputStyle, { marginBottom: spacing.sm }]}
              placeholder="Search..." placeholderTextColor={colors.text3}
              value={search} onChangeText={setSearch} autoFocus
            />
            <FlatList
              data={filtered}
              keyExtractor={i => String(i.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.dropItem}
                  onPress={() => { onChange(item.value); setVisible(false); setSearch(''); }}
                >
                  <Text style={{ color: colors.text }}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
            <Button title="Cancel" variant="outline" onPress={() => { setVisible(false); setSearch(''); }} style={{ marginTop: spacing.sm }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── PROJECT REFERENCE FIELD (type-to-validate) ──────────────
//
// Foreman types a project number (e.g., "M26-1308.1") or a partial project name.
// Live debounced lookup against /api/projects/lookup tells them whether their
// input matches an active project. Recent submissions show as one-tap chips.
//
// Props:
//   recentItems — [{ value (project_id), label (name), customer?, project_numbers? }]
//   value       — currently confirmed project_id (null if unconfirmed)
//   onChange    — (project_id_or_null, project_name?) called when validation resolves
//   label, placeholder
export function ProjectRefField({ label, recentItems = [], value, onChange, placeholder }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState({ kind: 'idle' });
  // status: {kind:'idle'} | {kind:'typing'} | {kind:'found',project} | {kind:'none'} | {kind:'ambiguous',matches} | {kind:'error',msg}
  const debounceRef = useRef(null);
  const seqRef = useRef(0);

  // When recent chip tapped, fill the text and resolve immediately
  const fillFromRecent = (item) => {
    const ref = (item.project_numbers && item.project_numbers[0]) || item.label;
    setText(ref);
    setStatus({ kind: 'found', project: { id: item.value, name: item.label, customer_name: item.customer } });
    onChange(item.value, item.label);
  };

  const onText = (newText) => {
    setText(newText);
    onChange(null); // clear confirmed value while user is editing

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = newText.trim();
    if (trimmed.length < 2) {
      setStatus({ kind: 'idle' });
      return;
    }
    setStatus({ kind: 'typing' });
    const myseq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await api(`/projects/lookup?ref=${encodeURIComponent(trimmed)}`);
        if (myseq !== seqRef.current) return; // stale response
        if (result.found) {
          setStatus({ kind: 'found', project: result.project });
          onChange(result.project.id, result.project.name);
        } else if (result.ambiguous) {
          setStatus({ kind: 'ambiguous', matches: result.matches, message: result.message });
        } else {
          setStatus({ kind: 'none', message: result.message || 'No active project found' });
        }
      } catch (e) {
        if (myseq !== seqRef.current) return;
        setStatus({ kind: 'error', msg: 'Lookup failed — check connection' });
      }
    }, 350);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      {label && <Text style={[fonts.small, { marginBottom: 4 }]}>{label}</Text>}
      <TextInput
        style={inputStyle}
        value={text}
        onChangeText={onText}
        placeholder={placeholder || 'Type project number or name (e.g., M26-1308.1)'}
        placeholderTextColor={colors.text3}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {/* Status line */}
      {status.kind === 'typing' && (
        <Text style={{ color: colors.text3, fontSize: 12, marginTop: 4 }}>Looking up…</Text>
      )}
      {status.kind === 'found' && (
        <Text style={{ color: '#2e7d32', fontSize: 13, marginTop: 4, fontWeight: '600' }}>
          ✓ {status.project.name}
          {status.project.customer_name ? ` · ${status.project.customer_name}` : ''}
        </Text>
      )}
      {status.kind === 'none' && (
        <Text style={{ color: colors.text3, fontSize: 13, marginTop: 4 }}>{status.message}</Text>
      )}
      {status.kind === 'ambiguous' && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: colors.text3, fontSize: 12, marginBottom: 4 }}>{status.message}</Text>
          {status.matches.slice(0, 3).map(m => (
            <TouchableOpacity
              key={m.id}
              onPress={() => {
                setStatus({ kind: 'found', project: m });
                onChange(m.id, m.name);
                setText(m.name);
              }}
              style={{ paddingVertical: 4 }}
            >
              <Text style={{ color: colors.primary, fontSize: 13 }}>· {m.name} {m.customer_name ? `(${m.customer_name})` : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {status.kind === 'error' && (
        <Text style={{ color: '#c62828', fontSize: 13, marginTop: 4 }}>{status.msg}</Text>
      )}

      {/* Recent chips */}
      {recentItems.length > 0 && (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.text2, fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Recent
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {recentItems.map(item => (
              <TouchableOpacity
                key={item.value}
                onPress={() => fillFromRecent(item)}
                style={{
                  paddingVertical: 6, paddingHorizontal: 10,
                  backgroundColor: colors.bg2 || '#1f2937',
                  borderRadius: 16, borderWidth: 1, borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>
                  {(item.project_numbers && item.project_numbers[0]) || item.label}
                </Text>
                {item.project_numbers && item.project_numbers[0] && (
                  <Text style={{ color: colors.text3, fontSize: 10, marginTop: 1 }}>{item.label}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {recentItems.length === 0 && (
        <Text style={{ color: colors.text3, fontSize: 11, fontStyle: 'italic', marginTop: spacing.md }}>
          No recent projects yet
        </Text>
      )}
    </View>
  );
}

// ── LOADING SCREEN ──────────────────────────────────────────
export function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

// ── EMPTY STATE ─────────────────────────────────────────────
export function EmptyState({ message }) {
  return (
    <View style={{ padding: spacing.xl, alignItems: 'center' }}>
      <Ionicons name="folder-open-outline" size={48} color={colors.text3} />
      <Text style={[fonts.body, { color: colors.text3, marginTop: spacing.sm }]}>{message || 'Nothing here yet.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bellBadge: {
    position: 'absolute', top: -4, right: -6, backgroundColor: colors.red,
    borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center',
  },
  bellBadgeText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  badge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.bg2, borderRadius: 12, padding: spacing.md, maxHeight: '70%',
  },
  dropItem: {
    paddingVertical: 12, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
});
