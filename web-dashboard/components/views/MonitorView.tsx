'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLanguage } from '../LanguageContext';
import { useCameras, Camera } from '../CameraContext';
import { useAppTheme } from '../ThemeContext';
import { Activity, ShieldAlert, Users, Layers, AlertCircle, ArrowRightLeft, Radio } from 'lucide-react';

type TrackedObject = {
  id: number;
  local_id?: number;
  class: string;
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
  floor_x?: number;
  floor_y?: number;
  confidence?: number;
};

type LiveAlert = {
  cam_id: string;
  global_id: number;
  rule_type: string;
  severity: string;
  description: string;
  timestamp: number;
};

type InterpolatedTrack = {
  id: number;
  class?: string;
  label?: string;
  curX: number;
  curY: number;
  curW: number;
  curH: number;
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  floorX: number;
  floorY: number;
  lastUpdated: number;
};

type InterpolatedFloorTrack = {
  id: number;
  class?: string;
  curFx: number;
  curFy: number;
  targetFx: number;
  targetFy: number;
  cam: string;
  lastUpdated: number;
};

type ROIState = {
  roi_id: string;
  name: string;
  status: 'OCCUPIED' | 'EMPTY';
  overlap_ratio: number;
  occupant_ids: number[];
  polygon: number[][];
  rule_type: string;
  threshold?: number;
};

function CameraStreamCard({
  cam,
  hostName,
  isVisible,
  activeTab,
  metadataMap,
  roisMap
}: {
  cam: Camera;
  hostName: string;
  isVisible: boolean;
  activeTab: string;
  metadataMap: React.MutableRefObject<Map<string, Map<number, InterpolatedTrack>>>;
  roisMap: React.MutableRefObject<Map<string, ROIState[]>>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // 1. Ultra-Low-Latency Direct WHEP WebRTC Connection
  useEffect(() => {
    let isCancelled = false;
    let reconnectTimeout: any = null;

    const connectWHEP = async () => {
      if (pcRef.current) {
        try { pcRef.current.close(); } catch (e) {}
        pcRef.current = null;
      }

      try {
        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            videoRef.current.play().catch(() => {});
            setIsPlaying(true);
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
            setIsPlaying(false);
            if (!isCancelled) {
              clearTimeout(reconnectTimeout);
              reconnectTimeout = setTimeout(connectWHEP, 1500);
            }
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Fetch WHEP Answer from MediaMTX
        const whepUrl = `http://${hostName}:8081/${cam.id}/whep`;
        const res = await fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offer.sdp
        });

        if (!res.ok) {
          throw new Error(`WHEP HTTP ${res.status}`);
        }

        const answerSdp = await res.text();
        if (!isCancelled && pc.signalingState !== 'closed') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
        }
      } catch (err) {
        if (!isCancelled) {
          // Fallback to clean iframe if direct WHEP endpoint fails
          setUseIframeFallback(true);
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connectWHEP, 4000);
        }
      }
    };

    connectWHEP();

    return () => {
      isCancelled = true;
      clearTimeout(reconnectTimeout);
      if (pcRef.current) {
        try { pcRef.current.close(); } catch (e) {}
        pcRef.current = null;
      }
    };
  }, [cam.id, hostName]);

  // 2. 60 FPS Real-time Tracking & ROI Canvas Render
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        const rect = container.getBoundingClientRect();
        if (canvas.width !== rect.width || canvas.height !== rect.height) {
          canvas.width = rect.width;
          canvas.height = rect.height;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          // --- A. Render Active ROI Zones (EMPTY: Cyan / CARFULL: Rose) ---
          const camRois = roisMap.current?.get(cam.id) || [];
          camRois.forEach(roi => {
            if (!roi.polygon || roi.polygon.length < 3) return;
            const isCarFull = (roi.status as string) === 'CARFULL' || roi.status === 'OCCUPIED';
            const strokeColor = isCarFull ? '#f43f5e' : '#22d3ee';
            const fillColor = isCarFull ? 'rgba(244, 63, 94, 0.30)' : 'rgba(34, 211, 238, 0.12)';

            ctx.save();
            ctx.beginPath();
            roi.polygon.forEach((pt, idx) => {
              const x = pt[0] * canvas.width;
              const y = pt[1] * canvas.height;
              if (idx === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.closePath();
            ctx.lineWidth = isCarFull ? 2.5 : 1.5;
            ctx.strokeStyle = strokeColor;
            ctx.shadowColor = strokeColor;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = fillColor;
            ctx.fill();

            // Draw ROI Status Badge Tag
            const firstPt = roi.polygon[0];
            const tagX = Math.max(4, Math.min(canvas.width - 220, firstPt[0] * canvas.width));
            const tagY = Math.max(22, firstPt[1] * canvas.height);
            const tagText = isCarFull
              ? `⚠ ${roi.name} · CARFULL`
              : `${roi.name} · EMPTY`;

            ctx.font = 'bold 12px "Space Grotesk", Inter, sans-serif';
            const metrics = ctx.measureText(tagText);
            const bgW = metrics.width + 16;
            const bgH = 22;
            const bgY = Math.max(0, tagY - bgH - 4);

            // Rounded pill badge
            ctx.fillStyle = isCarFull ? 'rgba(244, 63, 94, 0.92)' : 'rgba(34, 211, 238, 0.15)';
            ctx.strokeStyle = isCarFull ? '#f43f5e' : '#22d3ee';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(tagX, bgY, bgW, bgH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = isCarFull ? '#fff' : '#22d3ee';
            ctx.shadowBlur = 0;
            ctx.fillText(tagText, tagX + 8, bgY + 14.5);
            ctx.restore();
          });

          // --- B. Render Tracked Objects (BBox + Tags) ---
          const camTracks = metadataMap.current.get(cam.id);
          const now = Date.now();

          if (camTracks) {
            camTracks.forEach((track, id) => {
              const age = now - track.lastUpdated;
              if (age > 800) {
                camTracks.delete(id);
                return;
              }

              // Smooth lerp
              const lerpFactor = 0.25;
              track.curX += (track.targetX - track.curX) * lerpFactor;
              track.curY += (track.targetY - track.curY) * lerpFactor;
              track.curW += (track.targetW - track.curW) * lerpFactor;
              track.curH += (track.targetH - track.curH) * lerpFactor;

              const px = track.curX * canvas.width;
              const py = track.curY * canvas.height;
              const pw = track.curW * canvas.width;
              const ph = track.curH * canvas.height;

              // Class & label formatting
              const rawClass = (track.label || track.class || 'Object').toLowerCase();
              const isRobot = rawClass.includes('robot');
              const isRack = rawClass.includes('rack');
              const displayClass = isRobot ? 'delivery-robot' : (isRack ? 'rack' : rawClass);
              const label = `${displayClass} #${track.id}`;

              // Cinder accent colors
              const strokeColor = isRobot ? '#f43f5e' : '#6366f1';
              const fillColor = isRobot ? 'rgba(244, 63, 94, 0.20)' : 'rgba(99, 102, 241, 0.15)';

              ctx.save();
              ctx.strokeStyle = strokeColor;
              ctx.lineWidth = 1.5;
              ctx.shadowColor = strokeColor;
              ctx.shadowBlur = 10;
              ctx.strokeRect(px, py, pw, ph);
              ctx.shadowBlur = 0;

              ctx.fillStyle = fillColor;
              ctx.fillRect(px, py, pw, ph);

              // Label Tag Badge
              ctx.font = '12px "JetBrains Mono", "Space Grotesk", monospace';
              const textMetrics = ctx.measureText(label);
              const tagW = textMetrics.width + 12;
              const tagH = 18;
              const tagY = Math.max(0, py - tagH);

              ctx.fillStyle = isRobot ? 'rgba(244, 63, 94, 0.90)' : 'rgba(99, 102, 241, 0.90)';
              ctx.beginPath();
              ctx.roundRect(px, tagY, tagW, tagH, [3, 3, 3, 0]);
              ctx.fill();

              ctx.fillStyle = '#ffffff';
              ctx.fillText(label, px + 6, tagY + 12.5);
              ctx.restore();
            });
          }
        }
      }
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [cam.id, metadataMap, roisMap]);

  return (
    <div
      className="video-card-fms"
      style={{
        display: isVisible ? 'flex' : 'none',
        flexDirection: 'column',
        borderRadius: '10px',
        overflow: 'hidden',
        border: '1px solid #2a2a38',
        background: '#18181d',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        ...(activeTab !== 'all' ? { width: '100%', maxWidth: '1200px', margin: '0 auto' } : {})
      }}
    >
      {/* Card Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 14px',
        background: '#1f1f27',
        borderBottom: '1px solid #2a2a38',
        color: '#f4f4f5'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
            background: '#22d3ee', boxShadow: '0 0 8px #22d3ee'
          }}></span>
          <span style={{ fontWeight: 600, fontSize: '13px', letterSpacing: '0.01em' }}>{cam.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontSize: '10px', background: 'rgba(99,102,241,0.15)', color: '#818cf8',
            padding: '2px 8px', borderRadius: '4px', fontWeight: 600,
            border: '1px solid rgba(99,102,241,0.3)', fontFamily: 'monospace'
          }}>
            WHEP · WebRTC
          </span>
          <span style={{ fontSize: '10px', color: '#52525b', fontFamily: 'monospace' }}>&lt; 25ms</span>
        </div>
      </div>

      <div className="video-frame" ref={containerRef} style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#09090b', overflow: 'hidden' }}>
        {useIframeFallback ? (
          <iframe
            src={`http://${hostName}:8081/${cam.id}/?controls=0&autoplay=1&muted=1&playsinline=1`}
            style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', top: 0, left: 0 }}
            title={cam.name}
            scrolling="no"
          />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              position: 'absolute',
              top: 0,
              left: 0,
              background: '#09090b'
            }}
          />
        )}

        {/* Loading Spinner */}
        {!isPlaying && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(9, 9, 11, 0.85)', zIndex: 5, gap: '10px'
          }}>
            <div style={{
              width: '26px', height: '26px',
              border: '2px solid #2a2a38', borderTopColor: '#6366f1',
              borderRadius: '50%', animation: 'spin 1s linear infinite'
            }} />
            <span style={{ fontSize: '11px', color: '#52525b', fontFamily: 'monospace' }}>Đang kết nối luồng camera...</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 10
          }}
        />
      </div>
    </div>
  );
}

export default function MonitorView() {
  const { cameras } = useCameras();
  const [activeTab, setActiveTab] = useState('all');
  const [hostName, setHostName] = useState('localhost');
  const [totalDetections, setTotalDetections] = useState(0);
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);
  const [globalTrackList, setGlobalTrackList] = useState<{ id: number; fx: number; fy: number; cam: string; class?: string }[]>([]);
  const [floorTracks, setFloorTracks] = useState<InterpolatedFloorTrack[]>([]);
  const [mapOverview, setMapOverview] = useState<any[]>([]);
  const [cameraRois, setCameraRois] = useState<Record<string, ROIState[]>>({});
  const { t } = useLanguage();

  const metadataMap = useRef<Map<string, Map<number, InterpolatedTrack>>>(new Map());
  const floorTrackMap = useRef<Map<number, InterpolatedFloorTrack>>(new Map());
  const roisMap = useRef<Map<string, ROIState[]>>(new Map());

  // 60 FPS Smooth Interpolation Loop for Floor Plan
  useEffect(() => {
    let animId: number;
    const renderFloor = () => {
      const now = Date.now();
      const active: InterpolatedFloorTrack[] = [];

      floorTrackMap.current.forEach((t, id) => {
        if (now - t.lastUpdated > 1200) {
          floorTrackMap.current.delete(id);
          return;
        }
        const lerpFactor = 0.20;
        t.curFx += (t.targetFx - t.curFx) * lerpFactor;
        t.curFy += (t.targetFy - t.curFy) * lerpFactor;
        active.push({ ...t });
      });

      setFloorTracks(active);
      animId = requestAnimationFrame(renderFloor);
    };

    animId = requestAnimationFrame(renderFloor);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Fetch map overview calibration polygons
  useEffect(() => {
    fetch('/api/backend/calibration/map-overview')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.calibrations) setMapOverview(data.calibrations);
      })
      .catch(() => {});
  }, [cameras]);

  // WebSockets for Metadata & Events
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname || 'localhost';
      setHostName(host);

      let wsMeta: WebSocket | null = null;
      let wsEvents: WebSocket | null = null;

      const connectMeta = () => {
        wsMeta = new WebSocket(`ws://${host}:8000/ws/metadata`);
        wsMeta.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.streams && Array.isArray(data.streams)) {
              let count = 0;
              const now = Date.now();
              const activeGlobals: { id: number; fx: number; fy: number; cam: string; class?: string }[] = [];

              data.streams.forEach((stream: { cam_id: string; objects: TrackedObject[]; rois?: ROIState[] }) => {
                const camId = stream.cam_id;

                if (stream.rois && Array.isArray(stream.rois)) {
                  roisMap.current.set(camId, stream.rois);
                }

                if (!metadataMap.current.has(camId)) {
                  metadataMap.current.set(camId, new Map());
                }
                const tracks = metadataMap.current.get(camId)!;

                stream.objects.forEach(obj => {
                  count++;
                  const fx = obj.floor_x ?? (obj.x + obj.w / 2);
                  const fy = obj.floor_y ?? (obj.y + obj.h);
                  activeGlobals.push({ id: obj.id, fx, fy, cam: camId, class: obj.class });

                  if (!floorTrackMap.current.has(obj.id)) {
                    floorTrackMap.current.set(obj.id, {
                      id: obj.id, class: obj.class,
                      curFx: fx, curFy: fy,
                      targetFx: fx, targetFy: fy,
                      cam: camId, lastUpdated: now
                    });
                  } else {
                    const ft = floorTrackMap.current.get(obj.id)!;
                    if (obj.class) ft.class = obj.class;
                    ft.targetFx = fx; ft.targetFy = fy;
                    ft.cam = camId; ft.lastUpdated = now;
                  }

                  if (!tracks.has(obj.id)) {
                    tracks.set(obj.id, {
                      id: obj.id, class: obj.class,
                      curX: obj.x, curY: obj.y, curW: obj.w, curH: obj.h,
                      targetX: obj.x, targetY: obj.y, targetW: obj.w, targetH: obj.h,
                      floorX: fx, floorY: fy, lastUpdated: now
                    });
                  } else {
                    const track = tracks.get(obj.id)!;
                    track.class = obj.class;
                    track.targetX = obj.x; track.targetY = obj.y;
                    track.targetW = obj.w; track.targetH = obj.h;
                    track.floorX = fx; track.floorY = fy;
                    track.lastUpdated = now;
                  }
                });
              });

              setTotalDetections(count);
              setGlobalTrackList(activeGlobals);
              setCameraRois(Object.fromEntries(roisMap.current));
            }
          } catch (e) {}
        };
        wsMeta.onclose = () => setTimeout(connectMeta, 2500);
      };

      const connectEvents = () => {
        wsEvents = new WebSocket(`ws://${host}:8000/ws/events`);
        wsEvents.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.event) {
              setLiveAlerts(prev => [data.event, ...prev].slice(0, 30));
            }
          } catch (e) {}
        };
        wsEvents.onclose = () => setTimeout(connectEvents, 2500);
      };

      connectMeta();
      connectEvents();

      return () => {
        if (wsMeta) wsMeta.close();
        if (wsEvents) wsEvents.close();
      };
    }
  }, []);

  const { colors: C, isDark } = useAppTheme();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, transition: 'background-color 0.2s ease' }}>

      {/* Top Monitor Navigation */}
      <div style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: '12px 20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setActiveTab('all')}
              style={{
                padding: '7px 14px', borderRadius: '7px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600,
                border: activeTab === 'all' ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                background: activeTab === 'all' ? C.accentDim : 'transparent',
                color: activeTab === 'all' ? C.accentGlow : C.textSecondary,
                boxShadow: activeTab === 'all' ? `0 0 12px ${C.accentGlow}` : 'none',
                transition: 'all 0.2s'
              }}
            >
              {t.monitor.allCamera} ({cameras.length})
            </button>
            {cameras.map(c => (
              <button
                key={c.id}
                onClick={() => setActiveTab(c.id)}
                style={{
                  padding: '7px 14px', borderRadius: '7px', cursor: 'pointer',
                  fontSize: '12px', fontWeight: 600,
                  border: activeTab === c.id ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                  background: activeTab === c.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: activeTab === c.id ? C.accentGlow : C.textSecondary,
                  boxShadow: activeTab === c.id ? `0 0 12px rgba(99,102,241,0.2)` : 'none',
                  transition: 'all 0.2s'
                }}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* MTMC Status Badge */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(34,211,238,0.08)',
            border: '1px solid rgba(34,211,238,0.25)',
            padding: '5px 12px', borderRadius: '20px'
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: C.cyan, animation: 'pulse 2s infinite',
              boxShadow: `0 0 8px ${C.cyan}`
            }}></span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: C.cyan, fontFamily: 'monospace' }}>
              MTMC FUSION ACTIVE
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, padding: '20px', display: 'flex', gap: '20px', overflow: 'hidden' }}>
        {cameras.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.textMuted }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: '16px',
              background: 'rgba(99,102,241,0.1)', border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '16px'
            }}>
              <Activity size={28} color={C.textMuted} />
            </div>
            <p style={{ fontSize: '18px', fontWeight: 600, color: C.textSecondary }}>{t.monitor.noCamera}</p>
            <p style={{ fontSize: '13px', color: C.textMuted, marginTop: '8px', textAlign: 'center' }}>
              Chuyển sang tab <b style={{ color: C.accentGlow }}>Building</b> để thêm Camera RTSP và thiết lập Calibration
            </p>
          </div>
        ) : (
          <>
            {/* Left: Video Grid */}
            <div style={{ flex: 3, overflowY: 'auto', paddingRight: '6px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: activeTab === 'all' ? 'repeat(auto-fit, minmax(400px, 1fr))' : '1fr',
                gap: '16px'
              }}>
                {cameras.map(cam => (
                  <CameraStreamCard
                    key={cam.id}
                    cam={cam}
                    hostName={hostName}
                    isVisible={activeTab === 'all' || activeTab === cam.id}
                    activeTab={activeTab}
                    metadataMap={metadataMap}
                    roisMap={roisMap}
                  />
                ))}
              </div>
            </div>

            {/* Right: Side Panel */}
            <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '320px' }}>

              {/* SINGLE CAMERA: ROI Bay Status */}
              {activeTab !== 'all' ? (
                <div style={{
                  background: C.surface,
                  borderRadius: '12px', padding: '20px',
                  border: `1px solid ${C.border}`,
                  display: 'flex', flexDirection: 'column', gap: '16px'
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: `1px solid ${C.border}`, paddingBottom: '12px'
                  }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: C.textPrimary }}>
                        Trạng Thái Ô Chứa Hàng
                      </h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: C.textMuted }}>
                        Camera: <b style={{ color: C.accentGlow }}>{cameras.find(c => c.id === activeTab)?.name || activeTab}</b>
                      </p>
                    </div>
                    <span style={{
                      fontSize: '10px', background: 'rgba(99,102,241,0.12)',
                      color: C.accentGlow, padding: '3px 8px', borderRadius: '5px',
                      fontWeight: 600, fontFamily: 'monospace',
                      border: '1px solid rgba(99,102,241,0.25)'
                    }}>
                      REAL-TIME
                    </span>
                  </div>

                  {(!cameraRois[activeTab] || cameraRois[activeTab].length === 0) ? (
                    <div style={{
                      padding: '32px 20px', textAlign: 'center',
                      color: C.textMuted, fontSize: '13px',
                      background: C.card, borderRadius: '10px',
                      border: `1px dashed ${C.border}`
                    }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600, color: C.textSecondary }}>Chưa có vùng ROI nào</p>
                      Chuyển sang tab <b style={{ color: C.accentGlow }}>Building</b> &rarr; <b>Cấu hình Phân tích Hành vi</b> để vẽ vùng ô chứa hàng.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {cameraRois[activeTab].map(r => {
                        const isCarFull = (r.status as string) === 'CARFULL' || r.status === 'OCCUPIED';
                        return (
                          <div
                            key={r.roi_id}
                            style={{
                              padding: '16px',
                              borderRadius: '10px',
                              background: isCarFull
                                ? 'rgba(244, 63, 94, 0.08)'
                                : 'rgba(34, 211, 238, 0.06)',
                              border: `1px solid ${isCarFull ? 'rgba(244,63,94,0.35)' : 'rgba(34,211,238,0.25)'}`,
                              boxShadow: isCarFull
                                ? '0 0 20px rgba(244,63,94,0.12)'
                                : '0 0 20px rgba(34,211,238,0.08)',
                              display: 'flex', flexDirection: 'column', gap: '10px',
                              transition: 'all 0.3s ease'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, fontSize: '13px', color: C.textPrimary, fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                                VỊ TRÍ · {r.name}
                              </span>
                            </div>

                            {/* Status Badge */}
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              padding: '10px 16px', borderRadius: '8px',
                              background: isCarFull ? 'rgba(244,63,94,0.18)' : 'rgba(34,211,238,0.12)',
                              color: isCarFull ? '#fb7185' : '#67e8f9',
                              fontWeight: 700, fontSize: '14px',
                              letterSpacing: '0.08em', fontFamily: 'monospace',
                              border: `1px solid ${isCarFull ? 'rgba(244,63,94,0.4)' : 'rgba(34,211,238,0.3)'}`,
                              textShadow: isCarFull ? '0 0 12px rgba(244,63,94,0.5)' : '0 0 12px rgba(34,211,238,0.5)'
                            }}>
                              {isCarFull ? '⚠ CÓ HÀNG — CARFULL' : '◎ TRỐNG — EMPTY'}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: C.textMuted }}>
                              <span>{isCarFull ? 'Chiếm dụng bởi:' : 'Tình trạng:'}</span>
                              <span style={{ fontWeight: 600, color: isCarFull ? '#fb7185' : '#67e8f9', fontFamily: 'monospace' }}>
                                {isCarFull
                                  ? (r.occupant_ids && r.occupant_ids.length > 0 ? r.occupant_ids.map(id => `#${id}`).join(', ') : 'Có vật thể / xe')
                                  : 'Sẵn sàng tiếp nhận'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* ALL CAMERAS: Floor Map + Alerts */
                <>
                  {/* 2D Floor Plan */}
                  <div style={{
                    background: C.surface, borderRadius: '12px', padding: '14px',
                    border: `1px solid ${C.border}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 600, color: C.textPrimary, fontSize: '13px' }}>
                        <Layers size={16} color={C.accent} /> 2D Floor Plan Tracker
                      </div>
                      <span style={{
                        fontSize: '10px', background: 'rgba(99,102,241,0.12)', color: C.accentGlow,
                        padding: '2px 7px', borderRadius: '4px', fontWeight: 600, fontFamily: 'monospace',
                        border: '1px solid rgba(99,102,241,0.25)'
                      }}>
                        HOMOGRAPHY
                      </span>
                    </div>
                    {/* 2D SVG Map */}
                    <div style={{
                      position: 'relative', width: '100%', height: '260px',
                      background: isDark ? '#09090b' : '#f1f5f9', borderRadius: '8px',
                      border: `1px solid ${C.border}`, overflow: 'hidden'
                    }}>
                      {(() => {
                        let minX = -3, minY = -3, maxX = 25, maxY = 12;
                        const allPoints: number[][] = [[0, 0], [18, 0], [18, 8], [0, 8]];

                        if (mapOverview && mapOverview.length > 0) {
                          mapOverview.forEach(m => {
                            const cal = m.calibration;
                            if (cal) {
                              if (cal.cam_x !== undefined) allPoints.push([cal.cam_x, cal.cam_y || 0]);
                              if (cal.fov_polygon && Array.isArray(cal.fov_polygon)) {
                                allPoints.push(...cal.fov_polygon);
                              }
                            }
                          });
                        }

                        cameras.forEach(c => {
                          if (c.cam_x !== undefined && c.cam_x !== null) {
                            allPoints.push([c.cam_x, c.cam_y || 0]);
                          }
                        });

                        floorTracks.forEach(t => {
                          if (t.curFx !== undefined && t.curFy !== undefined) {
                            allPoints.push([t.curFx, t.curFy]);
                          }
                        });

                        if (allPoints.length > 0) {
                          const xs = allPoints.map(p => p[0]);
                          const ys = allPoints.map(p => p[1]);
                          minX = Math.min(-3, ...xs) - 2;
                          minY = Math.min(-3, ...ys) - 2;
                          maxX = Math.max(22, ...xs) + 3;
                          maxY = Math.max(10, ...ys) + 3;
                        }

                        const width = Math.max(10, maxX - minX);
                        const height = Math.max(10, maxY - minY);
                        const vBox = `${minX} ${minY} ${width} ${height}`;

                        return (
                          <svg viewBox={vBox} style={{ width: '100%', height: '100%', display: 'block' }}>
                            <defs>
                              <pattern id="monSmallGrid" width="1" height="1" patternUnits="userSpaceOnUse">
                                <path d="M 1 0 L 0 0 0 1" fill="none" stroke={isDark ? "#1a1a22" : "#e2e8f0"} strokeWidth="0.05" />
                              </pattern>
                              <pattern id="monGrid" width="5" height="5" patternUnits="userSpaceOnUse">
                                <rect width="5" height="5" fill="url(#monSmallGrid)" />
                                <path d="M 5 0 L 0 0 0 5" fill="none" stroke={isDark ? "#2a2a38" : "#cbd5e1"} strokeWidth="0.1" />
                              </pattern>
                            </defs>
                            <rect x={minX} y={minY} width={width} height={height} fill="url(#monGrid)" />

                            {/* Axes */}
                            <line x1={minX} y1={0} x2={maxX} y2={0} stroke="rgba(244,63,94,0.4)" strokeWidth="0.12" strokeDasharray="0.6 0.6" />
                            <line x1={0} y1={minY} x2={0} y2={maxY} stroke="rgba(6,182,212,0.4)" strokeWidth="0.12" strokeDasharray="0.6 0.6" />

                            {/* Area boundary */}
                            <rect x={0} y={0} width={18} height={8} fill="rgba(99,102,241,0.06)" stroke="#6366f1" strokeWidth="0.1" strokeDasharray="0.5 0.5" />
                            <text x={9} y={-0.5} fontSize="0.7" fill={isDark ? "#52525b" : "#64748b"} textAnchor="middle" fontWeight="bold">18m (Trục X)</text>
                            <text x={-0.6} y={4} fontSize="0.7" fill={isDark ? "#52525b" : "#64748b"} textAnchor="middle" fontWeight="bold" transform="rotate(-90 -0.6 4)">8m (Y)</text>

                            {/* FOV Polygons */}
                            {mapOverview.map(cam => {
                              const cal = cam.calibration;
                              if (!cal || !cal.fov_polygon || !Array.isArray(cal.fov_polygon)) return null;
                              return (
                                <polygon
                                  key={`fov-${cam.cam_id}`}
                                  points={cal.fov_polygon.map((p: any) => `${p[0]},${p[1]}`).join(' ')}
                                  fill="rgba(99,102,241,0.08)"
                                  stroke="#6366f1"
                                  strokeWidth="0.08"
                                />
                              );
                            })}

                            {/* Camera Pins */}
                            {cameras.map(c => {
                              const camCal = mapOverview.find(m => m.cam_id === c.id)?.calibration;
                              const cx = c.cam_x ?? camCal?.cam_x ?? 0;
                              const cy = c.cam_y ?? camCal?.cam_y ?? 0;
                              return (
                                <g key={c.id} transform={`translate(${cx}, ${cy})`}>
                                  <circle cx={0} cy={0} r="0.6" fill="none" stroke="#22d3ee" strokeWidth="0.1" opacity="0.5" />
                                  <circle cx={0} cy={0} r="0.35" fill="#22d3ee" stroke="#09090b" strokeWidth="0.12" />
                                  <rect x={0.7} y={-0.45} width={c.name.length * 0.48 + 3.5} height={0.85} rx={0.15} fill="rgba(9,9,11,0.88)" stroke="#2a2a38" strokeWidth="0.05" />
                                  <text x={0.9} y={0.08} fontSize="0.5" fill="#22d3ee" fontWeight="bold">
                                    {c.name} ({cx}m, {cy}m)
                                  </text>
                                </g>
                              );
                            })}

                            {/* Real-time Tracks */}
                            {floorTracks.map(t => {
                              const rawClass = (t.class || '').toLowerCase();
                              const isRobot = rawClass.includes('robot');
                              const color = isRobot ? '#f43f5e' : '#6366f1';
                              const displayClass = isRobot ? 'delivery-robot' : (rawClass.includes('rack') ? 'rack' : (t.class || 'Object'));
                              const label = `${displayClass} #${t.id} (${t.curFx.toFixed(1)}m, ${t.curFy.toFixed(1)}m)`;

                              return (
                                <g key={`track-${t.id}`} transform={`translate(${t.curFx}, ${t.curFy})`}>
                                  <circle cx={0} cy={0} r="1.0" fill="none" stroke={color} strokeWidth="0.08" opacity={0.5}>
                                    <animate attributeName="r" values="0.5;1.3;0.5" dur="1.8s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" values="0.7;0.1;0.7" dur="1.8s" repeatCount="indefinite" />
                                  </circle>
                                  <circle cx={0} cy={0} r="0.45" fill={color} stroke="#09090b" strokeWidth="0.1" />
                                  <rect x={0.7} y={-0.55} width={label.length * 0.4 + 0.4} height={0.9} rx={0.15} fill="rgba(9,9,11,0.9)" stroke={color} strokeWidth="0.06" />
                                  <text x={0.9} y={0.05} fontSize="0.5" fill="#f4f4f5" fontWeight="bold">
                                    {label}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Live Alerts Feed */}
                  <div style={{
                    background: C.surface, borderRadius: '12px', padding: '14px',
                    border: `1px solid ${C.border}`,
                    flex: 1, display: 'flex', flexDirection: 'column'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 600, color: C.textPrimary, fontSize: '13px' }}>
                        <ShieldAlert size={16} color={C.rose} /> Live Behavior Alarms
                      </div>
                      <span style={{ fontSize: '10px', color: C.textMuted, fontFamily: 'monospace' }}>PostgreSQL Sync</span>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px' }}>
                      {liveAlerts.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '12px' }}>
                          Chưa phát hiện sự kiện bất thường
                        </div>
                      ) : (
                        liveAlerts.map((ev, i) => {
                          const isIntrusion = ev.rule_type === 'intrusion';
                          const isTripwire = ev.rule_type === 'tripwire';
                          const accentColor = isIntrusion ? C.rose : isTripwire ? C.cyan : C.orange;
                          return (
                            <div
                              key={i}
                              style={{
                                padding: '9px 12px 9px 14px',
                                borderRadius: '7px',
                                background: C.card,
                                border: `1px solid ${C.border}`,
                                borderLeft: `3px solid ${accentColor}`,
                                fontSize: '12px'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: '3px' }}>
                                <span style={{ textTransform: 'uppercase', fontSize: '10px', color: accentColor, fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                                  {ev.rule_type}
                                </span>
                                <span style={{ color: C.textMuted, fontSize: '10px', fontFamily: 'monospace' }}>
                                  {new Date(ev.timestamp).toLocaleTimeString()}
                                </span>
                              </div>
                              <p style={{ margin: 0, color: C.textSecondary, lineHeight: 1.4 }}>{ev.description}</p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  );
}
