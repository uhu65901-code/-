import { buildAiPatternModel } from './aiPatternLearner';
import { compareAssetsByFlowRank } from './assetRanking';
import { IQ_OPTION_ASSETS } from './assetsCatalog';
import { deduplicateAlertsByAsset, normalizeAssetHistoryKey } from './performanceStats';
import { analyzeCandleTrend } from './trendDetector';
import {
  AiPatternModel,
  AssetInfo,
  Candle,
  DecisionRecord,
  MAX_AI_TRAINING_SAMPLES,
  PatternFeedbackSample,
  ScannerConfig,
  ScannedAssetState,
  TradeOutcome,
  TrendAlert,
} from './types';

function cleanBrokerAssetName(rawName: string): string {
  return rawName.replace(/^front\./i, '').trim();
}

export class IqBrowserScanner {
  private ws: WebSocket | null = null;
  private ssid: string;
  private reqCounter = 1;
  private closedByCaller = false;

  private activeIdToAssetId = new Map<number, string>();
  private discoveredAssets = new Map<string, AssetInfo>();
  private candlesByAsset = new Map<string, Candle[]>();
  private subscribedActiveIds = new Set<number>();
  private reqIdToAssetId = new Map<string, string>();

  private alerts: TrendAlert[];
  private decisionRecords: DecisionRecord[];
  private aiSamples: PatternFeedbackSample[] = [];
  private aiModel: AiPatternModel = buildAiPatternModel([]);
  private lastAlertedTime = new Map<string, number>();
  private lastAlertedAtMs = new Map<string, number>();

  private connected = false;
  private statusMessage = 'กำลังเชื่อมต่อ IQ Option โดยตรงจากในเครื่อง...';

  private onSignal: (alert: TrendAlert) => void;
  private onUpdate: () => void;
  private onStatus: (connected: boolean, message: string) => void;
  private configGetter: () => ScannerConfig;
  private activeGetter: () => boolean;

  constructor(params: {
    ssid: string;
    initialAlerts?: TrendAlert[];
    initialDecisions?: DecisionRecord[];
    initialAiSamples?: PatternFeedbackSample[];
    getConfig: () => ScannerConfig;
    isScanningActive: () => boolean;
    onSignal: (alert: TrendAlert) => void;
    onUpdate: () => void;
    onStatus: (connected: boolean, message: string) => void;
  }) {
    this.ssid = params.ssid.trim();
    this.alerts = deduplicateAlertsByAsset(params.initialAlerts ?? []);
    this.decisionRecords = [...(params.initialDecisions ?? [])];
    this.aiSamples = [...(params.initialAiSamples ?? [])];
    this.aiModel = buildAiPatternModel(this.aiSamples);
    this.configGetter = params.getConfig;
    this.activeGetter = params.isScanningActive;
    this.onSignal = params.onSignal;
    this.onUpdate = params.onUpdate;
    this.onStatus = params.onStatus;

    for (const seed of IQ_OPTION_ASSETS) {
      this.activeIdToAssetId.set(seed.iqActiveId, seed.id);
    }
  }

  private upsertUniqueAlert(alert: TrendAlert) {
    const key = normalizeAssetHistoryKey(alert.assetName, alert.assetId);
    this.alerts = this.alerts.filter(
      (existing) =>
        normalizeAssetHistoryKey(existing.assetName, existing.assetId) !== key &&
        existing.id !== alert.id
    );
    this.alerts.unshift(alert);
    if (this.alerts.length > 80) this.alerts.pop();
  }

  private getPreferredAssetId(activeId: number): string {
    return this.activeIdToAssetId.get(activeId) ?? `iq-${activeId}`;
  }

  connect() {
    this.closedByCaller = false;
    try {
      this.ws = new WebSocket('wss://iqoption.com/echo/websocket');
    } catch {
      this.connected = false;
      this.statusMessage = 'ไม่สามารถเปิดการเชื่อมต่อ WebSocket ไปยัง IQ Option ได้';
      this.onStatus(false, this.statusMessage);
      return;
    }

    this.ws.onopen = () => {
      this.send({ name: 'ssid', msg: this.ssid });
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(String(evt.data));
        if (msg.name === 'profile' && msg.msg) {
          this.connected = true;
          this.statusMessage = 'เชื่อมต่อ IQ Option สดโดยตรงสำเร็จ · กำลังดึงคู่เงิน 1 นาทีทั้งหมด...';
          this.onStatus(true, this.statusMessage);
          this.requestAllTradableInstruments();
        } else if (msg.name === 'ssid' && msg.msg === false) {
          this.connected = false;
          this.statusMessage = 'Session SSID ไม่ถูกต้องหรือหมดอายุ กรุณานำ SSID ใหม่จาก IQ Option';
          this.onStatus(false, this.statusMessage);
        } else if (msg.name === 'initialization-data' && msg.msg) {
          this.handleBinaryInitData(msg.msg);
        } else if (
          msg.name === 'underlying-list' &&
          msg.msg &&
          Array.isArray(msg.msg.underlying)
        ) {
          this.handleDigitalUnderlyingList(msg.msg.underlying);
        } else if (msg.name === 'candles' && msg.msg?.candles && msg.request_id) {
          const assetId = this.reqIdToAssetId.get(String(msg.request_id));
          if (assetId && Array.isArray(msg.msg.candles)) {
            const parsed: Candle[] = msg.msg.candles
              .map(
                (c: {
                  from: number;
                  open: number;
                  max: number;
                  min: number;
                  close: number;
                  volume?: number;
                }) => ({
                  time: Number(c.from),
                  open: Number(c.open),
                  high: Number(c.max),
                  low: Number(c.min),
                  close: Number(c.close),
                  volume: c.volume ? Number(c.volume) : 0,
                })
              )
              .filter(
                (c: Candle) =>
                  Number.isFinite(c.time) &&
                  Number.isFinite(c.open) &&
                  Number.isFinite(c.high) &&
                  Number.isFinite(c.low) &&
                  Number.isFinite(c.close)
              )
              .sort((a: Candle, b: Candle) => a.time - b.time);

            if (parsed.length > 0) {
              this.candlesByAsset.set(assetId, parsed.slice(-30));
              if (this.activeGetter()) {
                this.evaluateAndAlert(assetId, this.candlesByAsset.get(assetId)!);
              }
              this.onUpdate();
            }
          }
        } else if (msg.name === 'candle-generated' && msg.msg) {
          const c = msg.msg;
          const assetId = this.activeIdToAssetId.get(Number(c.active_id));
          if (assetId && Number(c.size) === 60) {
            const parsedTick: Candle = {
              time: Number(c.from),
              open: Number(c.open),
              high: Number(c.max),
              low: Number(c.min),
              close: Number(c.close),
              volume: c.volume ? Number(c.volume) : 0,
            };
            if (
              Number.isFinite(parsedTick.time) &&
              Number.isFinite(parsedTick.open) &&
              Number.isFinite(parsedTick.high) &&
              Number.isFinite(parsedTick.low) &&
              Number.isFinite(parsedTick.close)
            ) {
              const list = this.candlesByAsset.get(assetId) ?? [];
              if (list.length === 0) {
                this.candlesByAsset.set(assetId, [parsedTick]);
              } else {
                const last = list[list.length - 1];
                if (last.time === parsedTick.time) {
                  list[list.length - 1] = parsedTick;
                } else if (parsedTick.time > last.time) {
                  list.push(parsedTick);
                  if (list.length > 65) list.shift();
                }
              }
              if (this.activeGetter()) {
                this.evaluateAndAlert(assetId, this.candlesByAsset.get(assetId)!);
              }
              this.onUpdate();
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      if (!this.closedByCaller) {
        this.connected = false;
        this.statusMessage = 'การเชื่อมต่อ IQ Option ถูกตัด กำลังเชื่อมใหม่...';
        this.onStatus(false, this.statusMessage);
      }
    };

    this.ws.onerror = () => {
      if (!this.closedByCaller) {
        this.connected = false;
        this.statusMessage = 'ไม่สามารถสตรีมตรงจากเบราว์เซอร์ได้ (แนะนำเชื่อมผ่านตัวติดตั้ง PC หรือตรวจ SSID)';
        this.onStatus(false, this.statusMessage);
      }
    };
  }

  private evaluateAndAlert(assetId: string, candles: Candle[]) {
    if (candles.length < 8) return;
    const config = this.configGetter();
    const analysis = analyzeCandleTrend(candles, config, {
      aiModel: this.aiModel,
      aiSamples: this.aiSamples,
    });
    const signalTime = analysis.signalTime ?? candles[candles.length - 1].time;
    const prevAlertAt = this.lastAlertedAtMs.get(assetId) ?? 0;

    if (
      analysis.status === 'MATCH' &&
      analysis.direction &&
      analysis.matchScore >= (config.minMatchScore ?? 86) &&
      this.lastAlertedTime.get(assetId) !== signalTime &&
      Date.now() - prevAlertAt >= 90 * 1000
    ) {
      const info =
        this.discoveredAssets.get(assetId) ??
        IQ_OPTION_ASSETS.find((a) => a.id === assetId);
      if (!info) return;

      this.lastAlertedTime.set(assetId, signalTime);
      this.lastAlertedAtMs.set(assetId, Date.now());
      const alert: TrendAlert = {
        id: `${assetId}-${signalTime}`,
        assetId,
        assetName: info.name,
        assetSymbol: info.symbol,
        category: info.category,
        payoutPercent: info.payoutPercent,
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
      this.onSignal(alert);
    }
  }

  private requestAllTradableInstruments() {
    this.send({
      name: 'sendMessage',
      request_id: `init_binary_${this.reqCounter++}`,
      msg: {
        name: 'get-initialization-data',
        version: '3.0',
        body: {},
      },
    });
    this.send({
      name: 'sendMessage',
      request_id: `init_digital_${this.reqCounter++}`,
      msg: {
        name: 'digital-option-instruments.get-underlying-list',
        version: '1.0',
        body: { filter_suspended: true },
      },
    });
    this.subscribeBatch(
      IQ_OPTION_ASSETS.map((a) => ({
        id: a.id,
        iqActiveId: a.iqActiveId,
        name: a.name,
        symbol: a.symbol,
        category: a.category,
        isOtc: a.isOtc,
        payoutPercent: a.payoutPercent,
        decimals: a.decimals,
      }))
    );
  }

  private handleBinaryInitData(msgBody: Record<string, unknown>) {
    const groups = [
      (msgBody.turbo as { actives?: Record<string, Record<string, unknown>> } | undefined)
        ?.actives,
      (msgBody.binary as { actives?: Record<string, Record<string, unknown>> } | undefined)
        ?.actives,
    ];
    const newlyDiscovered: AssetInfo[] = [];

    for (const actives of groups) {
      if (!actives || typeof actives !== 'object') continue;
      for (const active of Object.values(actives)) {
        if (!active || !active.enabled || active.is_suspended) continue;
        const activeId = Number(active.id);
        if (!Number.isFinite(activeId) || activeId <= 0) continue;

        const rawName = String(active.name || active.ticker || `ACTIVE-${activeId}`);
        const cleanName = cleanBrokerAssetName(rawName);
        const ticker = String(active.ticker || cleanName);
        const rawPrec = Number(active.precision);
        const precision = Number.isFinite(rawPrec)
          ? Math.min(8, Math.max(2, Math.round(rawPrec)))
          : 5;
        const rawCommission = Number(
          (active.option as { profit?: { commission?: number } } | undefined)?.profit?.commission
        );
        const commission = Number.isFinite(rawCommission) ? rawCommission : 16;
        const payoutPercent = Math.max(50, Math.min(98, Math.round(100 - commission)));
        const isOtc = /otc/i.test(cleanName) || /otc/i.test(ticker);

        const assetId = this.getPreferredAssetId(activeId);
        const info: AssetInfo = {
          id: assetId,
          iqActiveId: activeId,
          name: cleanName,
          symbol: ticker,
          category: 'BINARY',
          isOtc,
          payoutPercent,
          decimals: precision,
        };
        this.activeIdToAssetId.set(activeId, assetId);
        this.discoveredAssets.set(assetId, info);
        newlyDiscovered.push(info);
      }
    }

    if (newlyDiscovered.length > 0) {
      this.subscribeBatch(newlyDiscovered);
      this.statusMessage = `เชื่อมต่อ IQ Option โดยตรง · สแกน ${this.discoveredAssets.size} คู่ (1 นาที)`;
      this.onStatus(true, this.statusMessage);
      this.onUpdate();
    }
  }

  private handleDigitalUnderlyingList(underlyings: Array<Record<string, unknown>>) {
    const newlyDiscovered: AssetInfo[] = [];

    for (const item of underlyings) {
      if (!item || item.is_suspended) continue;
      const activeId = Number(item.active_id);
      if (!Number.isFinite(activeId) || activeId <= 0) continue;

      const cleanName = cleanBrokerAssetName(
        String(item.name || item.underlying || `DIG-${activeId}`)
      );
      const isOtc = /otc/i.test(cleanName);
      const assetId = this.getPreferredAssetId(activeId);

      if (!this.discoveredAssets.has(assetId)) {
        const info: AssetInfo = {
          id: assetId,
          iqActiveId: activeId,
          name: cleanName,
          symbol: cleanName,
          category: 'DIGITAL',
          isOtc,
          payoutPercent: 85,
          decimals: 5,
        };
        this.activeIdToAssetId.set(activeId, assetId);
        this.discoveredAssets.set(assetId, info);
        newlyDiscovered.push(info);
      }
    }

    if (newlyDiscovered.length > 0) {
      this.subscribeBatch(newlyDiscovered);
      this.statusMessage = `เชื่อมต่อ IQ Option โดยตรง · สแกน ${this.discoveredAssets.size} คู่ (Binary & Digital)`;
      this.onStatus(true, this.statusMessage);
      this.onUpdate();
    }
  }

  requestAssetCandles(assetId: string) {
    const info =
      this.discoveredAssets.get(assetId) ??
      IQ_OPTION_ASSETS.find((a) => a.id === assetId);
    if (!info || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const reqId = `candles_${this.reqCounter++}`;
    this.reqIdToAssetId.set(reqId, info.id);
    this.activeIdToAssetId.set(info.iqActiveId, info.id);

    this.send({
      name: 'sendMessage',
      request_id: reqId,
      msg: {
        name: 'get-candles',
        version: '2.0',
        body: {
          active_id: info.iqActiveId,
          size: 60,
          to: nowSec,
          count: 55,
        },
      },
    });
    this.send({
      name: 'subscribeMessage',
      msg: {
        name: 'candle-generated',
        params: {
          routingFilters: {
            active_id: info.iqActiveId,
            size: 60,
          },
        },
      },
    });
  }

  private subscribeBatch(assets: AssetInfo[]) {
    const nowSec = Math.floor(Date.now() / 1000);
    assets.forEach((asset, idx) => {
      if (this.subscribedActiveIds.has(asset.iqActiveId)) return;
      this.subscribedActiveIds.add(asset.iqActiveId);

      const delayMs = Math.floor(idx / 12) * 60;
      window.setTimeout(() => {
        if (this.closedByCaller || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        const reqId = `candles_${this.reqCounter++}`;
        this.reqIdToAssetId.set(reqId, asset.id);
        this.send({
          name: 'sendMessage',
          request_id: reqId,
          msg: {
            name: 'get-candles',
            version: '2.0',
            body: {
              active_id: asset.iqActiveId,
              size: 60,
              to: nowSec,
              count: 25,
            },
          },
        });
        this.send({
          name: 'subscribeMessage',
          msg: {
            name: 'candle-generated',
            params: {
              routingFilters: {
                active_id: asset.iqActiveId,
                size: 60,
              },
            },
          },
        });
      }, delayMs);
    });
  }

  private send(payload: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  addAiFeedback(sample: PatternFeedbackSample) {
    const filtered = sample.alertId
      ? this.aiSamples.filter((s) => s.alertId !== sample.alertId)
      : this.aiSamples;
    this.aiSamples = [...filtered, sample].slice(-MAX_AI_TRAINING_SAMPLES);
    this.aiModel = buildAiPatternModel(this.aiSamples);

    if (sample.alertId) {
      const target = this.alerts.find((a) => a.id === sample.alertId);
      if (target) {
        target.aiVerdict = sample.verdict;
        if (sample.verdict === 'PASS') {
          target.acknowledged = true;
          if (!target.decisionNote) target.decisionNote = 'WATCHED';
        }
      }
    }
    return {
      aiSamples: [...this.aiSamples],
      aiModel: this.aiModel,
      alerts: [...this.alerts],
    };
  }

  replaceAiSamples(samples: PatternFeedbackSample[]) {
    this.aiSamples = samples.slice(-MAX_AI_TRAINING_SAMPLES);
    this.aiModel = buildAiPatternModel(this.aiSamples);
    return {
      aiSamples: [...this.aiSamples],
      aiModel: this.aiModel,
    };
  }

  removeAiSample(sampleId: string) {
    this.aiSamples = this.aiSamples.filter((s) => s.id !== sampleId);
    this.aiModel = buildAiPatternModel(this.aiSamples);
    return {
      aiSamples: [...this.aiSamples],
      aiModel: this.aiModel,
    };
  }

  clearAiSamples() {
    this.aiSamples = [];
    this.aiModel = buildAiPatternModel([]);
    return {
      aiSamples: [],
      aiModel: this.aiModel,
    };
  }

  markDecision(
    alertId: string,
    decisionNote: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED',
    tradeOutcome?: TradeOutcome
  ) {
    const found = this.alerts.find((a) => a.id === alertId);
    if (found) {
      found.decisionNote = tradeOutcome ? 'TRADED_MANUAL' : decisionNote;
      if (tradeOutcome) found.tradeOutcome = tradeOutcome;
      found.acknowledged = true;

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
        decisionNote: found.decisionNote,
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
    return found ?? null;
  }

  getSnapshot(config: ScannerConfig): {
    assets: ScannedAssetState[];
    alerts: TrendAlert[];
    decisionRecords: DecisionRecord[];
    aiSamples: PatternFeedbackSample[];
    aiModel: AiPatternModel;
    connected: boolean;
    statusMessage: string;
  } {
    const nowSec = Math.floor(Date.now() / 1000);
    const currentBarStart = Math.floor(nowSec / 60) * 60;
    const secondsRemaining = Math.max(0, 60 - (nowSec - currentBarStart));

    const catalog =
      this.discoveredAssets.size > 0
        ? Array.from(this.discoveredAssets.values())
        : IQ_OPTION_ASSETS.map((s) => ({
            id: s.id,
            iqActiveId: s.iqActiveId,
            name: s.name,
            symbol: s.symbol,
            category: s.category,
            isOtc: s.isOtc,
            payoutPercent: s.payoutPercent,
            decimals: s.decimals,
          }));

    const states: ScannedAssetState[] = catalog.map((info) => {
      const candles = this.candlesByAsset.get(info.id) ?? [];
      const analysis = analyzeCandleTrend(candles, config, {
        aiModel: this.aiModel,
        aiSamples: this.aiSamples,
      });
      const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
      return {
        asset: info,
        candles: candles.map((c) => ({ ...c })),
        analysis,
        lastPrice,
        secondsRemaining,
        updatedAt: Date.now(),
      };
    });

    states.sort((a, b) => compareAssetsByFlowRank(a, b));

    return {
      assets: states,
      alerts: [...this.alerts],
      decisionRecords: [...this.decisionRecords],
      aiSamples: [...this.aiSamples],
      aiModel: this.aiModel,
      connected: this.connected,
      statusMessage: this.statusMessage,
    };
  }

  disconnect() {
    this.closedByCaller = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}
