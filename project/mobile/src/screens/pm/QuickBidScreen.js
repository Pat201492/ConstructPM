import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { api } from '../../services/api';
import { Button, Input, SearchDropdown } from '../../components/UI';
import { colors, fonts, spacing } from '../../theme';

export default function QuickBidScreen() {
  const [customers, setCustomers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [customerId, setCustomerId] = useState(null);
  const [locationId, setLocationId] = useState(null);
  const [contactId, setContactId] = useState(null);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    (async () => {
      try { const d = await api('/customers'); setCustomers((d.customers || []).map(c => ({ value: c.id, label: c.name }))); } catch {}
      try { const d = await api('/locations'); setLocations((d.locations || []).map(l => ({ value: l.id, label: `${l.name} (${l.local_union || 'No union'})` }))); } catch {}
    })();
  }, []);

  useEffect(() => {
    if (!customerId) return;
    (async () => {
      try { const d = await api(`/contacts?customer_id=${customerId}`); setContacts((d.contacts || []).map(c => ({ value: c.id, label: `${c.first_name} ${c.last_name}` }))); } catch {}
    })();
  }, [customerId]);

  const submit = async () => {
    if (!customerId || !locationId || !scope.trim()) return Alert.alert('Error', 'Fill in customer, location, and scope');
    setLoading(true);
    try {
      const data = await api('/bids', { method: 'POST', body: JSON.stringify({
        customer_id: customerId,
        location_id: locationId,
        customer_contact_id: contactId || null,
        project_scope: scope.trim(),
      }) });
      setCreated(data.bid || data);
    } catch (e) { Alert.alert('Error', e.message); }
    setLoading(false);
  };

  if (created) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md, alignItems: 'center', paddingTop: 60 }}>
        <Text style={[fonts.h1, { marginBottom: spacing.md }]}>Bid Created</Text>
        <Text style={[fonts.h2, { color: colors.primary, marginBottom: spacing.sm }]}>{created.bid_number}</Text>
        <Text style={[fonts.body, { textAlign: 'center', marginBottom: spacing.xl }]}>
          Open on desktop to fill quoting table and generate documents.
        </Text>
        <Button title="Create Another" onPress={() => { setCreated(null); setScope(''); }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.md }}>
      <Text style={[fonts.h2, { marginBottom: spacing.lg }]}>Quick Bid</Text>
      <SearchDropdown label="Customer" items={customers} value={customerId} onChange={setCustomerId} placeholder="Select customer..." />
      <SearchDropdown label="Location" items={locations} value={locationId} onChange={setLocationId} placeholder="Select location..." />
      {contacts.length > 0 && <SearchDropdown label="Contact" items={contacts} value={contactId} onChange={setContactId} placeholder="Select contact..." />}
      <Input label="Project Scope" value={scope} onChangeText={setScope} placeholder="Describe the scope of work..." multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: 'top' }} />
      <Button title="Create Bid" onPress={submit} loading={loading} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.bg } });
