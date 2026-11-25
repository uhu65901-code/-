import crypto from 'crypto';
import { analyzeCandleTrend } from '../lib/trendDetector';
import {
  AssetInfo,
  Candle,
  ConnectionMode,
  DEFAULT_SCANNER_CONFIG,
  ScannerConfig,
  ScannedAssetState,
  TrendAlert,
} from '../lib/types';
import { CatalogSeedAsset, IQ_OPTION_ASSETS } from './assetsCatalog';
import { IqLiveFeedConnection } from './iqOptionClient';

export interface UserSession {
  token: string;
  email: string;
  mode: ConnectionMode;
  iqConnected: boolean;
  iqStatusMessage?: string;
  scanningActive: boolean;
  config: ScannerConfig;
  createdAt: number;
  iqFeed?: IqLiveFeedConnection;
}

type EngineListener = (event: {
  type: 'scanner:snapshot' | 'signal:detected';
  payload: unknown;
}) => void;

/**
 * Generates deterministic initial 1-minute candle histories for each catalog asset
 * mirroring the 5-6 candle smooth flowing trends shown in IQ Option reference screenshots.
 */
function buildInitialCandles(seed: CatalogSeedAsset, nowSec: number): Candle[] {
  const currentBarTime = Math.floor(nowSec / 60) * 60;
  const totalBars = 52;
  const candles: Candle[] = [];
  let price = seed.basePrice;
  const step = seed.stepSize;

  let hash = 0;
  for (let i = 0; i < seed.id.length; i++) {
    hash = (hash * 31 + seed.id.charCodeAt(i)) % 10000;
  }
  const pseudoRand = (idx: number) => {
    const x = Math.sin(hash + idx * 17.3) * 10000;
    return x - Math.floor(x);
  };

  for (let i = 0; i < totalBars; i++) {
    const barTime = currentBarTime - (totalBars - 1 - i) * 60;
    const isFormingBar = i === totalBars - 1;
    const closedIdxFromEnd = totalBars - 2 - i; // 0 = latest closed bar

    let delta = 0;
    let upperWick = step * (0.24 + pseudoRand(i) * 0.36);
    let lowerWick = step * (0.24 + pseudoRand(i + 5) * 0.36);

    if (!isFormingBar && seed.initialPattern === 'UP_FLOW') {
      if (closedIdxFromEnd <= 4) {
        // 5 clean short green candles with minimal wicks (matching 5-6 candle rule)
        delta = step * (0.92 + pseudoRand(i) * 0.14);
        upperWick = step * 0.05;
        lowerWick = step * 0.04;
      } else if (closedIdxFromEnd === 5) {
        delta = -step * 1.05;
      } else {
        delta = (i % 2 === 0 ? 1 : -1) * step * (0.8 + pseudoRand(i) * 0.4);
      }
    } else if (!isFormingBar && seed.initialPattern === 'DOWN_FLOW') {
      if (closedIdxFromEnd <= 4) {
        // 5 clean short red candles with minimal wicks
        delta = -step * (0.94 + pseudoRand(i) * 0.12);
        upperWick = step * 0.04;
        lowerWick = step * 0.05;
      } else if (closedIdxFromEnd === 5) {
        delta = step * 0.98;
      } else {
        delta = (i % 2 === 0 ? -1 : 1) * step * (0.8 + pseudoRand(i) * 0.4);
      }
    } else if (!isFormingBar && seed.initialPattern === 'FORMING_UP') {
      if (closedIdxFromEnd <= 3) {
        // 4 clean short green candles (forming 4/5)
        delta = step * (0.92 + pseudoRand(i) * 0.12);
        upperWick = step * 0.05;
        lowerWick = step * 0.04;
      } else if (closedIdxFromEnd === 4) {
        delta = -step * 1.02;
      } else {
        delta = (i % 2 === 0 ? 1 : -1) * step * (0.85 + pseudoRand(i) * 0.3);
      }
    } else if (!isFormingBar && seed.initialPattern === 'FORMING_DOWN') {
      if (closedIdxFromEnd <= 3) {
        // 4 clean short red candles (forming 4/5)
        delta = -step * (0.92 + pseudoRand(i) * 0.12);
        upperWick = step * 0.04;
        lowerWick = step * 0.05;
      } else if (closedIdxFromEnd === 4) {
        delta = step * 1.02;
      } else {
        delta = (i % 2 === 0 ? -1 : 1) * step * (0.85 + pseudoRand(i) * 0.3);
      }
    } else if (!isFormingBar && seed.initialPattern === 'BIG_WICKS') {
      const sign = closedIdxFromEnd <= 4 ? 1 : i % 2 === 0 ? 1 : -1;
      delta = sign * step * (0.8 + pseudoRand(i) * 0.3);
      upperWick = step * 1.4;
      lowerWick = step * 1.2;
    } else if (!isFormingBar) {
      delta = (pseudoRand(i) > 0.48 ? 1 : -1) * step * (0.7 + pseudoRand(i + 2) * 0.7);
    } else {
      delta =
        seed.initialPattern === 'DOWN_FLOW' || seed.initialPattern === 'FORMING_DOWN'
          ? -step * 0.38
          : seed.initialPattern === 'UP_FLOW' || seed.initialPattern === 'FORMING_UP'
            ? step * 0.38
            : (pseudoRand(i) > 0.5 ? 1 : -1) * step * 0.25;
      upperWick = step * 0.04;
      lowerWick = step * 0.04;
    }

    const open = Number(price.toFixed(seed.decimals));
    const close = Number((open + delta).toFixed(seed.decimals));
    const high = Number((Math.max(open, close) + upperWick).toFixed(seed.decimals));
    const low = Number((Math.min(open, close) - lowerWick).toFixed(seed.decimals));
    candles.push({ time: barTime, open, high, low, close, volume: 100 });
    price = close;
  }

  return candles;
}

interface DemoRegime {
  mode: 'CHOP' | 'FLOW_UP' | 'FLOW_DOWN';
  remainingBars: number;
}

export class MarketScannerEngine {
  private sessions = new Map<string, UserSession>();
  private demoCandles = new Map<string, Candle[]>();
  private demoRegimes = new Map<string, DemoRegime>();
  private demoAlerts: TrendAlert[] = [];
  private lastAlertedCandleTime = new Map<string, number>();
  private listeners = new Set<EngineListener>();
  private tickTimer: NodeJS.Timeout | null = null;
  private liveAssetCandles = new Map<string, Map<string, Candle[]>>();
  private liveAssetsCatalog = new Map<string, AssetInfo[]>();

  constructor() {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const seed of IQ_OPTION_ASSETS) {
      const candles = buildInitialCandles(seed, nowSec);
      this.demoCandles.set(seed.id, candles);
      this.demoRegimes.set(seed.id, {
        mode:
          seed.initialPattern === 'FORMING_UP' || seed.initialPattern === 'UP_FLOW'
            ? 'FLOW_UP'
            : seed.initialPattern === 'FORMING_DOWN' || seed.initialPattern === 'DOWN_FLOW'
              ? 'FLOW_DOWN'
              : 'CHOP',
        remainingBars:
          seed.initialPattern === 'FORMING_UP' || seed.initialPattern === 'FORMING_DOWN'
            ? 2
            : 2,
      });
    }

    const initialStates = this.getScannedStates(DEFAULT_SCANNER_CONFIG);
    for (const st of initialStates) {
      if (st.analysis.status === 'MATCH' && st.analysis.direction) {
        const closedTime = st.candles[st.candles.length - 2].time;
        this.lastAlertedCandleTime.set(st.asset.id, closedTime);
        this.demoAlerts.unshift({
          id: `${st.asset.id}-${closedTime}`,
          assetId: st.asset.id,
          assetName: st.asset.name,
          assetSymbol: st.asset.symbol,
          category: st.asset.category,
          payoutPercent: st.asset.payoutPercent,
          direction: st.analysis.direction,
          runLength: st.analysis.runLength,
          avgWickRatio: st.analysis.avgWickRatio,
          uniformityScore: st.analysis.uniformityScore,
          priceAtAlert: st.lastPrice,
          candleTime: closedTime,
          createdAt: Date.now() - 4000,
          acknowledged: false,
        });
      }
    }

    this.startDemoLoop();
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(type: 'scanner:snapshot' | 'signal:detected', payload: unknown) {
    for (const fn of this.listeners) {
      try {
        fn({ type, payload });
      } catch {
        // ignore listener error
      }
    }
  }

  createSession(params: {
    email: string;
    mode: ConnectionMode;
    ssid?: string;
  }): UserSession {
    const token = crypto.randomBytes(32).toString('hex');
    const session: UserSession = {
      token,
      email: params.email,
      mode: params.mode,
      iqConnected: params.mode === 'IQ_OPTION_LIVE',
      iqStatusMessage:
        params.mode === 'IQ_OPTION_LIVE'
          ? 'กำลังเชื่อมต่อสตรีมกราฟ IQ Option...'
          : `สแกนพร้อมกัน ${IQ_OPTION_ASSETS.length}/${IQ_OPTION_ASSETS.length} คู่ (1 นาที)`,
      scanningActive: true,
      config: { ...DEFAULT_SCANNER_CONFIG },
      createdAt: Date.now(),
    };

    if (params.mode === 'IQ_OPTION_LIVE' && params.ssid) {
      const liveMap = new Map<string, Candle[]>();
      this.liveAssetCandles.set(token, liveMap);

      const feed = new IqLiveFeedConnection(params.ssid, {
        onAssetsDiscovered: (discovered) => {
          this.liveAssetsCatalog.set(token, discovered);
        },
        onCandlesUpdate: (assetId, candles) => {
          liveMap.set(assetId, candles.slice(-65));
          if (session.scanningActive) {
            this.checkNewSignalForAsset(assetId, liveMap.get(assetId)!, session.config, session);
          }
        },
        onCandleTick: (assetId, tickCandle) => {
          const list = liveMap.get(assetId) ?? [];
          if (list.length === 0) {
            liveMap.set(assetId, [tickCandle]);
            return;
          }
          const last = list[list.length - 1];
          if (last.time === tickCandle.time) {
            list[list.length - 1] = tickCandle;
          } else if (tickCandle.time > last.time) {
            list.push(tickCandle);
            if (list.length > 65) list.shift();
            if (session.scanningActive) {
              this.checkNewSignalForAsset(assetId, list, session.config, session);
            }
          }
        },
        onStatus: (connected, msg) => {
          session.iqConnected = connected;
          session.iqStatusMessage = msg;
        },
      });
      session.iqFeed = feed;
      feed.connect();
    }

    this.sessions.set(token, session);
    return session;
  }

  getSession(token: string | undefined): UserSession | null {
    if (!token) return null;
    return this.sessions.get(token) ?? null;
  }

  destroySession(token: string) {
    const session = this.sessions.get(token);
    if (session?.iqFeed) {
      session.iqFeed.disconnect();
    }
    this.liveAssetCandles.delete(token);
    this.liveAssetsCatalog.delete(token);
    this.sessions.delete(token);
  }

  setScanningActive(token: string, active: boolean): boolean | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    session.scanningActive = active;
    return session.scanningActive;
  }

  updateSessionConfig(token: string, partial: Partial<ScannerConfig>): ScannerConfig | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    session.config = { ...session.config, ...partial };
    return session.config;
  }

  getScannedStates(config: ScannerConfig, sessionToken?: string): ScannedAssetState[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const currentBarStart = Math.floor(nowSec / 60) * 60;
    const secondsRemaining = Math.max(0, 60 - (nowSec - currentBarStart));

    const liveMap = sessionToken ? this.liveAssetCandles.get(sessionToken) : undefined;
    const liveCatalog = sessionToken ? this.liveAssetsCatalog.get(sessionToken) : undefined;

    const catalogList: Array<AssetInfo & { basePrice?: number }> =
      liveCatalog && liveCatalog.length > 0
        ? liveCatalog
        : IQ_OPTION_ASSETS.map((seed) => ({
            id: seed.id,
            iqActiveId: seed.iqActiveId,
            name: seed.name,
            symbol: seed.symbol,
            category: seed.category,
            isOtc: seed.isOtc,
            payoutPercent: seed.payoutPercent,
            decimals: seed.decimals,
            basePrice: seed.basePrice,
          }));

    const states: ScannedAssetState[] = catalogList.map((assetInfo) => {
      const candles =
        liveMap && liveMap.get(assetInfo.id) && (liveMap.get(assetInfo.id)?.length ?? 0) >= 8
          ? liveMap.get(assetInfo.id)!
          : (this.demoCandles.get(assetInfo.id) ?? []);

      const analysis = analyzeCandleTrend(candles, config);
      const lastPrice =
        candles.length > 0 ? candles[candles.length - 1].close : (assetInfo.basePrice ?? 0);

      return {
        asset: {
          id: assetInfo.id,
          iqActiveId: assetInfo.iqActiveId,
          name: assetInfo.name,
          symbol: assetInfo.symbol,
          category: assetInfo.category,
          isOtc: assetInfo.isOtc,
          payoutPercent: assetInfo.payoutPercent,
          decimals: assetInfo.decimals,
        },
        candles,
        analysis,
        lastPrice,
        secondsRemaining,
        updatedAt: Date.now(),
      };
    });

    const rank = (status: string) =>
      status === 'MATCH' ? 0 : status === 'FORMING' ? 1 : status === 'OVEREXTENDED' ? 2 : 3;

    return states.sort((a, b) => {
      const r = rank(a.analysis.status) - rank(b.analysis.status);
      if (r !== 0) return r;
      return b.analysis.uniformityScore - a.analysis.uniformityScore;
    });
  }

  getAlerts(): TrendAlert[] {
    return this.demoAlerts.slice(0, 80);
  }

  updateAlertDecision(
    alertId: string,
    patch: { acknowledged?: boolean; decisionNote?: TrendAlert['decisionNote'] }
  ): TrendAlert | null {
    const found = this.demoAlerts.find((a) => a.id === alertId);
    if (!found) return null;
    if (typeof patch.acknowledged === 'boolean') {
      found.acknowledged = patch.acknowledged;
    }
    if (patch.decisionNote) {
      found.decisionNote = patch.decisionNote;
      found.acknowledged = true;
    }
    return found;
  }

  private checkNewSignalForAsset(
    assetId: string,
    candles: Candle[],
    config: ScannerConfig,
    session?: UserSession
  ) {
    if (candles.length < 10) return;
    const analysis = analyzeCandleTrend(candles, config);
    if (analysis.status !== 'MATCH' || !analysis.direction) return;

    const closedTime = candles[candles.length - 2].time;
    const prevTime = this.lastAlertedCandleTime.get(assetId);
    if (prevTime === closedTime) return;

    this.lastAlertedCandleTime.set(assetId, closedTime);
    const liveAsset = session
      ? this.liveAssetsCatalog.get(session.token)?.find((a) => a.id === assetId)
      : undefined;
    const seed = liveAsset ?? IQ_OPTION_ASSETS.find((a) => a.id === assetId);
    if (!seed) return;

    const alert: TrendAlert = {
      id: `${assetId}-${closedTime}`,
      assetId,
      assetName: seed.name,
      assetSymbol: seed.symbol,
      category: seed.category,
      payoutPercent: seed.payoutPercent,
      direction: analysis.direction,
      runLength: analysis.runLength,
      avgWickRatio: analysis.avgWickRatio,
      uniformityScore: analysis.uniformityScore,
      priceAtAlert: candles[candles.length - 1].close,
      candleTime: closedTime,
      createdAt: Date.now(),
      acknowledged: false,
    };

    this.demoAlerts.unshift(alert);
    if (this.demoAlerts.length > 80) {
      this.demoAlerts.pop();
    }

    this.emit('signal:detected', alert);
  }

  private startDemoLoop() {
    this.tickTimer = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const currentBarStart = Math.floor(nowSec / 60) * 60;
      const elapsedInBar = nowSec - currentBarStart;

      for (const seed of IQ_OPTION_ASSETS) {
        const list = this.demoCandles.get(seed.id);
        if (!list || list.length === 0) continue;

        const regime = this.demoRegimes.get(seed.id) ?? {
          mode: 'CHOP',
          remainingBars: 4,
        };
        const lastBar = list[list.length - 1];

        if (currentBarStart > lastBar.time) {
          if (regime.mode === 'FLOW_UP') {
            const targetClose = Number(
              (lastBar.open + seed.stepSize * (0.94 + Math.random() * 0.12)).toFixed(
                seed.decimals
              )
            );
            lastBar.close = targetClose;
            lastBar.high = Number(
              (Math.max(lastBar.open, targetClose) + seed.stepSize * 0.05).toFixed(
                seed.decimals
              )
            );
            lastBar.low = Number(
              (Math.min(lastBar.open, targetClose) - seed.stepSize * 0.04).toFixed(
                seed.decimals
              )
            );
          } else if (regime.mode === 'FLOW_DOWN') {
            const targetClose = Number(
              (lastBar.open - seed.stepSize * (0.94 + Math.random() * 0.12)).toFixed(
                seed.decimals
              )
            );
            lastBar.close = targetClose;
            lastBar.high = Number(
              (Math.max(lastBar.open, targetClose) + seed.stepSize * 0.04).toFixed(
                seed.decimals
              )
            );
            lastBar.low = Number(
              (Math.min(lastBar.open, targetClose) - seed.stepSize * 0.05).toFixed(
                seed.decimals
              )
            );
          }

          regime.remainingBars--;
          if (regime.remainingBars <= 0) {
            if (regime.mode === 'CHOP') {
              const r = Math.random();
              if (r < 0.28) {
                regime.mode = 'FLOW_UP';
                regime.remainingBars = 5 + Math.floor(Math.random() * 2); // 5-6 bars
              } else if (r < 0.56) {
                regime.mode = 'FLOW_DOWN';
                regime.remainingBars = 5 + Math.floor(Math.random() * 2); // 5-6 bars
              } else {
                regime.mode = 'CHOP';
                regime.remainingBars = 3 + Math.floor(Math.random() * 5);
              }
            } else {
              regime.mode = 'CHOP';
              regime.remainingBars = 4 + Math.floor(Math.random() * 5);
            }
          }
          this.demoRegimes.set(seed.id, regime);

          const newOpen = lastBar.close;
          list.push({
            time: currentBarStart,
            open: newOpen,
            high: newOpen,
            low: newOpen,
            close: newOpen,
            volume: 10,
          });
          if (list.length > 60) {
            list.shift();
          }

          const activeSession = Array.from(this.sessions.values()).pop();
          const activeConfig = activeSession?.config ?? DEFAULT_SCANNER_CONFIG;
          if (!activeSession || activeSession.scanningActive) {
            this.checkNewSignalForAsset(seed.id, list, activeConfig, activeSession);
          }
        } else {
          const progress = Math.min(1, Math.max(0.05, elapsedInBar / 60));
          let drift = 0;
          let noise = (Math.random() - 0.5) * seed.stepSize * 0.16;

          if (regime.mode === 'FLOW_UP') {
            drift = seed.stepSize * 0.98 * progress;
            noise = (Math.random() - 0.35) * seed.stepSize * 0.05;
          } else if (regime.mode === 'FLOW_DOWN') {
            drift = -seed.stepSize * 0.98 * progress;
            noise = (Math.random() - 0.65) * seed.stepSize * 0.05;
          } else {
            drift = (lastBar.close - lastBar.open) + (Math.random() - 0.5) * seed.stepSize * 0.45;
          }

          const nextClose = Number(
            (regime.mode === 'CHOP'
              ? lastBar.open + drift
              : lastBar.open + drift + noise
            ).toFixed(seed.decimals)
          );
          lastBar.close = nextClose;
          lastBar.high = Number(Math.max(lastBar.high, nextClose).toFixed(seed.decimals));
          lastBar.low = Number(Math.min(lastBar.low, nextClose).toFixed(seed.decimals));
          lastBar.volume = (lastBar.volume ?? 10) + 1;
        }
      }

      this.emit('scanner:snapshot', { timestamp: Date.now() });
    }, 1000);
  }

  shutdown() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const s of this.sessions.values()) {
      s.iqFeed?.disconnect();
    }
  }
}
