'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

// ─── Dark palette (Cinder) ────────────────────────────────────────────────────
export const DARK_COLORS = {
  bg:           '#090a0f',
  elevated:     '#0d1117',
  surface:      '#0d1117',
  card:         '#12151f',
  cardAlt:      '#161b26',
  border:       'rgba(51,65,85,0.6)',
  borderHard:   'rgba(71,85,105,0.8)',
  borderSubtle: 'rgba(30,41,59,0.8)',
  textPrimary:  '#ffffff',
  textLabel:    '#cbd5e1',
  textSecondary:'#cbd5e1',
  textSub:      '#94a3b8',
  textMuted:    '#64748b',
  accent:       '#6366f1',
  accentL:      '#818cf8',
  accentGlow:   '#818cf8',
  accentAlt:    '#a78bfa',
  accentDim:    'rgba(99,102,241,0.12)',
  accentBorder: 'rgba(99,102,241,0.35)',
  cyan:         '#06b6d4',
  cyanL:        '#22d3ee',
  cyanDim:      'rgba(6,182,212,0.12)',
  cyanBorder:   'rgba(6,182,212,0.35)',
  rose:         '#f43f5e',
  roseDim:      'rgba(244,63,94,0.12)',
  roseBorder:   'rgba(244,63,94,0.35)',
  emerald:      '#10b981',
  emeraldDim:   'rgba(16,185,129,0.12)',
  emeraldBorder:'rgba(16,185,129,0.35)',
  violet:       '#a78bfa',
  violetDim:    'rgba(167,139,250,0.12)',
  violetBorder: 'rgba(167,139,250,0.35)',
  amber:        '#f59e0b',
  orange:       '#f59e0b',
  // chart
  chart: ['#f43f5e', '#06b6d4', '#f59e0b', '#a78bfa', '#6366f1'],
};

// ─── Light palette (Tally) ────────────────────────────────────────────────────
export const LIGHT_COLORS = {
  bg:           '#f8f9fc',
  elevated:     '#ffffff',
  surface:      '#ffffff',
  card:         '#ffffff',
  cardAlt:      '#f3f4f6',
  border:       'rgba(209,213,219,0.9)',
  borderHard:   'rgba(156,163,175,0.8)',
  borderSubtle: 'rgba(229,231,235,0.9)',
  textPrimary:  '#111827',
  textLabel:    '#374151',
  textSecondary:'#374151',
  textSub:      '#6b7280',
  textMuted:    '#9ca3af',
  accent:       '#6366f1',
  accentL:      '#4f46e5',
  accentGlow:   '#6366f1',
  accentAlt:    '#7c3aed',
  accentDim:    'rgba(99,102,241,0.08)',
  accentBorder: 'rgba(99,102,241,0.3)',
  cyan:         '#0891b2',
  cyanL:        '#0e7490',
  cyanDim:      'rgba(8,145,178,0.08)',
  cyanBorder:   'rgba(8,145,178,0.25)',
  rose:         '#e11d48',
  roseDim:      'rgba(225,29,72,0.08)',
  roseBorder:   'rgba(225,29,72,0.25)',
  emerald:      '#059669',
  emeraldDim:   'rgba(5,150,105,0.08)',
  emeraldBorder:'rgba(5,150,105,0.25)',
  violet:       '#7c3aed',
  violetDim:    'rgba(124,58,237,0.08)',
  violetBorder: 'rgba(124,58,237,0.25)',
  amber:        '#d97706',
  orange:       '#d97706',
  // chart — slightly deeper for light bg
  chart: ['#e11d48', '#0891b2', '#d97706', '#7c3aed', '#6366f1'],
};

export type ThemeMode = 'dark' | 'light';
export type ColorPalette = typeof DARK_COLORS;

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ColorPalette;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: DARK_COLORS,
  toggleTheme: () => {},
  isDark: true,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vms-theme') as ThemeMode | null;
      if (saved === 'light' || saved === 'dark') setMode(saved);
    } catch {}
  }, []);

  // Apply data-theme attribute to <html> for CSS class-based theming
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('vms-theme', mode); } catch {}
  }, [mode]);

  const toggleTheme = () => setMode(prev => (prev === 'dark' ? 'light' : 'dark'));
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  return (
    <ThemeContext.Provider value={{ mode, colors, toggleTheme, isDark: mode === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
