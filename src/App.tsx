import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  Download,
  ListFilter,
  Pause,
  Play,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  assessChartFlowForAiTraining,
  buildAiPatternModel,
  createFeedbackSample,
} from './lib/aiPatternLearner';
import { compareAssetsByFlowRank } from './lib/assetRanking';
import { IqBrowserScanner } from './lib/iqBrowserFeed';
import { LocalDemoScanner } from './lib/localDemoEngine';
import {
  deduplicateAlertsByAsset,
  normalizeAssetHistoryKey,
} from './lib/performanceStats';
import {
  loadSavedAiSamples,
  loadSavedAlerts,
  loadSavedConfig,
  loadSavedDecisionRecords,
  saveAiSamplesLocally,
  saveAlertsLocally,
  saveConfigLocally,
  saveDecisionRecordsLocally,
} from './lib/standaloneStorage';
import {
  ConnectionMode,
  DecisionRecord,
  MAX_AI_TRAINING_SAMPLES,
  PatternFeatureVector,
  PatternFeedbackSample,
  PatternVerdict,
  ScannerConfig,
  ScannedAssetState,
  TradeOutcome,
  TrendAlert,
  TrendDirection,
} from './lib/types';
import { AuthSuccessPayload, LoginScreen } from './components/LoginScreen';
import { ActiveTab, HeaderBar } from './components/HeaderBar';
import { CandlestickChart } from './components/CandlestickChart';
import { ChartQuickSearch } from './components/ChartQuickSearch';
import { ScannerSidebar } from './components/ScannerSidebar';
import { ScannerSettingsView } from './components/ScannerSettingsView';
import { DownloadInstallModal } from './components/DownloadInstallModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';

interface SessionInfo {
  token: string;
  email: string;
  mode: ConnectionMode;
  iqConnected: boolean;
  iqStatusMessage?: string;
  scanningActive: boolean;
  ssid?: string;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('scanner');
  const [config, setConfig] = useState<ScannerConfig>(() => loadSavedConfig());
  const [assets, setAssets] = useState<ScannedAssetState[]>([]);
  const [alerts, setAlerts] = useState<TrendAlert[]>([]);
  const [decisionRecords, setDecisionRecords] = useState<DecisionRecord[]>([]);
  const [aiSamples, setAiSamples] = useState<PatternFeedbackSample[]>(() =>
    loadSavedAiSamples()
  );
  const [recentChartVerdicts, setRecentChartVerdicts] = useState<
    Record<string, PatternVerdict>
  >({});

  const aiModel = useMemo(() => buildAiPatternModel(aiSamples), [aiSamples]);

  // 1-4 simultaneous charts state (locked once chosen so chart never jumps automatically)
  const [chartCount, setChartCount] = useState<1 | 2 | 3 | 4>(1);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(0);

  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'chart' | 'list'>('chart');
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const wakeLockSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const localScannerRef = useRef<LocalDemoScanner | null>(null);
  const browserScannerRef = useRef<IqBrowserScanner | null>(null);
  const localConfigRef = useRef<ScannerConfig>(config);
  const localActiveRef = useRef<boolean>(true);
  const chartWorkspaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    localConfigRef.current = config;
  }, [config]);

  useEffect(() => {
    localActiveRef.current = session?.scanningActive ?? true;
  }, [session?.scanningActive]);

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
      ssid: payload.ssid,
    });
    setConfig(payload.config);
    saveConfigLocally(payload.config);
  }, []);

  useEffect(() => {
    if (session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const startOfflineDemo = () => {
        handleAuthenticated({
          token: `local-demo-${Date.now()}`,
          email: 'standalone@flowtrend.local',
          mode: 'LOCAL_DEMO_STREAM',
          iqConnected: false,
          iqStatusMessage: 'โหมดสแกนทำงานอิสระในเครื่อง (ไม่ต้องพึ่งเซิร์ฟเวอร์)',
          scanningActive: true,
          config: loadSavedConfig(),
        });
      };

      if (window.location.protocol === 'file:' || window.location.protocol === 'content:') {
        startOfflineDemo();
        return;
      }

      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DEMO' }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.token) {
            handleAuthenticated(data);
          } else {
            startOfflineDemo();
          }
        })
        .catch(() => {
          startOfflineDemo();
        });
    }
  }, [session, handleAuthenticated]);

  useEffect(() => {
    if (!session) return;

    if (session.mode === 'LOCAL_DEMO_STREAM') {
      const localEngine = new LocalDemoScanner({
        alerts: loadSavedAlerts(),
        decisionRecords: loadSavedDecisionRecords(),
        aiSamples: loadSavedAiSamples(),
      });
      localScannerRef.current = localEngine;
      const snap0 = localEngine.getSnapshot(localConfigRef.current);
      const unique0 = deduplicateAlertsByAsset(snap0.alerts);
      setAssets(snap0.assets);
      setAlerts(unique0);
      saveAlertsLocally(unique0);
      setDecisionRecords(snap0.decisionRecords);
      setAiSamples(snap0.aiSamples);
      saveAiSamplesLocally(snap0.aiSamples);
      setWsConnected(true);

      const timer = window.setInterval(() => {
        const newAlerts = localEngine.step(localConfigRef.current, localActiveRef.current);
        const snap = localEngine.getSnapshot(localConfigRef.current);
        const unique = deduplicateAlertsByAsset(snap.alerts);
        setAssets(snap.assets);
        setAlerts(unique);
        setDecisionRecords(snap.decisionRecords);
        if (newAlerts.length > 0) {
          saveAlertsLocally(unique);
        }
      }, 1000);

      return () => {
        window.clearInterval(timer);
        localScannerRef.current = null;
      };
    }

    if (session.mode === 'IQ_BROWSER_LIVE') {
      const browserScanner = new IqBrowserScanner({
        ssid: session.ssid ?? '',
        initialAlerts: loadSavedAlerts(),
        initialDecisions: loadSavedDecisionRecords(),
        initialAiSamples: loadSavedAiSamples(),
        getConfig: () => localConfigRef.current,
        isScanningActive: () => localActiveRef.current,
        onSignal: () => {},
        onUpdate: () => {
          const snap = browserScanner.getSnapshot(localConfigRef.current);
          const unique = deduplicateAlertsByAsset(snap.alerts);
          setAssets(snap.assets);
          setAlerts(unique);
          saveAlertsLocally(unique);
          setDecisionRecords(snap.decisionRecords);
          setAiSamples(snap.aiSamples);
          saveAiSamplesLocally(snap.aiSamples);
        },
        onStatus: (connected, message) => {
          setWsConnected(connected);
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  iqConnected: connected,
                  iqStatusMessage: message,
                }
              : prev
          );
        },
      });
      browserScannerRef.current = browserScanner;
      const snap0 = browserScanner.getSnapshot(localConfigRef.current);
      const unique0 = deduplicateAlertsByAsset(snap0.alerts);
      setAssets(snap0.assets);
      setAlerts(unique0);
      setDecisionRecords(snap0.decisionRecords);
      setAiSamples(snap0.aiSamples);
      browserScanner.connect();

      const timer = window.setInterval(() => {
        const snap = browserScanner.getSnapshot(localConfigRef.current);
        setAssets(snap.assets);
      }, 1000);

      return () => {
        window.clearInterval(timer);
        browserScanner.disconnect();
        browserScannerRef.current = null;
      };
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pollTimer: number | null = null;
    let wsIsUp = false;

    const loadInitial = async () => {
      try {
        const res = await fetch('/api/scanner/state', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) {
          if (session.mode === 'DEMO_STREAM' && !cancelled) {
            setSession((prev) =>
              prev
                ? {
                    ...prev,
                    mode: 'LOCAL_DEMO_STREAM',
                    iqStatusMessage: 'โหมดสแกนทดสอบสดในเครื่อง',
                  }
                : prev
            );
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.assets)) {
          setAssets(data.assets);
        }
        if (Array.isArray(data.alerts)) {
          const unique = deduplicateAlertsByAsset(data.alerts);
          setAlerts(unique);
        }
        if (Array.isArray(data.decisionRecords)) {
          setDecisionRecords(data.decisionRecords);
        }
        const localDeviceSamples = loadSavedAiSamples();
        if (Array.isArray(data.aiSamples) && data.aiSamples.length > 0) {
          setAiSamples(data.aiSamples);
          saveAiSamplesLocally(data.aiSamples);
        } else if (localDeviceSamples.length > 0) {
          setAiSamples(localDeviceSamples);
          fetch('/api/ai/sync', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({ samples: localDeviceSamples }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((syncRes) => {
              if (!cancelled && syncRes) {
                if (Array.isArray(syncRes.aiSamples)) {
                  setAiSamples(syncRes.aiSamples);
                  saveAiSamplesLocally(syncRes.aiSamples);
                }
                if (Array.isArray(syncRes.assets)) {
                  setAssets(syncRes.assets);
                }
              }
            })
            .catch(() => {});
        }
        if (data.config) {
          setConfig(data.config);
        }
      } catch {
        if (session.mode === 'DEMO_STREAM' && !cancelled) {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  mode: 'LOCAL_DEMO_STREAM',
                  iqStatusMessage: 'โหมดสแกนทดสอบสดในเครื่อง',
                }
              : prev
          );
        }
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
        wsIsUp = true;
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
              setAlerts(deduplicateAlertsByAsset(msg.payload.alerts));
            }
            if (Array.isArray(msg.payload.decisionRecords)) {
              setDecisionRecords(msg.payload.decisionRecords);
            }
            if (Array.isArray(msg.payload.aiSamples) && msg.payload.aiSamples.length > 0) {
              setAiSamples(msg.payload.aiSamples);
              saveAiSamplesLocally(msg.payload.aiSamples);
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
            const newKey = normalizeAssetHistoryKey(
              newAlert.assetName,
              newAlert.assetId
            );
            setAlerts((prev) => [
              newAlert,
              ...prev.filter(
                (item) =>
                  item.id !== newAlert.id &&
                  normalizeAssetHistoryKey(item.assetName, item.assetId) !== newKey
              ),
            ]);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsIsUp = false;
        if (!cancelled) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    };

    loadInitial();
    connectWs();
    pollTimer = window.setInterval(() => {
      if (!wsIsUp && !cancelled) {
        loadInitial();
      }
    }, 2000);

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      if (ws) ws.close();
    };
  }, [session?.token, session?.mode]);

  const handleSaveConfig = async (next: ScannerConfig) => {
    if (!session) return;
    saveConfigLocally(next);
    if (session.mode === 'LOCAL_DEMO_STREAM') {
      setConfig(next);
      if (localScannerRef.current) {
        const snap = localScannerRef.current.getSnapshot(next);
        setAssets(snap.assets);
      }
      return;
    }
    if (session.mode === 'IQ_BROWSER_LIVE') {
      setConfig(next);
      if (browserScannerRef.current) {
        const snap = browserScannerRef.current.getSnapshot(next);
        setAssets(snap.assets);
      }
      return;
    }
    try {
      const res = await fetch('/api/scanner/config', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config);
          saveConfigLocally(data.config);
        }
        if (Array.isArray(data.assets)) setAssets(data.assets);
      }
    } catch {
      // keep optimistic state
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
    if (session.mode === 'LOCAL_DEMO_STREAM' || session.mode === 'IQ_BROWSER_LIVE') {
      return;
    }
    try {
      await fetch('/api/scanner/toggle', {
        method: 'POST',
        credentials: 'same-origin',
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
    decisionNote: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED',
    tradeOutcome?: TradeOutcome
  ) => {
    if (!session) return;
    if (session.mode === 'LOCAL_DEMO_STREAM' || session.mode === 'IQ_BROWSER_LIVE') {
      const activeScanner =
        session.mode === 'LOCAL_DEMO_STREAM'
          ? localScannerRef.current
          : browserScannerRef.current;
      const updated = activeScanner?.markDecision(
        alertId,
        decisionNote,
        tradeOutcome
      );
      if (updated && activeScanner) {
        const snap = activeScanner.getSnapshot(localConfigRef.current);
        const unique = deduplicateAlertsByAsset(snap.alerts);
        setAlerts(unique);
        setDecisionRecords(snap.decisionRecords);
        saveAlertsLocally(unique);
        saveDecisionRecordsLocally(snap.decisionRecords);
      }
      return;
    }
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(alertId)}/decision`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          acknowledged: true,
          decisionNote,
          ...(tradeOutcome ? { tradeOutcome } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.alert) {
          setAlerts((prev) =>
            prev.map((a) => (a.id === alertId ? data.alert : a))
          );
        }
        if (Array.isArray(data.decisionRecords)) {
          setDecisionRecords(data.decisionRecords);
        }
      }
    } catch {
      // ignore transient errors
    }
  };

  const submitAiSample = async (sample: PatternFeedbackSample) => {
    if (!session) return;

    if (session.mode === 'LOCAL_DEMO_STREAM' || session.mode === 'IQ_BROWSER_LIVE') {
      const activeScanner =
        session.mode === 'LOCAL_DEMO_STREAM'
          ? localScannerRef.current
          : browserScannerRef.current;
      if (activeScanner) {
        const res = activeScanner.addAiFeedback(sample);
        const snap = activeScanner.getSnapshot(localConfigRef.current);
        const unique = deduplicateAlertsByAsset(snap.alerts);
        setAiSamples(res.aiSamples);
        saveAiSamplesLocally(res.aiSamples);
        setAlerts(unique);
        saveAlertsLocally(unique);
        setAssets(snap.assets);
      }
      return;
    }

    const optimistic = [
      ...(sample.alertId
        ? aiSamples.filter((s) => s.alertId !== sample.alertId)
        : aiSamples),
      sample,
    ].slice(-MAX_AI_TRAINING_SAMPLES);
    setAiSamples(optimistic);
    saveAiSamplesLocally(optimistic);

    try {
      const res = await fetch('/api/ai/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(sample),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.aiSamples)) {
          setAiSamples(data.aiSamples);
          saveAiSamplesLocally(data.aiSamples);
        }
        if (Array.isArray(data.alerts)) {
          setAlerts(deduplicateAlertsByAsset(data.alerts));
        }
        if (Array.isArray(data.assets)) {
          setAssets(data.assets);
        }
      }
    } catch {
      // keep optimistic local training sample
    }
  };

  const handleTrainAiFromChart = async (
    assetState: ScannedAssetState,
    verdict: PatternVerdict,
    forcedDirection?: TrendDirection
  ): Promise<{ ok: boolean; message?: string }> => {
    const analysisMatchesDir =
      Boolean(assetState.analysis.patternFeatures) &&
      Boolean(assetState.analysis.direction) &&
      assetState.analysis.runLength >= 4 &&
      assetState.analysis.runLength <= 6 &&
      (verdict === 'REJECT' || assetState.analysis.directionalEfficiency >= 0.45) &&
      (!forcedDirection || assetState.analysis.direction === forcedDirection);

    let targetDir: TrendDirection;
    let features: PatternFeatureVector;
    let runLength: number;
    let avgWickRatio: number;
    let uniformityScore: number;
    let baseMatchScore: number;

    if (analysisMatchesDir && assetState.analysis.patternFeatures && assetState.analysis.direction) {
      targetDir = assetState.analysis.direction;
      features = assetState.analysis.patternFeatures;
      runLength = assetState.analysis.runLength;
      avgWickRatio = assetState.analysis.avgWickRatio;
      uniformityScore = assetState.analysis.uniformityScore;
      baseMatchScore =
        assetState.analysis.baseMatchScore ?? assetState.analysis.matchScore;
    } else {
      const flow = assessChartFlowForAiTraining(
        assetState.candles,
        assetState.analysis.emaValues,
        config,
        forcedDirection,
        verdict
      );
      if (!flow.ok) {
        return { ok: false, message: flow.reason };
      }
      targetDir = flow.direction;
      features = flow.features;
      runLength = flow.runLength;
      avgWickRatio = flow.avgWickRatio;
      uniformityScore = flow.uniformityScore;
      baseMatchScore = flow.baseMatchScore;
    }

    const key = `${assetState.asset.id}-${assetState.analysis.signalTime ?? 0}`;
    setRecentChartVerdicts((prev) => ({ ...prev, [key]: verdict }));

    const matchingAlert = alerts.find(
      (a) =>
        normalizeAssetHistoryKey(a.assetName, a.assetId) ===
        normalizeAssetHistoryKey(assetState.asset.name, assetState.asset.id)
    );

    const sample = createFeedbackSample({
      alertId: matchingAlert?.id,
      assetId: assetState.asset.id,
      assetName: assetState.asset.name,
      direction: targetDir,
      verdict,
      baseMatchScore,
      aiScoreAtTime: assetState.analysis.aiSimilarityScore,
      runLength,
      avgWickRatio,
      uniformityScore,
      features,
    });

    await submitAiSample(sample);
    return { ok: true };
  };

  const handleImportAiSamples = async (imported: PatternFeedbackSample[]) => {
    const mergedMap = new Map<string, PatternFeedbackSample>();
    for (const s of [...aiSamples, ...imported]) {
      if (
        s &&
        (s.direction === 'UP' || s.direction === 'DOWN') &&
        s.features &&
        (s.verdict === 'REJECT' || s.features.directionalEfficiency >= 0.42)
      ) {
        mergedMap.set(s.id, s);
      }
    }
    const merged = Array.from(mergedMap.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_AI_TRAINING_SAMPLES);
    setAiSamples(merged);
    saveAiSamplesLocally(merged);

    if (!session) return;
    if (session.mode === 'LOCAL_DEMO_STREAM' || session.mode === 'IQ_BROWSER_LIVE') {
      const activeScanner =
        session.mode === 'LOCAL_DEMO_STREAM'
          ? localScannerRef.current
          : browserScannerRef.current;
      if (activeScanner) {
        activeScanner.replaceAiSamples(merged);
        const snap = activeScanner.getSnapshot(localConfigRef.current);
        setAssets(snap.assets);
      }
      return;
    }

    try {
      const res = await fetch('/api/ai/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ samples: merged }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.aiSamples)) {
          setAiSamples(data.aiSamples);
          saveAiSamplesLocally(data.aiSamples);
        }
        if (Array.isArray(data.assets)) setAssets(data.assets);
      }
    } catch {
      // keep local imported samples
    }
  };


  const handleRemoveAiSample = async (sampleId: string) => {
    if (!session) return;
    if (session.mode === 'LOCAL_DEMO_STREAM' || session.mode === 'IQ_BROWSER_LIVE') {
      const activeScanner =
        session.mode === 'LOCAL_DEMO_STREAM'
          ? localScannerRef.current
          : browserScannerRef.current;
      if (activeScanner) {
        const res = activeScanner.removeAiSample(sampleId);
        const snap = activeScanner.getSnapshot(localConfigRef.current);
        setAiSamples(res.aiSamples);
        saveAiSamplesLocally(res.aiSamples);
        setAssets(snap.assets);
      }
      return;
    }

    const nextLocal = aiSamples.filter((s) => s.id !== sampleId);
    setAiSamples(nextLocal);
    saveAiSamplesLocally(nextLocal);
    try {
      const res = await fetch(`/api/ai/feedback/${encodeURIComponent(sampleId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.aiSamples)) {
          setAiSamples(data.aiSamples);
          saveAiSamplesLocally(data.aiSamples);
        }
        if (Array.isArray(data.assets)) setAssets(data.assets);
      }
    } catch {
      // keep local removal
    }
  };

  const handleResetAiSamples = async () => {
    if (!session) return;
    setAiSamples([]);
    saveAiSamplesLocally([]);
    setRecentChartVerdicts({});

    if (session.mode === 'LOCAL_DEMO_STREAM' || session.mode === 'IQ_BROWSER_LIVE') {
      const activeScanner =
        session.mode === 'LOCAL_DEMO_STREAM'
          ? localScannerRef.current
          : browserScannerRef.current;
      if (activeScanner) {
        activeScanner.clearAiSamples();
        const snap = activeScanner.getSnapshot(localConfigRef.current);
        setAssets(snap.assets);
      }
      return;
    }

    try {
      const res = await fetch('/api/ai/reset', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.assets)) setAssets(data.assets);
      }
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    if (
      session &&
      session.mode !== 'LOCAL_DEMO_STREAM' &&
      session.mode !== 'IQ_BROWSER_LIVE'
    ) {
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
    browserScannerRef.current?.disconnect();
    browserScannerRef.current = null;
    localScannerRef.current = null;
    setSession(null);
    setAssets([]);
    setAlerts([]);
    setDecisionRecords([]);
    setSelectionNotice(null);
    setSelectedAssetIds([]);
    setWsConnected(false);
  };

  const rankedAssetsForSelection = useMemo(() => {
    const aiCtx =
      aiSamples.length > 0 ? { model: aiModel, samples: aiSamples } : undefined;
    return [...assets].sort((a, b) =>
      compareAssetsByFlowRank(a, b, undefined, aiCtx)
    );
  }, [assets, aiModel, aiSamples]);

  const topRankedAsset = rankedAssetsForSelection[0] ?? null;

  // Fill only unset/invalid slots with top-ranked assets; never auto-overwrite a locked chart!
  useEffect(() => {
    if (rankedAssetsForSelection.length === 0) return;
    const validIds = new Set(assets.map((a) => a.asset.id));

    setSelectedAssetIds((prev) => {
      const next = [...prev];
      const used = new Set<string>();
      let changed = false;

      for (let i = 0; i < chartCount; i++) {
        const cur = next[i];
        if (cur && validIds.has(cur) && !used.has(cur)) {
          used.add(cur);
        }
      }

      for (let i = 0; i < chartCount; i++) {
        const cur = next[i];
        if (!cur || !validIds.has(cur)) {
          const candidate =
            rankedAssetsForSelection.find((item) => !used.has(item.asset.id)) ??
            rankedAssetsForSelection[i % rankedAssetsForSelection.length];
          if (candidate && next[i] !== candidate.asset.id) {
            next[i] = candidate.asset.id;
            used.add(candidate.asset.id);
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [assets, chartCount, rankedAssetsForSelection]);

  const requestAssetCandlesById = useCallback(
    (assetId: string) => {
      if (!session) return;
      if (session.mode === 'IQ_OPTION_LIVE') {
        fetch('/api/scanner/select-asset', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ assetId }),
        }).catch(() => {});
      } else if (session.mode === 'IQ_BROWSER_LIVE') {
        browserScannerRef.current?.requestAssetCandles(assetId);
      }
    },
    [session]
  );

  const handleSelectAssetForSlot = (assetId: string, assetName?: string) => {
    const normalizedName = assetName?.trim().toLowerCase();
    const targetHistoryKey = normalizeAssetHistoryKey(assetName ?? '', assetId);
    const matched =
      assets.find((a) => a.asset.id === assetId) ??
      assets.find(
        (a) =>
          normalizeAssetHistoryKey(a.asset.name, a.asset.id) === targetHistoryKey
      ) ??
      (normalizedName
        ? assets.find(
            (a) =>
              a.asset.name.toLowerCase() === normalizedName ||
              a.asset.symbol.toLowerCase() === normalizedName
          )
        : undefined);

    setActiveTab('scanner');
    setMobilePanel('chart');

    if (assets.length > 0 && !matched) {
      setSelectionNotice(
        `ไม่พบกราฟ "${assetName ?? assetId}" ในตลาดที่เปิดอยู่ตอนนี้ กรุณาเลือกคู่เงินอื่นจากรายการด้านข้าง`
      );
      return;
    }

    const resolvedId = matched ? matched.asset.id : assetId;
    setSelectionNotice(null);

    setSelectedAssetIds((prev) => {
      const copy = [...prev];
      const slot = Math.min(activeSlotIndex, chartCount - 1);
      copy[slot] = resolvedId;
      return copy;
    });

    requestAssetCandlesById(resolvedId);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (chartWorkspaceRef.current) {
          chartWorkspaceRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  };

  const visibleSlotAssets = useMemo(() => {
    if (assets.length === 0) return [];
    const byId = new Map(assets.map((a) => [a.asset.id, a]));
    const fallbackPool =
      rankedAssetsForSelection.length > 0 ? rankedAssetsForSelection : assets;
    const result: ScannedAssetState[] = [];
    for (let i = 0; i < chartCount; i++) {
      const wantedId = selectedAssetIds[i];
      const found =
        (wantedId ? byId.get(wantedId) : undefined) ??
        fallbackPool[i % fallbackPool.length];
      if (found) result.push(found);
    }
    return result;
  }, [assets, chartCount, rankedAssetsForSelection, selectedAssetIds]);


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
        onLogout={handleLogout}
      />

      {activeTab === 'scanner' && (
        <main className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Left / Center Chart Workspace */}
          <section ref={chartWorkspaceRef} className="flex-1 min-w-0 flex flex-col">
            {/* Broker-Style Control Strip matching user's 9 attached screenshots */}
            <div className="px-3 lg:px-5 py-2 border-b border-[#1D273B] bg-[#0D1422] space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="px-2.5 py-1 rounded-lg bg-[#11192B] border border-[#23304A] text-[11px] sm:text-xs font-semibold text-[#E2E8F0]">
                    {session.mode === 'IQ_OPTION_LIVE'
                      ? `REAL · ${session.email}`
                      : session.mode === 'IQ_BROWSER_LIVE'
                        ? `REAL (ตรง) · ${session.email}`
                        : session.mode === 'LOCAL_DEMO_STREAM'
                          ? 'DEMO ในเครื่อง'
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

                  <div className="flex items-center gap-1.5 bg-[#0B111E] border border-[#1E293B] rounded-lg px-2 py-1">
                    <label
                      htmlFor="m15-window-select"
                      className="text-[11px] text-[#94A3B8] whitespace-nowrap"
                    >
                      กรอบสแกน
                    </label>
                    <select
                      id="m15-window-select"
                      aria-label="กรอบเวลาสแกน M15 (ไม่เกิน 20 แท่ง)"
                      value={String(Math.min(20, Math.max(15, config.scanWindowBars ?? 15)))}
                      onChange={(e) => {
                        const bars = Math.min(20, Math.max(15, Number(e.target.value) || 15));
                        handleFilterChange({ scanWindowBars: bars });
                      }}
                      className="bg-transparent text-[11px] sm:text-xs font-semibold text-[#60A5FA] focus:outline-none cursor-pointer"
                    >
                      <option value="15" className="bg-[#0D1422] text-[#F8FAFC]">
                        M15 (15 แท่ง)
                      </option>
                      <option value="18" className="bg-[#0D1422] text-[#F8FAFC]">
                        M15 (18 แท่ง)
                      </option>
                      <option value="20" className="bg-[#0D1422] text-[#F8FAFC]">
                        M15 (20 แท่ง)
                      </option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1.5 bg-[#0B111E] border border-[#1E293B] rounded-lg px-2 py-1">
                    <label
                      htmlFor="quick-lookback-select"
                      className="text-[11px] text-[#94A3B8] whitespace-nowrap"
                    >
                      เทียบล่าสุด
                    </label>
                    <select
                      id="quick-lookback-select"
                      aria-label="จำนวนแท่งเทียนย้อนหลังที่เปรียบเทียบ"
                      value={
                        config.targetMinCandles === 4 && config.targetMaxCandles === 6
                          ? '4-6'
                          : config.targetMinCandles === 4 && config.targetMaxCandles === 4
                            ? '4'
                            : config.targetMinCandles === 5 && config.targetMaxCandles === 6
                              ? '5'
                              : config.targetMinCandles === 6 && config.targetMaxCandles === 6
                                ? '6'
                                : config.targetMinCandles === 3 && config.targetMaxCandles === 5
                                  ? '3'
                                  : 'custom'
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '4-6') {
                          handleFilterChange({ targetMinCandles: 4, targetMaxCandles: 6 });
                        } else if (v === '4') {
                          handleFilterChange({ targetMinCandles: 4, targetMaxCandles: 4 });
                        } else if (v === '5') {
                          handleFilterChange({ targetMinCandles: 5, targetMaxCandles: 6 });
                        } else if (v === '6') {
                          handleFilterChange({ targetMinCandles: 6, targetMaxCandles: 6 });
                        } else if (v === '3') {
                          handleFilterChange({ targetMinCandles: 3, targetMaxCandles: 5 });
                        }
                      }}
                      className="bg-transparent text-[11px] sm:text-xs font-semibold text-[#F8FAFC] focus:outline-none cursor-pointer"
                    >
                      <option value="4-6" className="bg-[#0D1422] text-[#F8FAFC]">
                        4–6 แท่ง
                      </option>
                      <option value="4" className="bg-[#0D1422] text-[#F8FAFC]">
                        4 แท่งล่าสุด
                      </option>
                      <option value="5" className="bg-[#0D1422] text-[#F8FAFC]">
                        5 แท่งล่าสุด
                      </option>
                      <option value="6" className="bg-[#0D1422] text-[#F8FAFC]">
                        6 แท่งล่าสุด
                      </option>
                      <option value="3" className="bg-[#0D1422] text-[#F8FAFC]">
                        3 แท่ง (ไว)
                      </option>
                      {!(
                        (config.targetMinCandles === 4 && config.targetMaxCandles === 6) ||
                        (config.targetMinCandles === 4 && config.targetMaxCandles === 4) ||
                        (config.targetMinCandles === 5 && config.targetMaxCandles === 6) ||
                        (config.targetMinCandles === 6 && config.targetMaxCandles === 6) ||
                        (config.targetMinCandles === 3 && config.targetMaxCandles === 5)
                      ) && (
                        <option value="custom" className="bg-[#0D1422] text-[#F8FAFC]">
                          {config.targetMinCandles}–{config.targetMaxCandles} แท่ง
                        </option>
                      )}
                    </select>
                  </div>


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

              {/* Quick Chart Search Bar (type chart name to open & teach AI) */}
              <div className="pt-0.5">
                <ChartQuickSearch
                  assets={assets}
                  activeAssetId={
                    visibleSlotAssets[Math.min(activeSlotIndex, chartCount - 1)]?.asset.id
                  }
                  onSelectAsset={handleSelectAssetForSlot}
                />
              </div>

              {/* Scan Progress Line matching screenshot sub-bar */}
              <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    ดึงแท่งสำเร็จ {assets.length}/{assets.length} คู่
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    กรอบ M15 ({Math.min(20, Math.max(15, config.scanWindowBars ?? 15))} แท่ง) · เกณฑ์ย้อนหลัง{' '}
                    {config.targetMinCandles === config.targetMaxCandles
                      ? `${config.targetMinCandles} แท่ง`
                      : `${config.targetMinCandles}–${config.targetMaxCandles} แท่ง`}{' '}
                    (สีเดียว · สม่ำเสมอ · ไส้ ≤ {Math.round(config.maxWickRatio * 100)}% · {config.minMatchScore}%+)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    อัปเดตอันดับหลังจบแท่ง (แท่งถัดไป {nextMinuteText}) · สีเดียวสวย/ต่างสีพักตัว
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#E2E8F0] font-medium">
                    พบสัญญาณ {matchCount} คู่
                  </span>
                  {config.aiLearningEnabled && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-indigo-300 font-medium">
                        <Brain className="w-3.5 h-3.5" />
                        <span>
                          {aiModel.passCount > 0
                            ? `AI จำ ${aiModel.passCount} ทรง`
                            : 'AI พร้อมเรียนรู้'}
                        </span>
                      </span>
                    </>
                  )}
                  {topRankedAsset &&
                    topRankedAsset.analysis.status === 'MATCH' &&
                    visibleSlotAssets[Math.min(activeSlotIndex, chartCount - 1)]?.asset.id !==
                      topRankedAsset.asset.id && (
                      <button
                        type="button"
                        onClick={() =>
                          handleSelectAssetForSlot(
                            topRankedAsset.asset.id,
                            topRankedAsset.asset.name
                          )
                        }
                        className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-medium transition-colors cursor-pointer"
                      >
                        อันดับ 1 ตอนนี้: {topRankedAsset.asset.name} ({topRankedAsset.analysis.matchScore}%) · สลับดู
                      </button>
                    )}
                </div>
                <span>
                  {session.mode === 'IQ_OPTION_LIVE' || session.mode === 'IQ_BROWSER_LIVE'
                    ? session.iqConnected
                      ? session.iqStatusMessage
                      : 'กำลังเชื่อม IQ Option...'
                    : session.mode === 'LOCAL_DEMO_STREAM'
                      ? 'สแกนอิสระในเครื่อง (ไม่ง้อเซิร์ฟเวอร์)'
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
                  className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    mobilePanel === 'list'
                      ? 'bg-[#2563EB] text-white'
                      : 'bg-[#0B111E] border border-[#1E293B] text-[#94A3B8]'
                  }`}
                >
                  <ListFilter className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    คู่เงิน ({assets.length})
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
              {selectionNotice && (
                <div
                  role="alert"
                  className="mb-3 px-3.5 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-3 text-xs text-amber-200"
                >
                  <span>{selectionNotice}</span>
                  <button
                    type="button"
                    onClick={() => setSelectionNotice(null)}
                    aria-label="ปิดการแจ้งเตือน"
                    className="p-1 rounded hover:bg-amber-500/20 text-amber-300 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

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
                  {visibleSlotAssets.map((assetState, idx) => {
                    const verdictKey = `${assetState.asset.id}-${
                      assetState.analysis.signalTime ?? 0
                    }`;
                    return (
                      <CandlestickChart
                        key={`${idx}-${assetState.asset.id}`}
                        assetState={assetState}
                        slotLabel={chartCount > 1 ? `กราฟ #${idx + 1}` : undefined}
                        isActiveSlot={chartCount > 1 && activeSlotIndex === idx}
                        compact={chartCount > 1}
                        scanWindowBars={config.scanWindowBars}
                        targetMinCandles={config.targetMinCandles}
                        targetMaxCandles={config.targetMaxCandles}
                        minMatchScore={config.minMatchScore}
                        candleBodyDisplay={config.candleBodyDisplay}
                        candleWickDisplay={config.candleWickDisplay}
                        trainedVerdict={recentChartVerdicts[verdictKey] ?? null}
                        onChangeCandleBodyDisplay={(nextBodyCfg) =>
                          handleFilterChange({ candleBodyDisplay: nextBodyCfg })
                        }
                        onChangeCandleWickDisplay={(nextWickCfg) =>
                          handleFilterChange({ candleWickDisplay: nextWickCfg })
                        }
                        onTrainAiPattern={handleTrainAiFromChart}
                        onActivateSlot={() => setActiveSlotIndex(idx)}
                        onRetryCandles={requestAssetCandlesById}
                      />
                    );
                  })}
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
              candleSecondsRemaining={secondsRemaining}
              onSelectAsset={handleSelectAssetForSlot}
              categoryFilter={config.categoryFilter}
              directionFilter={config.directionFilter}
              targetMinCandles={config.targetMinCandles}
              targetMaxCandles={config.targetMaxCandles}
              aiModel={aiModel}
              aiSamples={aiSamples}
              onChangeFilters={handleFilterChange}
            />
          </div>
        </main>
      )}

      {activeTab === 'settings' && (
        <main className="flex-1 overflow-y-auto">
          <ScannerSettingsView
            config={config}
            alerts={alerts}
            decisionRecords={decisionRecords}
            aiSamples={aiSamples}
            aiModel={aiModel}
            onSaveConfig={handleSaveConfig}
            onRecordOutcome={handleMarkDecision}
            onRemoveAiSample={handleRemoveAiSample}
            onResetAiSamples={handleResetAiSamples}
            onImportAiSamples={handleImportAiSamples}
            onInspectAsset={handleSelectAssetForSlot}
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
