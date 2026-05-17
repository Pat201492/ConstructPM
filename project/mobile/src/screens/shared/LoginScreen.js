import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { Button, Input } from '../components/UI';
import { colors, fonts, spacing } from '../theme';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return setError('Enter email and password');
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.box}>
        <Text style={styles.title}>ConstructPM</Text>
        <Text style={styles.subtitle}>Construction Project Management</Text>
        <Input label="Email" value={email} onChangeText={setEmail}
          placeholder="you@company.com" autoCapitalize="none" keyboardType="email-address" />
        <Input label="Password" value={password} onChangeText={setPassword}
          placeholder="••••••••" secureTextEntry />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Sign In" onPress={handleLogin} loading={loading} style={{ marginTop: spacing.sm }} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing.lg },
  box: { backgroundColor: colors.card, borderRadius: 16, padding: spacing.xl },
  title: { ...fonts.h1, fontSize: 28, textAlign: 'center', marginBottom: 4 },
  subtitle: { ...fonts.small, textAlign: 'center', marginBottom: spacing.xl },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
});
