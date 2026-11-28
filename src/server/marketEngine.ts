import crypto from 'crypto';
import { buildAiPatternModel } from '../lib/aiPatternLearner.ts';
import { compareAssetsByFlowRank } from '../lib/assetRanking.ts';
import { analyzeCandleTrend } from '../lib/trendDetector.ts';
import { normalizeAssetHistoryKey } from '../lib/performanceStats.ts';
import {
  DEFAULT_SCANNER_CONFIG,
  MAX_AI_TRAINING_SAMPLES,
  type AiPatternModel,
  type AssetInfo,
  type Candle,
  type ConnectionMode,
  type DecisionRecord,
  type PatternFeedbackSample,
  type ScannerConfig,
  type ScannedAssetState,
  type TradeOutcome,
  type TrendAlert,
} from '../lib/types.ts';
import { IQ_OPTION_ASSETS, type CatalogSeedAsset } from './assetsCatalog.ts';
import { IqLiveFeedConnection } from './iqOptionClient.ts';

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
  const totalBars = 24;
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
        // 5 clean same-color green candles with small natural wicks
        delta = step * (0.88 + pseudoRand(i) * 0.22);
        upperWick = step * (0.08 + pseudoRand(i + 1) * 0.08);
        lowerWick = step * (0.05 + pseudoRand(i + 2) * 0.05);
      } else if (closedIdxFromEnd === 5) {
        delta = -step * 1.05;
      } else {
        delta = (i % 2 === 0 ? 1 : -1) * step * (0.8 + pseudoRand(i) * 0.4);
      }
    } else if (!isFormingBar && seed.initialPattern === 'DOWN_FLOW') {
      if (closedIdxFromEnd <= 4) {
        // 5 clean same-color red candles with small natural wicks
        delta = -step * (0.88 + pseudoRand(i) * 0.22);
        upperWick = step * (0.05 + pseudoRand(i + 1) * 0.05);
        lowerWick = step * (0.08 + pseudoRand(i + 2) * 0.08);
      } else if (closedIdxFromEnd === 5) {
        delta = step * 0.98;
      } else {
        delta = (i % 2 === 0 ? -1 : 1) * step * (0.8 + pseudoRand(i) * 0.4);
      }
    } else if (!isFormingBar && seed.initialPattern === 'FORMING_UP') {
      if (closedIdxFromEnd <= 2) {
        // 3 clean same-color green candles forming toward 4th
        delta = step * (0.88 + pseudoRand(i) * 0.2);
        upperWick = step * (0.08 + pseudoRand(i + 1) * 0.07);
        lowerWick = step * (0.05 + pseudoRand(i + 2) * 0.05);
      } else if (closedIdxFromEnd === 3) {
        delta = -step * 1.02;
      } else {
        delta = (i % 2 === 0 ? 1 : -1) * step * (0.85 + pseudoRand(i) * 0.3);
      }
    } else if (!isFormingBar && seed.initialPattern === 'FORMING_DOWN') {
      if (closedIdxFromEnd <= 2) {
        // 3 clean same-color red candles forming toward 4th
        delta = -step * (0.88 + pseudoRand(i) * 0.2);
        upperWick = step * (0.05 + pseudoRand(i + 1) * 0.05);
        lowerWick = step * (0.08 + pseudoRand(i + 2) * 0.07);
      } else if (closedIdxFromEnd === 3) {
        delta = step * 1.02;
      } else {
        delta = (i % 2 === 0 ? -1 : 1) * step * (0.85 + pseudoRand(i) * 0.3);
      }
    } else if (!isFormingBar && seed.initialPattern === 'PULLBACK_UP') {
      if (closedIdxFromEnd === 0 || closedIdxFromEnd === 1 || closedIdxFromEnd === 3 || closedIdxFromEnd === 4) {
        delta = step * (0.88 + pseudoRand(i) * 0.2);
        upperWick = step * (0.07 + pseudoRand(i + 1) * 0.06);
        lowerWick = step * (0.05 + pseudoRand(i + 2) * 0.05);
      } else if (closedIdxFromEnd === 2) {
        delta = -step * 0.42;
        upperWick = step * 0.05;
        lowerWick = step * 0.06;
      } else if (closedIdxFromEnd === 5) {
        delta = -step * 1.05;
      } else {
        delta = (i % 2 === 0 ? 1 : -1) * step * (0.8 + pseudoRand(i) * 0.35);
      }
    } else if (!isFormingBar && seed.initialPattern === 'PULLBACK_DOWN') {
      if (closedIdxFromEnd === 0 || closedIdxFromEnd === 1 || closedIdxFromEnd === 4 || closedIdxFromEnd === 5) {
        delta = -step * (0.9 + pseudoRand(i) * 0.2);
        upperWick = step * (0.05 + pseudoRand(i + 1) * 0.05);
        lowerWick = step * (0.07 + pseudoRand(i + 2) * 0.06);
      } else if (closedIdxFromEnd === 2 || closedIdxFromEnd === 3) {
        delta = step * 0.36;
        upperWick = step * 0.05;
        lowerWick = step * 0.05;
      } else if (closedIdxFromEnd === 6) {
        delta = step * 1.02;
      } else {
        delta = (i % 2 === 0 ? -1 : 1) * step * (0.8 + pseudoRand(i) * 0.35);
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
        seed.initialPattern === 'DOWN_FLOW' ||
        seed.initialPattern === 'FORMING_DOWN' ||
        seed.initialPattern === 'PULLBACK_DOWN'
          ? -step * 0.38
          : seed.initialPattern === 'UP_FLOW' ||
              seed.initialPattern === 'FORMING_UP' ||
              seed.initialPattern === 'PULLBACK_UP'
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
  private decisionRecords: DecisionRecord[] = [];
  private aiSamples: PatternFeedbackSample[] = [];
  private aiModel: AiPatternModel = buildAiPatternModel([]);
  private lastAlertedCandleTime = new Map<string, number>();
  private lastAlertedAtMs = new Map<string, number>();
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
          seed.initialPattern === 'FORMING_UP' ||
          seed.initialPattern === 'UP_FLOW' ||
          seed.initialPattern === 'PULLBACK_UP'
            ? 'FLOW_UP'
            : seed.initialPattern === 'FORMING_DOWN' ||
                seed.initialPattern === 'DOWN_FLOW' ||
                seed.initialPattern === 'PULLBACK_DOWN'
              ? 'FLOW_DOWN'
              : 'CHOP',
        remainingBars: 2,
      });
    }

    const initialStates = this.getScannedStates(DEFAULT_SCANNER_CONFIG);
    for (const st of initialStates) {
      if (st.analysis.status === 'MATCH' && st.analysis.direction) {
        const closedTime = st.analysis.signalTime ?? st.candles[st.candles.length - 2].time;
        this.lastAlertedCandleTime.set(st.asset.id, closedTime);
        this.lastAlertedAtMs.set(st.asset.id, Date.now());
        this.upsertUniqueAlert({
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
          matchScore: st.analysis.matchScore,
          priceAtAlert: st.lastPrice,
          candleTime: closedTime,
          createdAt: Date.now() - 4000,
          acknowledged: false,
          patternFeatures: st.analysis.patternFeatures,
          aiSimilarityScore: st.analysis.aiSimilarityScore,
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
            if (session.scanningActive && session.config.realtimeAlertImmediate) {
              this.checkNewSignalForAsset(assetId, list, session.config, session);
            }
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

  requestAssetCandles(token: string, assetId: string) {
    const session = this.sessions.get(token);
    if (session?.iqFeed) {
      session.iqFeed.requestAssetCandles(assetId);
    }
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
      const liveCandles = liveMap?.get(assetInfo.id);
      const candles =
        liveCandles && liveCandles.length >= 2
          ? liveCandles
          : (this.demoCandles.get(assetInfo.id) ?? []);

      const analysis = analyzeCandleTrend(candles, config, {
        aiModel: this.aiModel,
        aiSamples: this.aiSamples,
      });
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

    return states.sort((a, b) => compareAssetsByFlowRank(a, b));
  }

  private upsertUniqueAlert(alert: TrendAlert) {
    const targetKey = normalizeAssetHistoryKey(alert.assetName, alert.assetId);
    this.demoAlerts = this.demoAlerts.filter(
      (existing) =>
        normalizeAssetHistoryKey(existing.assetName, existing.assetId) !== targetKey &&
        existing.id !== alert.id
    );
    this.demoAlerts.unshift(alert);
    if (this.demoAlerts.length > 80) {
      this.demoAlerts.pop();
    }
  }

  getAlerts(): TrendAlert[] {
    return this.demoAlerts.slice(0, 80);
  }

  getDecisionRecords(): DecisionRecord[] {
    return this.decisionRecords.slice(-200);
  }

  getAiSamples(): PatternFeedbackSample[] {
    return this.aiSamples.slice(-MAX_AI_TRAINING_SAMPLES);
  }

  getAiModel(): AiPatternModel {
    return this.aiModel;
  }

  syncAiSamples(samples: PatternFeedbackSample[]): {
    aiSamples: PatternFeedbackSample[];
    aiModel: AiPatternModel;
  } {
    const map = new Map<string, PatternFeedbackSample>();
    for (const item of [...samples, ...this.aiSamples]) {
      if (
        item &&
        typeof item.id === 'string' &&
        (item.direction === 'UP' || item.direction === 'DOWN') &&
        (item.verdict === 'PASS' || item.verdict === 'REJECT') &&
        item.features &&
        (item.verdict === 'REJECT' || item.features.directionalEfficiency >= 0.42)
      ) {
        map.set(item.id, item);
      }
    }
    this.aiSamples = Array.from(map.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_AI_TRAINING_SAMPLES);
    this.aiModel = buildAiPatternModel(this.aiSamples);
    return {
      aiSamples: this.getAiSamples(),
      aiModel: this.aiModel,
    };
  }

  addAiFeedbackSample(sample: PatternFeedbackSample): {
    aiSamples: PatternFeedbackSample[];
    aiModel: AiPatternModel;
    alerts: TrendAlert[];
  } {
    const filtered = sample.alertId
      ? this.aiSamples.filter((s) => s.alertId !== sample.alertId)
      : this.aiSamples;
    this.aiSamples = [...filtered, sample].slice(-MAX_AI_TRAINING_SAMPLES);
    this.aiModel = buildAiPatternModel(this.aiSamples);

    if (sample.alertId) {
      const targetAlert = this.demoAlerts.find((a) => a.id === sample.alertId);
      if (targetAlert) {
        targetAlert.aiVerdict = sample.verdict;
        if (sample.verdict === 'PASS') {
          targetAlert.acknowledged = true;
          if (!targetAlert.decisionNote) targetAlert.decisionNote = 'WATCHED';
        }
      }
    }

    return {
      aiSamples: this.getAiSamples(),
      aiModel: this.aiModel,
      alerts: this.getAlerts(),
    };
  }

  removeAiSample(sampleId: string): {
    aiSamples: PatternFeedbackSample[];
    aiModel: AiPatternModel;
  } {
    this.aiSamples = this.aiSamples.filter((s) => s.id !== sampleId);
    this.aiModel = buildAiPatternModel(this.aiSamples);
    return {
      aiSamples: this.getAiSamples(),
      aiModel: this.aiModel,
    };
  }

  clearAiSamples(): {
    aiSamples: PatternFeedbackSample[];
    aiModel: AiPatternModel;
  } {
    this.aiSamples = [];
    this.aiModel = buildAiPatternModel([]);
    return {
      aiSamples: [],
      aiModel: this.aiModel,
    };
  }

  updateAlertDecision(
    alertId: string,
    patch: {
      acknowledged?: boolean;
      decisionNote?: TrendAlert['decisionNote'];
      tradeOutcome?: TradeOutcome;
    }
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
    if (patch.tradeOutcome) {
      found.tradeOutcome = patch.tradeOutcome;
      found.decisionNote = 'TRADED_MANUAL';
      found.acknowledged = true;
    }

    if (patch.decisionNote || patch.tradeOutcome) {
      const existingIdx = this.decisionRecords.findIndex((r) => r.alertId === found.id);
      const record: DecisionRecord = {
        id: `dec-${found.id}`,
        alertId: found.id,
        assetId: found.assetId,
        assetName: found.assetName,
        direction: found.direction,
        payoutPercent: found.payoutPercent,
        matchScore: found.matchScore ?? found.uniformityScore,
        runLength: found.runLength,
        decisionNote: found.decisionNote ?? 'WATCHED',
        tradeOutcome: found.tradeOutcome,
        recordedAt: Date.now(),
      };
      if (existingIdx >= 0) {
        this.decisionRecords[existingIdx] = record;
      } else {
        this.decisionRecords.push(record);
        if (this.decisionRecords.length > 200) this.decisionRecords.shift();
      }
    }
    return found;
  }

  private checkNewSignalForAsset(
    assetId: string,
    candles: Candle[],
    config: ScannerConfig,
    session?: UserSession
  ) {
    if (candles.length < 8) return;
    const analysis = analyzeCandleTrend(candles, config, {
      aiModel: this.aiModel,
      aiSamples: this.aiSamples,
    });
    if (
      analysis.status !== 'MATCH' ||
      !analysis.direction ||
      analysis.matchScore < (config.minMatchScore ?? 86)
    ) {
      return;
    }

    const signalTime = analysis.signalTime ?? candles[candles.length - 1].time;
    const prevTime = this.lastAlertedCandleTime.get(assetId);
    const prevAlertAt = this.lastAlertedAtMs.get(assetId) ?? 0;
    const nowMs = Date.now();
    if (prevTime === signalTime || nowMs - prevAlertAt < 90 * 1000) return;

    this.lastAlertedCandleTime.set(assetId, signalTime);
    this.lastAlertedAtMs.set(assetId, nowMs);
    const liveAsset = session
      ? this.liveAssetsCatalog.get(session.token)?.find((a) => a.id === assetId)
      : undefined;
    const seed = liveAsset ?? IQ_OPTION_ASSETS.find((a) => a.id === assetId);
    if (!seed) return;

    const alert: TrendAlert = {
      id: `${assetId}-${signalTime}`,
      assetId,
      assetName: seed.name,
      assetSymbol: seed.symbol,
      category: seed.category,
      payoutPercent: seed.payoutPercent,
      direction: analysis.direction,
      runLength: analysis.runLength,
      avgWickRatio: analysis.avgWickRatio,
      uniformityScore: analysis.uniformityScore,
      matchScore: analysis.matchScore,
      priceAtAlert: candles[candles.length - 1].close,
      candleTime: signalTime,
      createdAt: Date.now(),
      acknowledged: false,
      patternFeatures: analysis.patternFeatures,
      aiSimilarityScore: analysis.aiSimilarityScore,
    };

    this.upsertUniqueAlert(alert);
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
              (lastBar.open + seed.stepSize * (0.86 + Math.random() * 0.28)).toFixed(
                seed.decimals
              )
            );
            lastBar.close = targetClose;
            lastBar.high = Number(
              (
                Math.max(lastBar.open, targetClose) +
                seed.stepSize * (0.07 + Math.random() * 0.09)
              ).toFixed(seed.decimals)
            );
            lastBar.low = Number(
              (
                Math.min(lastBar.open, targetClose) -
                seed.stepSize * (0.04 + Math.random() * 0.06)
              ).toFixed(seed.decimals)
            );
          } else if (regime.mode === 'FLOW_DOWN') {
            const targetClose = Number(
              (lastBar.open - seed.stepSize * (0.86 + Math.random() * 0.28)).toFixed(
                seed.decimals
              )
            );
            lastBar.close = targetClose;
            lastBar.high = Number(
              (
                Math.max(lastBar.open, targetClose) +
                seed.stepSize * (0.04 + Math.random() * 0.06)
              ).toFixed(seed.decimals)
            );
            lastBar.low = Number(
              (
                Math.min(lastBar.open, targetClose) -
                seed.stepSize * (0.07 + Math.random() * 0.09)
              ).toFixed(seed.decimals)
            );
          }

          regime.remainingBars--;
          if (regime.remainingBars <= 0) {
            if (regime.mode === 'CHOP') {
              const r = Math.random();
              if (r < 0.09) {
                regime.mode = 'FLOW_UP';
                regime.remainingBars = 4 + Math.floor(Math.random() * 3); // 4-6 bars
              } else if (r < 0.18) {
                regime.mode = 'FLOW_DOWN';
                regime.remainingBars = 4 + Math.floor(Math.random() * 3); // 4-6 bars
              } else {
                regime.mode = 'CHOP';
                regime.remainingBars = 4 + Math.floor(Math.random() * 5);
              }
            } else {
              regime.mode = 'CHOP';
              regime.remainingBars = 5 + Math.floor(Math.random() * 5);
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
          if (list.length > 26) {
            list.shift();
          }

          const activeSession = Array.from(this.sessions.values()).pop();
          const activeConfig = activeSession?.config ?? DEFAULT_SCANNER_CONFIG;
          if (!activeSession || activeSession.scanningActive) {
            this.checkNewSignalForAsset(seed.id, list, activeConfig, activeSession);
          }
        } else {
          const progress = Math.min(1, Math.max(0.14, Math.pow(elapsedInBar / 60, 0.72)));
          let drift = 0;
          let noise = (Math.random() - 0.5) * seed.stepSize * 0.16;

          if (regime.mode === 'FLOW_UP') {
            drift = seed.stepSize * 0.98 * progress;
            noise = (Math.random() - 0.35) * seed.stepSize * 0.04;
          } else if (regime.mode === 'FLOW_DOWN') {
            drift = -seed.stepSize * 0.98 * progress;
            noise = (Math.random() - 0.65) * seed.stepSize * 0.04;
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

          const activeSession = Array.from(this.sessions.values()).pop();
          const activeConfig = activeSession?.config ?? DEFAULT_SCANNER_CONFIG;
          if (
            activeConfig.realtimeAlertImmediate &&
            (!activeSession || activeSession.scanningActive)
          ) {
            this.checkNewSignalForAsset(seed.id, list, activeConfig, activeSession);
          }
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
