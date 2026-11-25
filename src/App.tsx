import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Download,
  ListFilter,
  Pause,
  Play,
  Sun,
  TrendingUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ConnectionMode,
  DEFAULT_SCANNER_CONFIG,
  ScannerConfig,
  ScannedAssetState,
  TrendAlert,
} from './lib/types';
import { AuthSuccessPayload, LoginScreen } from './components/LoginScreen';
import { ActiveTab, HeaderBar } from './components/HeaderBar';
import { CandlestickChart } from './components/CandlestickChart';
import { ScannerSidebar } from './components/ScannerSidebar';
import { AlertsHistoryView } from './components/AlertsHistoryView';
import { ScannerSettingsView } from './components/ScannerSettingsView';
import { DownloadInstallModal } from './components/DownloadInstallModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import {
  playTrendAlertChime,
  triggerSignalVibration,
  unlockAudioContext,
} from './utils/soundAlert';

interface SessionInfo {
  token: string;
  email: string;
  mode: ConnectionMode;
  iqConnected: boolean;
  iqStatusMessage?: string;
  scanningActive: boolean;
}

const DEFAULT_SLOTS = ['satsusd-otc', 'bitcoin-gold', 'usdcop-otc', 'sp-gold'];

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('scanner');
  const [config, setConfig] = useState<ScannerConfig>(DEFAULT_SCANNER_CONFIG);
  const [assets, setAssets] = useState<ScannedAssetState[]>([]);
  const [alerts, setAlerts] = useState<TrendAlert[]>([]);

  // 1-4 simultaneous charts state
  const [chartCount, setChartCount] = useState<1 | 2 | 3 | 4>(1);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(DEFAULT_SLOTS);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(0);

  const [liveBannerAlert, setLiveBannerAlert] = useState<TrendAlert | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'chart' | 'list'>('chart');
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const soundConfigRef = useRef({
    enabled: config.soundEnabled,
    volume: config.soundVolume,
    durationMode: config.soundDurationMode,
  });

  useEffect(() => {
    soundConfigRef.current = {
      enabled: config.soundEnabled,
      volume: config.soundVolume,
      durationMode: config.soundDurationMode,
    };
  }, [config.soundEnabled, config.soundVolume, config.soundDurationMode]);

  // Unlock Web Audio on first user touch/pointer interaction (critical on Android Chrome)
  useEffect(() => {
    const unlock = () => unlockAudioContext();
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('touchstart', unlock, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Screen Wake Lock for keeping Android screen awake while monitoring 1m charts
  useEffect(() => {
    if (!keepAwake || !wakeLockSupported) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const requestLock = async () => {
      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (nav.wakeLock) {
          const lock = await nav.wakeLock.request('screen');
          if (cancelled) {
            lock.release().catch(() => {});
          } else {
            wakeLockRef.current = lock;
          }
        }
      } catch {
        // ignore if battery saver or browser blocks wake lock
      }
    };

    requestLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && keepAwake) {
        requestLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [keepAwake, wakeLockSupported]);

  const handleAuthenticated = useCallback((payload: AuthSuccessPayload) => {
    setSession({
      token: payload.token,
      email: payload.email,
      mode: payload.mode,
      iqConnected: payload.iqConnected,
      iqStatusMessage: payload.iqStatusMessage,
      scanningActive: payload.scanningActive ?? true,
    });
    setConfig(payload.config);
  }, []);

  useEffect(() => {
    if (session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DEMO' }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.token) {
            handleAuthenticated(data);
          }
        })
        .catch(() => {});
    }
  }, [session, handleAuthenticated]);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const loadInitial = async () => {
      try {
        const res = await fetch('/api/scanner/state', {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.assets)) {
          setAssets(data.assets);
        }
        if (Array.isArray(data.alerts)) {
          setAlerts(data.alerts);
          const firstUnacked = data.alerts.find((a: TrendAlert) => !a.acknowledged);
          if (firstUnacked) {
            setLiveBannerAlert(firstUnacked);
          }
        }
        if (data.config) {
          setConfig(data.config);
        }
      } catch {
        // ignore transient errors
      }
    };

    const connectWs = () => {
      if (cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(
        session.token
      )}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!cancelled) setWsConnected(true);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'scanner:snapshot' && msg.payload) {
            if (Array.isArray(msg.payload.assets)) {
              setAssets(msg.payload.assets);
            }
            if (Array.isArray(msg.payload.alerts)) {
              setAlerts(msg.payload.alerts);
            }
            if (typeof msg.payload.iqConnected === 'boolean') {
              setSession((prev) =>
                prev
                  ? {
                      ...prev,
                      iqConnected: msg.payload.iqConnected,
                      iqStatusMessage: msg.payload.iqStatusMessage,
                    }
                  : prev
              );
            }
          } else if (msg.type === 'signal:detected' && msg.payload) {
            const newAlert = msg.payload as TrendAlert;
            setAlerts((prev) => [
              newAlert,
              ...prev.filter((item) => item.id !== newAlert.id),
            ]);
            setLiveBannerAlert(newAlert);
            triggerSignalVibration();
            if (soundConfigRef.current.enabled) {
              playTrendAlertChime(
                newAlert.direction,
                soundConfigRef.current.volume,
                soundConfigRef.current.durationMode
              );
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!cancelled) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    };

    loadInitial();
    connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [session?.token]);

  const handleSaveConfig = async (next: ScannerConfig) => {
    if (!session) return;
    const res = await fetch('/api/scanner/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.config) setConfig(data.config);
      if (Array.isArray(data.assets)) setAssets(data.assets);
    }
  };

  const handleFilterChange = (patch: Partial<ScannerConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    handleSaveConfig(next);
  };

  const handleToggleScan = async () => {
    if (!session) return;
    const nextActive = !session.scanningActive;
    setSession((prev) => (prev ? { ...prev, scanningActive: nextActive } : prev));
    try {
      await fetch('/api/scanner/toggle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ active: nextActive }),
      });
    } catch {
      // ignore
    }
  };

  const handleMarkDecision = async (
    alertId: string,
    decisionNote: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED'
  ) => {
    if (!session) return;
    const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/decision`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ acknowledged: true, decisionNote }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.alert) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? data.alert : a))
        );
        if (liveBannerAlert?.id === alertId) {
          setLiveBannerAlert(null);
        }
      }
    }
  };

  const handleLogout = async () => {
    if (session) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
    setSession(null);
    setAssets([]);
    setAlerts([]);
    setLiveBannerAlert(null);
    setWsConnected(false);
  };

  const handleSelectAssetForSlot = (assetId: string) => {
    setSelectedAssetIds((prev) => {
      const copy = [...prev];
      const slot = Math.min(activeSlotIndex, chartCount - 1);
      copy[slot] = assetId;
      return copy;
    });
    setMobilePanel('chart');
  };

  const visibleSlotAssets = useMemo(() => {
    if (assets.length === 0) return [];
    const byId = new Map(assets.map((a) => [a.asset.id, a]));
    const result: ScannedAssetState[] = [];
    for (let i = 0; i < chartCount; i++) {
      const wantedId = selectedAssetIds[i];
      const found =
        (wantedId ? byId.get(wantedId) : undefined) ??
        assets[i % assets.length];
      if (found) result.push(found);
    }
    return result;
  }, [assets, chartCount, selectedAssetIds]);

  const unacknowledgedCount = useMemo(
    () => alerts.filter((a) => !a.acknowledged).length,
    [alerts]
  );

  const matchCount = useMemo(
    () => assets.filter((a) => a.analysis.status === 'MATCH').length,
    [assets]
  );

  const secondsRemaining = visibleSlotAssets[0]?.secondsRemaining ?? 0;
  const nextMinuteText = useMemo(() => {
    const d = new Date(Date.now() + secondsRemaining * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
      2,
      '0'
    )}`;
  }, [secondsRemaining]);

  if (!session) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div
      data-state="authenticated"
      className="min-h-screen bg-[#090E1A] text-[#E6ECF5] flex flex-col"
    >
      <HeaderBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unacknowledgedCount={unacknowledgedCount}
        onLogout={handleLogout}
      />

      {/* Real-Time Alert Banner */}
      {liveBannerAlert && (
        <div
          role="status"
          className={`border-b px-4 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 ${
            liveBannerAlert.direction === 'UP'
              ? 'bg-emerald-950/75 border-emerald-500/40'
              : 'bg-rose-950/75 border-rose-500/40'
          }`}
        >
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <Bell
              className={`w-4 h-4 shrink-0 ${
                liveBannerAlert.direction === 'UP'
                  ? 'text-[#16C784]'
                  : 'text-[#F45B69]'
              }`}
            />
            <span className="font-semibold text-[#F8FAFC]">
              พบกราฟเข้าเงื่อนไข: {liveBannerAlert.assetName}
            </span>
            <span className="text-[#CBD5E1]">
              {liveBannerAlert.direction === 'UP'
                ? 'เทรนด์ไหลขาขึ้น (CALL)'
                : 'เทรนด์ไหลขาลง (PUT)'}{' '}
              · {liveBannerAlert.runLength} แท่ง · ไส้{' '}
              {(liveBannerAlert.avgWickRatio * 100).toFixed(0)}%
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                handleSelectAssetForSlot(liveBannerAlert.assetId);
                setActiveTab('scanner');
                handleMarkDecision(liveBannerAlert.id, 'WATCHED');
              }}
              className="px-3 py-1 text-xs font-medium rounded bg-[#162033] hover:bg-[#1E2B44] text-[#F8FAFC] cursor-pointer whitespace-nowrap"
            >
              เปิดดูกราฟ
            </button>
            <button
              type="button"
              onClick={() => handleMarkDecision(liveBannerAlert.id, 'WATCHED')}
              className="px-3 py-1 text-xs font-medium rounded border border-[#334155] text-[#CBD5E1] hover:text-white cursor-pointer whitespace-nowrap"
            >
              รับทราบ
            </button>
          </div>
        </div>
      )}

      {activeTab === 'scanner' && (
        <main className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Left / Center Chart Workspace */}
          <section className="flex-1 min-w-0 flex flex-col">
            {/* Broker-Style Control Strip matching user's 9 attached screenshots */}
            <div className="px-3 lg:px-5 py-2 border-b border-[#1D273B] bg-[#0D1422] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="px-2.5 py-1 rounded-lg bg-[#11192B] border border-[#23304A] text-[11px] sm:text-xs font-semibold text-[#E2E8F0]">
                    {session.mode === 'IQ_OPTION_LIVE'
                      ? `REAL · ${session.email}`
                      : 'DEMO สด'}
                  </div>

                  <span className="text-xs sm:text-sm font-bold font-mono-tabular text-[#F5C451] whitespace-nowrap">
                    แท่งใหม่ใน {String(secondsRemaining).padStart(2, '0')} วิ
                  </span>

                  <button
                    type="button"
                    onClick={handleToggleScan}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                      session.scanningActive
                        ? 'bg-[#2563EB] hover:bg-[#3B82F6]'
                        : 'bg-[#16C784] hover:bg-emerald-500 text-[#052E16]'
                    }`}
                  >
                    {session.scanningActive ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>หยุดสแกน</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>เริ่มสแกน</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Multi-Chart (1-4) Selector + Sound + WakeLock + Download Program */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <div
                    role="group"
                    aria-label="จำนวนกราฟที่แสดงพร้อมกัน"
                    className="flex items-center p-0.5 bg-[#0B111E] border border-[#1E293B] rounded-lg"
                  >
                    {([1, 2, 3, 4] as const).map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => {
                          setChartCount(cnt);
                          if (activeSlotIndex >= cnt) setActiveSlotIndex(0);
                        }}
                        className={`px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          chartCount === cnt
                            ? 'bg-[#2563EB] text-white'
                            : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                        }`}
                      >
                        {cnt} กราฟ
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      unlockAudioContext();
                      handleFilterChange({ soundEnabled: !config.soundEnabled });
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[11px] sm:text-xs text-[#E2E8F0] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    {config.soundEnabled ? (
                      <Volume2 className="w-3.5 h-3.5 text-[#16C784]" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 text-[#64748B]" />
                    )}
                    <span>{config.soundEnabled ? 'เสียงเตือน: เปิด' : 'เสียงเตือน: ปิด'}</span>
                  </button>

                  {wakeLockSupported && (
                    <button
                      type="button"
                      onClick={() => setKeepAwake((prev) => !prev)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] sm:text-xs inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                        keepAwake
                          ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                          : 'bg-[#162033] hover:bg-[#1E2B44] border-[#273652] text-[#CBD5E1]'
                      }`}
                      title="ป้องกันหน้าจอมือถือดับระหว่างเปิดสแกน"
                    >
                      <Sun className="w-3.5 h-3.5" />
                      <span>{keepAwake ? 'กันจอดับ: เปิด' : 'กันจอดับ'}</span>
                    </button>
                  )}

                  <PWAInstallButton compact />

                  <button
                    type="button"
                    onClick={() => setShowDownloadModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[11px] sm:text-xs font-medium text-[#60A5FA] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>ติดตั้ง / ดาวน์โหลด</span>
                  </button>
                </div>
              </div>

              {/* Scan Progress Line matching screenshot sub-bar */}
              <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    ดึงแท่งสำเร็จ {assets.length}/{assets.length} คู่
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    เกณฑ์ {config.targetMinCandles}–{config.targetMaxCandles} แท่ง (ไส้ ≤{' '}
                    {Math.round(config.maxWickRatio * 100)}%)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>รอแท่ง {nextMinuteText}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#E2E8F0] font-medium">
                    พบสัญญาณ {matchCount} คู่
                  </span>
                </div>
                <span>
                  {session.mode === 'IQ_OPTION_LIVE'
                    ? session.iqConnected
                      ? session.iqStatusMessage
                      : 'กำลังเชื่อม IQ Option...'
                    : wsConnected
                      ? 'สตรีมข้อมูล 1 นาทีออนไลน์'
                      : 'กำลังเชื่อมสตรีม...'}
                </span>
              </div>

              {/* Mobile Quick Switcher (Android/Portrait < lg) */}
              <div className="lg:hidden grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setMobilePanel('chart')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    mobilePanel === 'chart'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#0B111E] border border-[#1E293B] text-[#94A3B8]'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>กราฟสด ({chartCount} จอ)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMobilePanel('list')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    mobilePanel === 'list'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#0B111E] border border-[#1E293B] text-[#94A3B8]'
                  }`}
                >
                  <ListFilter className="w-3.5 h-3.5" />
                  <span>
                    รายชื่อคู่เงิน ({assets.length})
                    {matchCount > 0 ? ` · เข้า ${matchCount}` : ''}
                  </span>
                </button>
              </div>
            </div>

            {/* 1-4 Multi-Chart Viewport */}
            <div
              className={`flex-1 p-3 lg:p-4 overflow-y-auto ${
                mobilePanel === 'chart' ? 'block' : 'hidden lg:block'
              }`}
            >
              {visibleSlotAssets.length === 0 ? (
                <div className="h-[420px] rounded-xl border border-[#1E293B] bg-[#0D1422] flex items-center justify-center text-sm text-[#94A3B8]">
                  กำลังโหลดข้อมูลแท่งเทียน 1 นาที...
                </div>
              ) : (
                <div
                  data-testid="multi-chart-grid"
                  className={`grid gap-3.5 ${
                    chartCount === 1
                      ? 'grid-cols-1'
                      : 'grid-cols-1 xl:grid-cols-2'
                  }`}
                >
                  {visibleSlotAssets.map((assetState, idx) => (
                    <CandlestickChart
                      key={`${idx}-${assetState.asset.id}`}
                      assetState={assetState}
                      slotLabel={chartCount > 1 ? `กราฟ #${idx + 1}` : undefined}
                      isActiveSlot={chartCount > 1 && activeSlotIndex === idx}
                      compact={chartCount > 1}
                      onActivateSlot={() => setActiveSlotIndex(idx)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Right Scanner Sidebar */}
          <div
            className={
              mobilePanel === 'list'
                ? 'flex flex-1 min-h-0 flex-col lg:flex-none'
                : 'hidden lg:flex lg:flex-col'
            }
          >
            <ScannerSidebar
              assets={assets}
              selectedAssetIds={selectedAssetIds.slice(0, chartCount)}
              activeSlotIndex={Math.min(activeSlotIndex, chartCount - 1)}
              onSelectAsset={handleSelectAssetForSlot}
              categoryFilter={config.categoryFilter}
              directionFilter={config.directionFilter}
              onChangeFilters={handleFilterChange}
            />
          </div>
        </main>
      )}

      {activeTab === 'alerts' && (
        <main className="flex-1 overflow-y-auto">
          <AlertsHistoryView
            alerts={alerts}
            onInspectAsset={(assetId) => {
              handleSelectAssetForSlot(assetId);
              setActiveTab('scanner');
            }}
            onMarkDecision={handleMarkDecision}
          />
        </main>
      )}

      {activeTab === 'settings' && (
        <main className="flex-1 overflow-y-auto">
          <ScannerSettingsView
            config={config}
            onSaveConfig={handleSaveConfig}
          />
        </main>
      )}

      <DownloadInstallModal
        open={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
      />
      <OfflineIndicator />
    </div>
  );
}
