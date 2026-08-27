'use client';

import React, { useEffect, useState } from 'react';
import { useLanguage } from '../LanguageContext';
import { useCameras } from '../CameraContext';
import { useAppTheme } from '../ThemeContext';
import {
  Eye, EyeOff, Layers, ShieldAlert, Compass, Plus, Trash2,
  CheckCircle2, Camera as CameraIcon, RefreshCw, AlertCircle
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type Rule = {
  id: string; type?: string; rule_type?: string; name: string;
  points: number[][]; target_objects?: string[]; threshold?: number; direction?: string;
};

// ─── Empty State Component ────────────────────────────────────────────────────
const EmptyState = ({ icon, title, hint, colors }: { icon: React.ReactNode; title: string; hint: string; colors: any }) => (
  <div style={{
    border: `1px dashed ${colors.borderHard}`, borderRadius: '10px',
    padding: '32px 20px', textAlign: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
  }}>
    <div style={{ color: colors.textMuted, opacity: 0.7 }}>{icon}</div>
    <p style={{ color: colors.textLabel, fontWeight: 700, fontSize: '13px', margin: 0 }}>{title}</p>
    <p style={{ color: colors.textMuted, fontSize: '12px', fontFamily: 'monospace', margin: 0, lineHeight: 1.6 }}
      dangerouslySetInnerHTML={{ __html: hint }} />
  </div>
);

// ─── Gradient primary button ──────────────────────────────────────────────────
const GradientBtn = ({ children, onClick, disabled, style, isDark }: any) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: '10px 20px', borderRadius: '8px', fontWeight: 700,
    fontSize: '13px', cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: "'Space Grotesk', sans-serif",
    background: disabled
      ? 'var(--bg-card-alt)'
      : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    color: disabled ? 'var(--text-muted)' : '#ffffff',
    border: disabled ? '1px solid var(--border)' : '1px solid rgba(99,102,241,0.5)',
    boxShadow: disabled ? 'none' : (isDark ? '0 4px 18px rgba(99,102,241,0.35)' : '0 2px 10px rgba(99,102,241,0.25)'),
    opacity: disabled ? 0.6 : 1,
    transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', gap: '6px',
    ...style,
  }}>
    {children}
  </button>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BuildingView() {
  const { cameras, fetchCameras, deleteCamera: handleDeleteCameraCtx, updateCamera: handleUpdateCameraCtx } = useCameras();
  const { colors: C, isDark } = useAppTheme();
  const [activeTab, setActiveTab] = useState<'camera' | 'rules' | 'calibration'>('camera');
  const [snapshotTimestamp, setSnapshotTimestamp] = useState<number>(Date.now());
  const [newCamName, setNewCamName] = useState('');
  const [newCamUrl, setNewCamUrl] = useState('');
  const [editCamModal, setEditCamModal] = useState({ open: false, id: '', name: '', url: '' });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [cameraBrand, setCameraBrand] = useState('hikvision');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedCamId, setSelectedCamId] = useState('');
  const [rulesByCam, setRulesByCam] = useState<Record<string, Rule[]>>({});
  const [currentRuleType, setCurrentRuleType] = useState<string>('intrusion');
  const [currentRuleName, setCurrentRuleName] = useState('');
  const [currentThreshold, setCurrentThreshold] = useState(15);
  const [currentPoints, setCurrentPoints] = useState<number[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [availableClasses, setAvailableClasses] = useState<string[]>([]);
  const [currentTargetClasses, setCurrentTargetClasses] = useState<string[]>(['robot', 'rack']);
  const [calibCamId, setCalibCamId] = useState('');
  const [calibSrcPoints, setCalibSrcPoints] = useState<number[][]>([]);
  const [calibDstPoints, setCalibDstPoints] = useState<number[][]>([[0,0],[0,0],[0,0],[0,0]]);
  const [camX, setCamX] = useState<number>(0);
  const [camY, setCamY] = useState<number>(0);
  const [camZ, setCamZ] = useState<number>(2.5);
  const [camYaw, setCamYaw] = useState<number>(0);
  const [calibStatus, setCalibStatus] = useState<string>('');
  const [mapOverview, setMapOverview] = useState<any[]>([]);
  const { t } = useLanguage();

  // ─── Shared element styles derived from dynamic theme ───────────────────────
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px',
    borderRadius: '8px', border: `1px solid ${C.borderHard}`,
    fontSize: '13px', outline: 'none',
    background: C.elevated, color: C.textPrimary,
    fontFamily: "'Space Grotesk', sans-serif",
    transition: 'border-color 0.2s, box-shadow 0.2s',
    caretColor: C.accentL,
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '11px', color: C.textLabel,
    marginBottom: '6px', fontFamily: 'JetBrains Mono, monospace',
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600,
  };
  const cardStyle: React.CSSProperties = {
    background: C.card, borderRadius: '12px',
    border: `1px solid ${C.border}`, padding: '20px',
    boxShadow: isDark ? '0 4px 20px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
  };
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
      e.target.style.borderColor = C.accent;
      e.target.style.boxShadow = `0 0 0 3px ${C.accentGlow}`;
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
      e.target.style.borderColor = C.borderHard;
      e.target.style.boxShadow = 'none';
    },
  };

  const fetchMapOverview = async () => {
    try {
      const res = await fetch('/api/backend/calibration/map-overview');
      if (res.ok) { const d = await res.json(); if (d.calibrations) setMapOverview(d.calibrations); }
    } catch {}
  };

  useEffect(() => { if (activeTab === 'calibration') fetchMapOverview(); }, [activeTab]);
  useEffect(() => {
    fetch('/api/backend/model/classes').then(r => r.json())
      .then(d => { if (d.classes?.length > 0) setAvailableClasses(d.classes); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (cameras.length > 0) {
      if (!selectedCamId) setSelectedCamId(cameras[0].id);
      if (!calibCamId) setCalibCamId(cameras[0].id);
    }
  }, [cameras, selectedCamId, calibCamId]);
  useEffect(() => {
    if (selectedCamId) {
      fetch(`/api/backend/camera/${selectedCamId}/rules`).then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.rules) setRulesByCam(p => ({ ...p, [selectedCamId]: d.rules })); }).catch(() => {});
    }
  }, [selectedCamId]);

  const handleAddCamera = (e: React.FormEvent) => { e.preventDefault(); if (!newCamName || !newCamUrl) return; setShowAuthModal(true); };

  const handleApplyCameraAuth = async () => {
    let cleanIpOrUrl = newCamUrl.trim(), fullRtspUrl = '';
    if (cleanIpOrUrl.startsWith('rtsp://') || cleanIpOrUrl.startsWith('http://') || cleanIpOrUrl.startsWith('https://')) {
      fullRtspUrl = cleanIpOrUrl;
    } else {
      const uEnc = authUsername ? encodeURIComponent(authUsername) : '';
      const pEnc = authPassword ? encodeURIComponent(authPassword) : '';
      const auth = (uEnc && pEnc) ? `${uEnc}:${pEnc}@` : (uEnc ? `${uEnc}@` : '');
      let hp = cleanIpOrUrl.replace(/^https?:\/\//, '').replace(/^rtsp:\/\//, '');
      let ps = '';
      if (hp.includes('/')) { const i = hp.indexOf('/'); ps = hp.slice(i); hp = hp.slice(0, i); }
      if (!hp.includes(':')) hp = `${hp}:554`;
      fullRtspUrl = cameraBrand === 'custom' ? `rtsp://${auth}${hp}${ps}` :
        cameraBrand === 'dahua' ? `rtsp://${auth}${hp}/cam/realmonitor?channel=1&subtype=0` :
        `rtsp://${auth}${hp}/Streaming/Channels/101`;
    }
    try {
      const res = await fetch('/api/backend/camera/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCamName.trim(), rtsp_url: fullRtspUrl })
      });
      if (res.ok) {
        setNewCamName(''); setNewCamUrl(''); setAuthUsername(''); setAuthPassword('');
        setShowAuthModal(false); fetchCameras();
      } else { const e = await res.json().catch(() => null); alert(e?.detail || `Lỗi HTTP ${res.status}`); }
    } catch (e: any) { alert(`Lỗi Backend: ${e?.message || e}`); }
  };

  const handleDeleteCamera = async (id: string) => {
    if (confirm('Xóa Camera này khỏi hệ thống?')) await handleDeleteCameraCtx(id);
  };
  const handleSaveEditCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCamModal.name || !editCamModal.url) return;
    const ok = await handleUpdateCameraCtx(editCamModal.id, editCamModal.name.trim(), editCamModal.url.trim());
    if (ok) setEditCamModal({ open: false, id: '', name: '', url: '' }); else alert('Lỗi cập nhật');
  };
  const handleSaveCurrentRule = async () => {
    const min = currentRuleType === 'tripwire' ? 2 : 3;
    if (currentPoints.length < min) { alert(`Cần ít nhất ${min} điểm!`); return; }
    const rules = rulesByCam[selectedCamId] || [];
    const nr: Rule = {
      id: `rule_${Date.now().toString().slice(-4)}`, type: currentRuleType,
      name: currentRuleName || `${currentRuleType.toUpperCase()} #${rules.length + 1}`,
      points: currentPoints, target_objects: currentTargetClasses, threshold: currentThreshold
    };
    const updated = [...rules, nr];
    setRulesByCam({ ...rulesByCam, [selectedCamId]: updated });
    setCurrentPoints([]); setIsDrawing(false); setCurrentRuleName('');
    try { await fetch(`/api/backend/camera/${selectedCamId}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: updated }) }); } catch {}
  };
  const handleDeleteRule = async (ruleId: string) => {
    const updated = (rulesByCam[selectedCamId] || []).filter(r => r.id !== ruleId);
    setRulesByCam({ ...rulesByCam, [selectedCamId]: updated });
    try { await fetch(`/api/backend/camera/${selectedCamId}/rules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: updated }) }); } catch {}
  };
  const handleSaveCalibration = async () => {
    if (calibSrcPoints.length !== 4) { alert('Cần đúng 4 điểm góc!'); return; }
    try {
      const res = await fetch(`/api/backend/camera/${calibCamId}/calibration`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src_points: calibSrcPoints, dst_points: calibDstPoints, cam_x: camX, cam_y: camY, cam_z: camZ, yaw: camYaw })
      });
      if (res.ok) { setCalibStatus('Hiệu chỉnh không gian thành công!'); fetchMapOverview(); }
      else alert('Không thể tính Homography.');
    } catch (e) { console.error(e); }
  };

  // Tab style helper
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 20px', borderRadius: '9px', cursor: 'pointer',
    fontWeight: active ? 700 : 500, fontSize: '13px',
    fontFamily: "'Space Grotesk', sans-serif",
    border: active ? `1px solid ${C.accentBorder}` : `1px solid ${C.border}`,
    background: active ? C.accentDim : 'transparent',
    color: active ? C.accentL : C.textSub,
    boxShadow: active ? `0 0 16px ${C.accentGlow}` : 'none',
    transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', gap: '7px',
  });

  // ── Modal Overlay ──────────────────────────────────────────────────────────
  const modalOverlay: React.CSSProperties = {
    position: 'fixed', inset: 0,
    backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(15,23,42,0.4)',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modalCard: React.CSSProperties = {
    background: C.card, padding: '28px', borderRadius: '14px',
    border: `1px solid ${C.borderHard}`,
    boxShadow: isDark ? `0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px ${C.accentBorder}` : '0 20px 60px rgba(0,0,0,0.15)',
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ backgroundColor: C.bg, minHeight: 'calc(100vh - 80px)', padding: '24px', transition: 'background-color 0.2s ease' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

        {/* Top Tabs */}
        <div style={{
          display: 'flex', gap: '8px',
          borderBottom: `1px solid ${C.border}`,
          paddingBottom: '18px', marginBottom: '24px',
        }}>
          <button onClick={() => setActiveTab('camera')} style={tabStyle(activeTab === 'camera')}>
            <CameraIcon size={14} /> Quản lý Camera ({cameras.length})
          </button>
          <button onClick={() => setActiveTab('rules')} style={tabStyle(activeTab === 'rules')}>
            <ShieldAlert size={14} /> Phân tích Hành vi (ROI / Tripwire)
          </button>
          <button onClick={() => setActiveTab('calibration')} style={tabStyle(activeTab === 'calibration')}>
            <Compass size={14} /> Camera Calibration (2D → 3D Map)
          </button>
        </div>

        {/* ── TAB 1: CAMERA MANAGEMENT ───────────────────────────────────── */}
        {activeTab === 'camera' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Add Camera Form */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: C.textPrimary, marginBottom: '18px', letterSpacing: '-0.01em' }}>
                Đăng ký Luồng Camera Mới
              </h2>
              <form onSubmit={handleAddCamera} style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Tên Camera</label>
                  <input type="text" value={newCamName} onChange={e => setNewCamName(e.target.value)}
                    placeholder="VD: Cổng chính, Kho A..." style={inputStyle} {...focusHandlers} />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={labelStyle}>IP Address hoặc RTSP URL</label>
                  <input type="text" value={newCamUrl} onChange={e => setNewCamUrl(e.target.value)}
                    placeholder="192.168.1.100 hoặc rtsp://..." style={inputStyle} {...focusHandlers} />
                </div>
                <GradientBtn isDark={isDark} style={{ whiteSpace: 'nowrap', alignSelf: 'flex-end', height: '42px' }}>
                  <Plus size={15} /> Thêm Camera
                </GradientBtn>
              </form>
            </div>

            {/* Camera Table */}
            {cameras.length === 0 ? (
              <EmptyState
                colors={C}
                icon={<CameraIcon size={36} strokeWidth={1.2} />}
                title="Chưa có camera nào được đăng ký"
                hint={`Điền tên và IP/RTSP URL vào form ở trên, sau đó bấm <span style='color:${C.accentL};font-weight:600'>+ Thêm Camera</span>`}
              />
            ) : (
              <div style={{ background: C.card, borderRadius: '12px', border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: C.cardAlt, borderBottom: `1px solid ${C.border}` }}>
                      {['ID', 'TÊN CAMERA', 'RTSP URL', 'TRẠNG THÁI', 'THAO TÁC'].map((h, i) => (
                        <th key={h} style={{
                          padding: '13px 16px', fontSize: '11px', fontWeight: 700,
                          color: C.textLabel, fontFamily: 'JetBrains Mono, monospace',
                          letterSpacing: '0.06em', textAlign: i === 4 ? 'right' : 'left',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cameras.map(c => (
                      <tr key={c.id} style={{ borderBottom: `1px solid ${C.borderSubtle}`, transition: 'background 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = C.accentDim)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ padding: '14px 16px', color: C.textMuted, fontFamily: 'monospace', fontSize: '12px' }}>#{c.id}</td>
                        <td style={{ padding: '14px 16px', fontWeight: 700, color: C.textPrimary, fontSize: '13px' }}>{c.name}</td>
                        <td style={{ padding: '14px 16px', color: C.textSub, fontFamily: 'monospace', fontSize: '11px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.rtsp_url}</td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            background: C.cyanDim, color: C.cyanL,
                            padding: '4px 10px', borderRadius: '20px',
                            fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
                            border: `1px solid ${C.cyanBorder}`,
                            boxShadow: isDark ? '0 0 8px rgba(6,182,212,0.15)' : 'none',
                          }}>● Live · WebRTC</span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setEditCamModal({ open: true, id: c.id, name: c.name, url: c.rtsp_url })}
                              style={{
                                background: C.accentDim, border: `1px solid ${C.accentBorder}`,
                                color: C.accentL, padding: '6px 14px', borderRadius: '6px',
                                cursor: 'pointer', fontWeight: 600, fontSize: '12px',
                                fontFamily: "'Space Grotesk', sans-serif", transition: 'all 0.15s',
                              }}>Sửa</button>
                            <button onClick={() => handleDeleteCamera(c.id)}
                              style={{
                                background: C.roseDim, border: `1px solid ${C.roseBorder}`,
                                color: C.rose, padding: '6px 14px', borderRadius: '6px',
                                cursor: 'pointer', fontWeight: 600, fontSize: '12px',
                                fontFamily: "'Space Grotesk', sans-serif", transition: 'all 0.15s',
                              }}>Xóa</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: RULES ───────────────────────────────────────────────── */}
        {activeTab === 'rules' && (
          <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '20px' }}>

            {/* Left Panel */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '14px' }}>

              <div>
                <label style={labelStyle}>Chọn Camera</label>
                <select value={selectedCamId} onChange={e => setSelectedCamId(e.target.value)}
                  style={selectStyle} {...focusHandlers}>
                  {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Loại Quy Tắc Hành Vi</label>
                <select value={currentRuleType}
                  onChange={e => { setCurrentRuleType(e.target.value); setCurrentPoints([]); }}
                  style={selectStyle} {...focusHandlers}>
                  <option value="intrusion">Vùng cấm xâm nhập (Intrusion ROI)</option>
                  <option value="tripwire">Vạch ảo 2 chiều (Tripwire Line)</option>
                  <option value="dwell_time">Lảng vãng / Dừng chờ (Dwell Time)</option>
                  <option value="density">Mật độ đám đông (Crowd Density)</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Tên Khu Vực / Vạch</label>
                <input type="text" value={currentRuleName} onChange={e => setCurrentRuleName(e.target.value)}
                  placeholder="VD: Cửa thoát hiểm..." style={inputStyle} {...focusHandlers} />
              </div>

              <div>
                <label style={labelStyle}>Đối Tượng Áp Dụng</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {availableClasses.map(c => {
                    const active = currentTargetClasses.includes(c);
                    return (
                      <div key={c} onClick={() => {
                        if (active) setCurrentTargetClasses(currentTargetClasses.filter(x => x !== c));
                        else setCurrentTargetClasses([...currentTargetClasses, c]);
                      }} style={{
                        padding: '4px 12px', borderRadius: '20px', fontSize: '12px', cursor: 'pointer',
                        border: active ? `1px solid ${C.accentBorder}` : `1px solid ${C.borderHard}`,
                        background: active ? C.accentDim : 'transparent',
                        color: active ? C.accentL : C.textSub,
                        fontWeight: active ? 700 : 400,
                        transition: 'all 0.15s',
                      }}>{c}</div>
                    );
                  })}
                </div>
              </div>

              {(currentRuleType === 'dwell_time' || currentRuleType === 'density') && (
                <div>
                  <label style={labelStyle}>
                    {currentRuleType === 'dwell_time' ? 'Ngưỡng dừng (giây)' : 'Số người tối đa'}
                  </label>
                  <input type="number" value={currentThreshold}
                    onChange={e => setCurrentThreshold(Number(e.target.value))}
                    style={inputStyle} {...focusHandlers} />
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button onClick={() => { setIsDrawing(true); setCurrentPoints([]); }} style={{
                  flex: 1, padding: '10px 8px', borderRadius: '8px', fontWeight: 700,
                  cursor: 'pointer', fontSize: '12px',
                  fontFamily: "'Space Grotesk', sans-serif",
                  background: isDrawing ? C.accentDim : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: isDrawing ? C.accentL : '#ffffff',
                  border: isDrawing ? `1px solid ${C.accentBorder}` : '1px solid rgba(99,102,241,0.5)',
                  boxShadow: isDrawing ? 'none' : '0 4px 16px rgba(99,102,241,0.3)',
                  transition: 'all 0.2s',
                }}>
                  {isDrawing ? '● Đang chấm...' : '+ Chấm Tọa Độ'}
                </button>
                <button onClick={handleSaveCurrentRule} disabled={currentPoints.length === 0} style={{
                  flex: 1, padding: '10px 8px', borderRadius: '8px', fontWeight: 700,
                  cursor: currentPoints.length === 0 ? 'not-allowed' : 'pointer', fontSize: '12px',
                  fontFamily: "'Space Grotesk', sans-serif",
                  background: currentPoints.length === 0 ? C.cardAlt : C.cyanDim,
                  color: currentPoints.length === 0 ? C.textMuted : C.cyanL,
                  border: `1px solid ${currentPoints.length === 0 ? C.border : C.cyanBorder}`,
                  transition: 'all 0.2s', opacity: currentPoints.length === 0 ? 0.6 : 1,
                }}>
                  Lưu Quy Tắc
                </button>
              </div>

              {/* Saved Rules */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: '14px' }}>
                <h4 style={{ ...labelStyle, marginBottom: '10px' }}>Quy tắc đã lưu</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                  {(rulesByCam[selectedCamId] || []).length === 0 ? (
                    <div style={{ textAlign: 'center', color: C.textMuted, fontSize: '12px', padding: '16px', fontFamily: 'monospace' }}>
                      Chưa có quy tắc nào
                    </div>
                  ) : (
                    (rulesByCam[selectedCamId] || []).map(r => {
                      const rType = r.type || r.rule_type || 'intrusion';
                      const isIntrusion = rType === 'intrusion';
                      return (
                        <div key={r.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                          padding: '9px 11px', background: C.cardAlt, borderRadius: '8px',
                          border: `1px solid ${C.border}`,
                          borderLeft: `3px solid ${isIntrusion ? C.rose : C.cyanL}`,
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, color: C.textPrimary, fontSize: '12px' }}>{r.name}</div>
                            <div style={{ color: C.textMuted, textTransform: 'uppercase', fontSize: '10px', fontFamily: 'monospace', marginBottom: '4px' }}>{rType}</div>
                            {r.target_objects?.length ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {r.target_objects.map(c => (
                                  <span key={c} style={{ background: C.accentDim, color: C.accentL, padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 600 }}>{c}</span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <button onClick={() => handleDeleteRule(r.id)} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: '2px', transition: 'color 0.15s' }}
                            onMouseEnter={e => e.currentTarget.style.color = C.rose}
                            onMouseLeave={e => e.currentTarget.style.color = C.textMuted}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Right Canvas */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: C.textLabel }}>
                  Ảnh Frame Tĩnh — Vẽ trực tiếp để định nghĩa ROI / Tripwire
                </span>
                <button type="button" onClick={() => setSnapshotTimestamp(Date.now())} style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '6px 12px', fontSize: '11px', fontWeight: 600,
                  color: C.accentL, background: C.accentDim,
                  border: `1px solid ${C.accentBorder}`, borderRadius: '7px', cursor: 'pointer',
                  fontFamily: "'Space Grotesk', sans-serif",
                }}>
                  <RefreshCw size={12} /> Chụp lại Frame
                </button>
              </div>

              <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#020306', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${C.borderHard}` }}>
                {selectedCamId ? (
                  <img key={`rule-snap-${selectedCamId}-${snapshotTimestamp}`}
                    src={`/api/backend/camera/${selectedCamId}/snapshot?t=${snapshotTimestamp}`}
                    alt="Camera Snapshot" style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', top: 0, left: 0 }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.textMuted, fontSize: '13px', flexDirection: 'column', gap: '8px' }}>
                    <CameraIcon size={32} strokeWidth={1} />
                    <span>Chọn camera để hiển thị frame</span>
                  </div>
                )}
                {isDrawing && (
                  <div style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(99,102,241,0.95)', color: '#fff', padding: '4px 14px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', zIndex: 20, letterSpacing: '0.04em', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                    ● ĐANG VẼ — Click để chấm điểm ({currentPoints.length} điểm)
                  </div>
                )}
                <svg viewBox="0 0 1 1" preserveAspectRatio="none"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: isDrawing ? 'crosshair' : 'default', zIndex: 10 }}
                  onClick={e => {
                    if (!isDrawing) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    setCurrentPoints([...currentPoints, [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]]);
                  }}>
                  {(rulesByCam[selectedCamId] || []).map(r => {
                    const rType = r.type || r.rule_type || 'intrusion';
                    const pts = r.points || [];
                    if (rType === 'tripwire' && pts.length >= 2) return (
                      <g key={r.id}>
                        <line x1={pts[0][0]} y1={pts[0][1]} x2={pts[1][0]} y2={pts[1][1]} stroke="#06b6d4" strokeWidth="0.005" />
                        <circle cx={pts[0][0]} cy={pts[0][1]} r="0.008" fill="#06b6d4" />
                        <circle cx={pts[1][0]} cy={pts[1][1]} r="0.008" fill="#06b6d4" />
                        <text x={pts[0][0]} y={pts[0][1] - 0.022} fill="#22d3ee" fontSize="0.028" fontWeight="bold">{r.name}</text>
                      </g>
                    );
                    if (pts.length >= 3) return (
                      <g key={r.id}>
                        <polygon points={pts.map(p => `${p[0]},${p[1]}`).join(' ')} fill="rgba(244,63,94,0.18)" stroke="#f43f5e" strokeWidth="0.004" />
                        <text x={pts[0][0]} y={pts[0][1] - 0.022} fill="#fb7185" fontSize="0.028" fontWeight="bold">{r.name} ({rType.toUpperCase()})</text>
                      </g>
                    );
                    return null;
                  })}
                  {isDrawing && currentPoints.length > 0 && (
                    <>
                      {currentPoints.map((pt, i) => (
                        <circle key={i} cx={pt[0]} cy={pt[1]} r="0.009" fill="#6366f1" stroke="#ffffff" strokeWidth="0.002" />
                      ))}
                      <polyline points={currentPoints.map(p => `${p[0]},${p[1]}`).join(' ')} fill="none" stroke="#818cf8" strokeWidth="0.004" strokeDasharray="0.013" />
                    </>
                  )}
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: CALIBRATION ─────────────────────────────────────────── */}
        {activeTab === 'calibration' && (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '20px' }}>

            {/* Left Panel */}
            <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: C.textPrimary, margin: '0 0 8px 0' }}>
                  Hiệu chỉnh Tọa độ Không gian
                </h3>
                <div style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: '8px', padding: '12px', fontSize: '12px', color: C.textSub, lineHeight: 1.7 }}>
                  <div style={{ color: C.accentL, fontWeight: 700, fontFamily: 'monospace', marginBottom: '4px' }}>Hướng dẫn</div>
                  1. Click 4 góc trên ảnh (TL → TR → BR → BL)<br/>
                  2. Nhập tọa độ mét tương ứng trên sàn<br/>
                  3. Nhập vị trí thực Camera → Tính ma trận
                </div>
              </div>

              <div>
                <label style={labelStyle}>Chọn Camera</label>
                <select value={calibCamId} onChange={e => {
                  setCalibCamId(e.target.value); setCalibSrcPoints([]); setCalibStatus('');
                  const ex = mapOverview.find(c => c.cam_id === e.target.value);
                  if (ex?.calibration) {
                    setCalibDstPoints(ex.calibration.dst_points || [[0,0],[0,0],[0,0],[0,0]]);
                    setCamX(ex.calibration.cam_x || 0); setCamY(ex.calibration.cam_y || 0);
                    setCamZ(ex.calibration.cam_z || 2.5); setCamYaw(ex.calibration.yaw || 0);
                  }
                }} style={selectStyle} {...focusHandlers}>
                  {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Calib points */}
              <div style={{ background: C.cardAlt, padding: '14px', borderRadius: '10px', border: `1px solid ${C.border}` }}>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>
                  Tọa độ sàn (X, Y mét) — {calibSrcPoints.length}/4
                </div>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '8px', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, width: '26px', fontSize: '12px', fontFamily: 'monospace', color: C.amber, opacity: i < calibSrcPoints.length ? 1 : 0.3 }}>P{i+1}</span>
                    <input type="number" placeholder="X(m)" value={calibDstPoints[i][0]}
                      onChange={e => { const n = [...calibDstPoints]; n[i][0] = Number(e.target.value); setCalibDstPoints(n); }}
                      style={{ ...inputStyle, padding: '7px 9px', fontSize: '12px' }} {...focusHandlers} />
                    <input type="number" placeholder="Y(m)" value={calibDstPoints[i][1]}
                      onChange={e => { const n = [...calibDstPoints]; n[i][1] = Number(e.target.value); setCalibDstPoints(n); }}
                      style={{ ...inputStyle, padding: '7px 9px', fontSize: '12px' }} {...focusHandlers} />
                  </div>
                ))}
              </div>

              {/* Camera position */}
              <div style={{ background: C.cardAlt, padding: '14px', borderRadius: '10px', border: `1px solid ${C.border}` }}>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>Vị trí cắm Camera</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {([['X (m)', camX, setCamX], ['Y (m)', camY, setCamY], ['Cao Z (m)', camZ, setCamZ], ['Yaw (độ)', camYaw, setCamYaw]] as any[]).map(([lbl, val, set]) => (
                    <div key={lbl}>
                      <label style={{ ...labelStyle, fontSize: '10px', marginBottom: '4px' }}>{lbl}</label>
                      <input type="number" value={val} onChange={e => set(Number(e.target.value))}
                        style={{ ...inputStyle, padding: '7px 9px', fontSize: '12px' }} {...focusHandlers} />
                    </div>
                  ))}
                </div>
              </div>

              {calibStatus && (
                <div style={{ padding: '11px 14px', background: C.emeraldDim, color: C.emerald, borderRadius: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', border: `1px solid ${C.emeraldBorder}` }}>
                  <CheckCircle2 size={16} /> {calibStatus}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <button onClick={() => { setCalibSrcPoints([]); setCalibStatus(''); }} style={{
                  flex: 1, padding: '10px', background: 'transparent', border: `1px solid ${C.borderHard}`,
                  color: C.textLabel, borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px',
                  fontFamily: "'Space Grotesk', sans-serif", transition: 'all 0.2s',
                }}>Xóa Điểm Ảnh</button>
                <GradientBtn isDark={isDark} onClick={handleSaveCalibration} disabled={calibSrcPoints.length !== 4} style={{ flex: 1, justifyContent: 'center' }}>
                  Tính & Lưu
                </GradientBtn>
              </div>
            </div>

            {/* Right: Image + Map */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

              {/* Camera snapshot */}
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: C.textLabel }}>
                    1. Khung Hình Camera
                    <span style={{ color: C.textMuted, fontWeight: 400, fontSize: '11px', marginLeft: '8px', fontFamily: 'monospace' }}>Chấm 4 điểm góc</span>
                  </h4>
                  <button type="button" onClick={() => setSnapshotTimestamp(Date.now())} style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '5px 10px', fontSize: '11px', fontWeight: 600,
                    color: C.accentL, background: C.accentDim,
                    border: `1px solid ${C.accentBorder}`, borderRadius: '6px', cursor: 'pointer',
                  }}>
                    <RefreshCw size={11} /> Chụp lại
                  </button>
                </div>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#020306', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${C.borderHard}` }}>
                  {calibCamId ? (
                    <img key={`calib-${calibCamId}-${snapshotTimestamp}`}
                      src={`/api/backend/camera/${calibCamId}/snapshot?t=${snapshotTimestamp}`}
                      alt="Calibration" style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', top: 0, left: 0 }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.textMuted, fontSize: '12px' }}>Chưa chọn camera</div>
                  )}
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', zIndex: 10 }}
                    onClick={e => {
                      if (calibSrcPoints.length >= 4) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      setCalibSrcPoints([...calibSrcPoints, [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]]);
                    }}>
                    {calibSrcPoints.map((pt, i) => (
                      <g key={i}>
                        <circle cx={pt[0]} cy={pt[1]} r="0.012" fill={C.amber} stroke="#090a0f" strokeWidth="0.003" />
                        <text x={pt[0] + 0.02} y={pt[1] + 0.02} fill={C.amber} fontSize="0.038" fontWeight="bold" stroke="#000" strokeWidth="0.001">P{i + 1}</text>
                      </g>
                    ))}
                    {calibSrcPoints.length >= 2 && (
                      <polygon points={calibSrcPoints.map(p => `${p[0]},${p[1]}`).join(' ')} fill="rgba(245,158,11,0.15)" stroke={C.amber} strokeWidth="0.003" />
                    )}
                  </svg>
                </div>
              </div>

              {/* 2D Floor Map */}
              <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 700, color: C.textLabel }}>
                  2. Bản đồ Không gian
                  <span style={{ color: C.textMuted, fontWeight: 400, fontSize: '11px', marginLeft: '8px', fontFamily: 'monospace' }}>2D Floor Map</span>
                </h4>
                <div style={{ position: 'relative', width: '100%', flex: 1, background: isDark ? '#020306' : '#f1f5f9', borderRadius: '8px', overflow: 'hidden', minHeight: '300px', border: `1px solid ${C.borderHard}` }}>
                  {(() => {
                    let minX = -5, minY = -5, maxX = 20, maxY = 20;
                    const pts = [...calibDstPoints.slice(0, calibSrcPoints.length), [camX, camY]];
                    if (mapOverview.length > 0) mapOverview.forEach(m => {
                      if (m.calibration.cam_x !== undefined) pts.push([m.calibration.cam_x, m.calibration.cam_y]);
                      if (m.calibration.fov_polygon) pts.push(...m.calibration.fov_polygon);
                    });
                    if (pts.length > 0) {
                      const xs = pts.map(p => p[0]); const ys = pts.map(p => p[1]);
                      minX = Math.min(0, ...xs) - 5; minY = Math.min(0, ...ys) - 5;
                      maxX = Math.max(20, ...xs) + 5; maxY = Math.max(20, ...ys) + 5;
                    }
                    const w = maxX - minX, h = maxY - minY;
                    return (
                      <svg viewBox={`${minX} ${minY} ${w} ${h}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                        <defs>
                          <pattern id="bvSG" width="1" height="1" patternUnits="userSpaceOnUse">
                            <path d="M 1 0 L 0 0 0 1" fill="none" stroke={isDark ? "rgba(30,41,59,0.8)" : "#e2e8f0"} strokeWidth="0.05" />
                          </pattern>
                          <pattern id="bvG" width="5" height="5" patternUnits="userSpaceOnUse">
                            <rect width="5" height="5" fill="url(#bvSG)" />
                            <path d="M 5 0 L 0 0 0 5" fill="none" stroke={isDark ? "rgba(51,65,85,0.6)" : "#cbd5e1"} strokeWidth="0.1" />
                          </pattern>
                        </defs>
                        <rect x={minX} y={minY} width={w} height={h} fill="url(#bvG)" />
                        <line x1={minX} y1={0} x2={maxX} y2={0} stroke="rgba(244,63,94,0.5)" strokeWidth="0.18" />
                        <line x1={0} y1={minY} x2={0} y2={maxY} stroke="rgba(6,182,212,0.5)" strokeWidth="0.18" />
                        {mapOverview.map(cam => {
                          const cal = cam.calibration; const sel = cam.cam_id === calibCamId;
                          if (!cal) return null;
                          return (
                            <g key={cam.cam_id}>
                              {cal.fov_polygon && (
                                <polygon points={cal.fov_polygon.map((p: any) => `${p[0]},${p[1]}`).join(' ')}
                                  fill={sel ? (isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.2)') : (isDark ? 'rgba(51,65,85,0.3)' : 'rgba(203,213,225,0.4)')}
                                  stroke={sel ? '#6366f1' : (isDark ? 'rgba(71,85,105,0.8)' : '#94a3b8')} strokeWidth="0.15" />
                              )}
                              {cal.cam_x !== undefined && <g transform={`translate(${cal.cam_x},${cal.cam_y})`}>
                                <circle cx={0} cy={0} r="0.8" fill={sel ? '#6366f1' : (isDark ? '#334155' : '#64748b')} />
                                <text x={1.2} y={0.5} fontSize="1.2" fill={sel ? '#6366f1' : (isDark ? '#94a3b8' : '#334155')} fontWeight="bold">{cam.name}</text>
                              </g>}
                            </g>
                          );
                        })}
                        {calibSrcPoints.map((_, i) => (
                          <g key={i}>
                            <circle cx={calibDstPoints[i][0]} cy={calibDstPoints[i][1]} r="0.4" fill={C.amber} />
                            <text x={calibDstPoints[i][0] + 0.6} y={calibDstPoints[i][1] + 0.3} fill={C.amber} fontSize="0.8" fontWeight="bold">P{i+1}</text>
                          </g>
                        ))}
                        <g transform={`translate(${camX},${camY})`}>
                          <circle cx={0} cy={0} r="0.8" fill={C.rose} stroke={isDark ? "#090a0f" : "#ffffff"} strokeWidth="0.2" />
                          <text x={1} y={-1} fill={C.rose} fontSize="0.8" fontWeight="bold">Cam (Mới)</text>
                        </g>
                      </svg>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── AUTH MODAL ──────────────────────────────────────────────────────── */}
      {showAuthModal && (
        <div style={modalOverlay}>
          <form onSubmit={e => { e.preventDefault(); handleApplyCameraAuth(); }} style={{ ...modalCard, width: '420px' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: C.textPrimary, fontWeight: 700 }}>
              Xác thực luồng RTSP
            </h3>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Hãng Camera</label>
              <select value={cameraBrand} onChange={e => setCameraBrand(e.target.value)} style={selectStyle} {...focusHandlers}>
                <option value="hikvision">Hikvision</option>
                <option value="dahua">Dahua</option>
                <option value="custom">Tùy chỉnh (Link RTSP đầy đủ)</option>
              </select>
            </div>
            {cameraBrand !== 'custom' ? (
              <>
                <div style={{ marginBottom: '14px' }}>
                  <label style={labelStyle}>Tài khoản</label>
                  <input type="text" value={authUsername} onChange={e => setAuthUsername(e.target.value)} style={inputStyle} {...focusHandlers} />
                </div>
                <div style={{ marginBottom: '22px' }}>
                  <label style={labelStyle}>Mật khẩu</label>
                  <div style={{ position: 'relative' }}>
                    <input type={showPassword ? 'text' : 'password'} value={authPassword} onChange={e => setAuthPassword(e.target.value)} style={inputStyle} {...focusHandlers} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ marginBottom: '22px', padding: '12px', background: C.accentDim, borderRadius: '8px', fontSize: '12px', color: C.accentL, border: `1px solid ${C.accentBorder}`, fontFamily: 'monospace' }}>
                Sử dụng nguyên bản đường dẫn RTSP bạn đã nhập.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAuthModal(false)} style={{ padding: '9px 18px', borderRadius: '8px', border: `1px solid ${C.borderHard}`, background: 'transparent', cursor: 'pointer', color: C.textLabel, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '13px' }}>Hủy</button>
              <GradientBtn isDark={isDark}>Xác nhận</GradientBtn>
            </div>
          </form>
        </div>
      )}

      {/* ── EDIT MODAL ──────────────────────────────────────────────────────── */}
      {editCamModal.open && (
        <div style={modalOverlay}>
          <form onSubmit={handleSaveEditCamera} style={{ ...modalCard, width: '460px' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '16px', color: C.textPrimary, fontWeight: 700 }}>
              Chỉnh sửa thông tin Camera
            </h3>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Tên Camera</label>
              <input type="text" value={editCamModal.name} onChange={e => setEditCamModal({ ...editCamModal, name: e.target.value })} style={inputStyle} {...focusHandlers} required />
            </div>
            <div style={{ marginBottom: '22px' }}>
              <label style={labelStyle}>RTSP URL / IP Address</label>
              <input type="text" value={editCamModal.url} onChange={e => setEditCamModal({ ...editCamModal, url: e.target.value })} style={inputStyle} {...focusHandlers} required />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setEditCamModal({ open: false, id: '', name: '', url: '' })} style={{ padding: '9px 18px', borderRadius: '8px', border: `1px solid ${C.borderHard}`, background: 'transparent', cursor: 'pointer', color: C.textLabel, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: '13px' }}>Hủy</button>
              <GradientBtn isDark={isDark}>Lưu Thay Đổi</GradientBtn>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
