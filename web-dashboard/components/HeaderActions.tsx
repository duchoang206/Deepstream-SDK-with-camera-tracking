'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from './LanguageContext';
import { useAppTheme } from './ThemeContext';

const SunIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"></circle>
    <path d="M12 2v2"></path>
    <path d="M12 20v2"></path>
    <path d="m4.93 4.93 1.41 1.41"></path>
    <path d="m17.66 17.66 1.41 1.41"></path>
    <path d="M2 12h2"></path>
    <path d="M20 12h2"></path>
    <path d="m6.34 17.66-1.41 1.41"></path>
    <path d="m19.07 4.93-1.41 1.41"></path>
  </svg>
);

const MoonIcon = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
  </svg>
);

const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
);

const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>
);

const DocumentIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

export default function HeaderActions() {
  const { language, t, changeLanguage } = useLanguage();
  const { isDark, toggleTheme, colors } = useAppTheme();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [systemOnline, setSystemOnline] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowLangMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const menuItemStyle = (active: boolean): React.CSSProperties => ({
    width: '100%', padding: '10px 14px',
    display: 'flex', alignItems: 'center', gap: '10px',
    background: active ? colors.accentDim : 'transparent',
    border: 'none', cursor: 'pointer',
    textAlign: 'left', fontSize: '13px',
    color: active ? colors.accentL : colors.textLabel,
    fontWeight: active ? 600 : 400,
    fontFamily: "'Space Grotesk', sans-serif",
    transition: 'all 0.15s',
  });

  return (
    <div className="fms-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      {/* Live System Pipeline Status Badge */}
      <div
        title="DeepStream GPU AI Pipeline: 4 Streams Active"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
          padding: '4px 10px',
          borderRadius: '20px',
          background: systemOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
          border: `1px solid ${systemOnline ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}`,
          fontSize: '12px',
          fontWeight: 600,
          color: systemOnline ? '#10b981' : '#ef4448',
          letterSpacing: '0.5px'
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: systemOnline ? '#10b981' : '#ef4448',
            boxShadow: systemOnline ? '0 0 8px #10b981' : '0 0 8px #ef4448',
            display: 'inline-block'
          }}
        />
        <span>4-CAM LIVE</span>
      </div>

      {/* Theme Toggle (Cinder Dark <-> Tally Light) */}
      <button
        className="action-btn"
        onClick={toggleTheme}
        title={isDark ? 'Giao diện sáng (Tally)' : 'Giao diện tối (Cinder)'}
        style={{
          color: isDark ? '#fbbf24' : '#6366f1',
          background: isDark ? 'rgba(251,191,36,0.1)' : 'rgba(99,102,241,0.08)',
          border: `1px solid ${isDark ? 'rgba(251,191,36,0.25)' : 'rgba(99,102,241,0.25)'}`,
          transition: 'all 0.25s ease',
        }}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </button>

      {/* Alert Bell */}
      <button className="action-btn" title={t.header.alerts} style={{ position: 'relative' }}>
        <span style={{ color: colors.rose }}><BellIcon /></span>
        {/* Notification dot */}
        <span style={{
          position: 'absolute', top: '7px', right: '7px',
          width: '6px', height: '6px', borderRadius: '50%',
          background: colors.rose, boxShadow: `0 0 6px ${colors.rose}`
        }} />
      </button>

      {/* Documents */}
      <button className="action-btn" title={t.header.documents}>
        <DocumentIcon />
      </button>

      {/* Language Selector */}
      <div style={{ position: 'relative' }} ref={menuRef}>
        <button
          className="action-btn lang-btn"
          title={t.header.language}
          onClick={() => setShowLangMenu(!showLangMenu)}
          style={{
            width: 'auto', padding: '0 14px', gap: '6px', height: '40px',
            borderRadius: '8px', fontSize: '14px', fontWeight: 600,
            display: 'flex', alignItems: 'center',
            background: colors.elevated, border: `1px solid ${colors.borderHard}`,
            color: colors.textLabel, cursor: 'pointer',
            fontFamily: "'Space Grotesk', sans-serif",
            transition: 'all 0.2s'
          }}
        >
          <span style={{ fontSize: '16px' }}>{language === 'en' ? '🇬🇧' : '🇻🇳'}</span>
          <span>{language === 'en' ? 'EN' : 'VI'}</span>
        </button>

        {showLangMenu && (
          <div style={{
            position: 'absolute', top: '48px', right: '0',
            background: colors.elevated,
            border: `1px solid ${colors.borderHard}`,
            borderRadius: '10px',
            boxShadow: isDark ? '0 20px 56px rgba(0,0,0,0.75), 0 0 0 1px rgba(99,102,241,0.2)' : '0 16px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(99,102,241,0.15)',
            overflow: 'hidden', zIndex: 100, width: '170px',
          }}>
            <button
              onClick={() => { changeLanguage('en'); setShowLangMenu(false); }}
              style={menuItemStyle(language === 'en')}
              onMouseEnter={e => { if (language !== 'en') e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = language === 'en' ? colors.accentDim : 'transparent'; }}
            >
              <span style={{ fontSize: '20px' }}>🇬🇧</span> English
            </button>
            <div style={{ height: '1px', background: colors.border }} />
            <button
              onClick={() => { changeLanguage('vi'); setShowLangMenu(false); }}
              style={menuItemStyle(language === 'vi')}
              onMouseEnter={e => { if (language !== 'vi') e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = language === 'vi' ? colors.accentDim : 'transparent'; }}
            >
              <span style={{ fontSize: '20px' }}>🇻🇳</span> Tiếng Việt
            </button>
          </div>
        )}
      </div>

      {/* Profile */}
      <button className="action-btn" title={t.header.profile}>
        <UserIcon />
      </button>
    </div>
  );
}
