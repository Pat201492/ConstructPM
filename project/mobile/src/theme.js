export const colors = {
  bg: '#0F1923',
  bg2: '#1A2736',
  bg3: '#243447',
  card: '#1E2D3D',
  border: '#2D4053',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  green: '#22C55E',
  yellow: '#F59E0B',
  red: '#EF4444',
  text: '#F1F5F9',
  text2: '#94A3B8',
  text3: '#64748B',
  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export const fonts = {
  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  h2: { fontSize: 18, fontWeight: '600', color: colors.text },
  h3: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 12, color: colors.text2 },
  tiny: { fontSize: 11, color: colors.text3 },
};

export const card = {
  backgroundColor: colors.card,
  borderRadius: 12,
  padding: spacing.md,
  borderWidth: 1,
  borderColor: colors.border,
};

export const input = {
  backgroundColor: colors.bg3,
  borderRadius: 8,
  padding: 12,
  color: colors.text,
  fontSize: 14,
  borderWidth: 1,
  borderColor: colors.border,
};

export const btn = {
  backgroundColor: colors.primary,
  borderRadius: 8,
  paddingVertical: 12,
  paddingHorizontal: 20,
  alignItems: 'center',
};

export const btnText = {
  color: colors.white,
  fontSize: 15,
  fontWeight: '600',
};

export const btnOutline = {
  ...btn,
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: colors.primary,
};

export const btnOutlineText = {
  ...btnText,
  color: colors.primary,
};
