import { CatalogSeedAsset, IQ_OPTION_ASSETS } from './assetsCatalog';
import { analyzeCandleTrend } from './trendDetector';
import {
  Candle,
  DEFAULT_SCANNER_CONFIG,
  ScannedAssetState,
  ScannerConfig,
  TrendAlert,
} from './types';

function buildLocalCandles(seed: CatalogSeedAsset, nowSec: number): Candle[] {
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
    const closedIdxFromEnd = totalBars - 2 - i;

    let delta = 0;
    let upperWick = step * (0.24 + pseudoRand(i) * 0.36);
    let lowerWick = step * (0.24 + pseudoRand(i + 5) * 0.36);

    if (!isFormingBar && seed.initialPattern === 'UP_FLOW') {
      if (closedIdxFromEnd <= 4) {
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

export class LocalDemoScanner {
  private candlesByAsset = new Map<string, Candle[]>();
  private regimes = new Map<
    string,
    { mode: 'CHOP' | 'FLOW_UP' | 'FLOW_DOWN'; remainingBars: number }
  >();
  private alerts: TrendAlert[] = [];
  private lastAlertedTime = new Map<string, number>();

  constructor() {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const seed of IQ_OPTION_ASSETS) {
      this.candlesByAsset.set(seed.id, buildLocalCandles(seed, nowSec));
      this.regimes.set(seed.id, {
        mode:
          seed.initialPattern === 'FORMING_UP' || seed.initialPattern === 'UP_FLOW'
            ? 'FLOW_UP'
            : seed.initialPattern === 'FORMING_DOWN' || seed.initialPattern === 'DOWN_FLOW'
              ? 'FLOW_DOWN'
              : 'CHOP',
        remainingBars: 2,
      });
    }

    const initial = this.getSnapshot(DEFAULT_SCANNER_CONFIG);
    for (const st of initial.assets) {
      if (st.analysis.status === 'MATCH' && st.analysis.direction) {
        const closedTime = st.candles[st.candles.length - 2].time;
        this.lastAlertedTime.set(st.asset.id, closedTime);
        this.alerts.unshift({
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
          createdAt: Date.now() - 3000,
          acknowledged: false,
        });
      }
    }
  }

  step(config: ScannerConfig, scanningActive: boolean): TrendAlert[] {
    const nowSec = Math.floor(Date.now() / 1000);
    const currentBarStart = Math.floor(nowSec / 60) * 60;
    const elapsedInBar = nowSec - currentBarStart;
    const newAlerts: TrendAlert[] = [];

    for (const seed of IQ_OPTION_ASSETS) {
      const list = this.candlesByAsset.get(seed.id);
      if (!list || list.length === 0) continue;
      const regime = this.regimes.get(seed.id) ?? { mode: 'CHOP' as const, remainingBars: 4 };
      const lastBar = list[list.length - 1];

      if (currentBarStart > lastBar.time) {
        if (regime.mode === 'FLOW_UP') {
          const targetClose = Number(
            (lastBar.open + seed.stepSize * (0.94 + Math.random() * 0.12)).toFixed(seed.decimals)
          );
          lastBar.close = targetClose;
          lastBar.high = Number(
            (Math.max(lastBar.open, targetClose) + seed.stepSize * 0.05).toFixed(seed.decimals)
          );
          lastBar.low = Number(
            (Math.min(lastBar.open, targetClose) - seed.stepSize * 0.04).toFixed(seed.decimals)
          );
        } else if (regime.mode === 'FLOW_DOWN') {
          const targetClose = Number(
            (lastBar.open - seed.stepSize * (0.94 + Math.random() * 0.12)).toFixed(seed.decimals)
          );
          lastBar.close = targetClose;
          lastBar.high = Number(
            (Math.max(lastBar.open, targetClose) + seed.stepSize * 0.04).toFixed(seed.decimals)
          );
          lastBar.low = Number(
            (Math.min(lastBar.open, targetClose) - seed.stepSize * 0.05).toFixed(seed.decimals)
          );
        }

        regime.remainingBars--;
        if (regime.remainingBars <= 0) {
          if (regime.mode === 'CHOP') {
            const r = Math.random();
            if (r < 0.28) {
              regime.mode = 'FLOW_UP';
              regime.remainingBars = 5 + Math.floor(Math.random() * 2);
            } else if (r < 0.56) {
              regime.mode = 'FLOW_DOWN';
              regime.remainingBars = 5 + Math.floor(Math.random() * 2);
            } else {
              regime.mode = 'CHOP';
              regime.remainingBars = 3 + Math.floor(Math.random() * 5);
            }
          } else {
            regime.mode = 'CHOP';
            regime.remainingBars = 4 + Math.floor(Math.random() * 5);
          }
        }
        this.regimes.set(seed.id, regime);

        const newOpen = lastBar.close;
        list.push({
          time: currentBarStart,
          open: newOpen,
          high: newOpen,
          low: newOpen,
          close: newOpen,
          volume: 10,
        });
        if (list.length > 60) list.shift();

        if (scanningActive && list.length >= 10) {
          const analysis = analyzeCandleTrend(list, config);
          const closedTime = list[list.length - 2].time;
          if (
            analysis.status === 'MATCH' &&
            analysis.direction &&
            this.lastAlertedTime.get(seed.id) !== closedTime
          ) {
            this.lastAlertedTime.set(seed.id, closedTime);
            const alert: TrendAlert = {
              id: `${seed.id}-${closedTime}`,
              assetId: seed.id,
              assetName: seed.name,
              assetSymbol: seed.symbol,
              category: seed.category,
              payoutPercent: seed.payoutPercent,
              direction: analysis.direction,
              runLength: analysis.runLength,
              avgWickRatio: analysis.avgWickRatio,
              uniformityScore: analysis.uniformityScore,
              priceAtAlert: list[list.length - 1].close,
              candleTime: closedTime,
              createdAt: Date.now(),
              acknowledged: false,
            };
            this.alerts.unshift(alert);
            if (this.alerts.length > 80) this.alerts.pop();
            newAlerts.push(alert);
          }
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
          drift = lastBar.close - lastBar.open + (Math.random() - 0.5) * seed.stepSize * 0.45;
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

    return newAlerts;
  }

  markDecision(alertId: string, decisionNote: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED') {
    const found = this.alerts.find((a) => a.id === alertId);
    if (found) {
      found.decisionNote = decisionNote;
      found.acknowledged = true;
    }
    return found ?? null;
  }

  getSnapshot(config: ScannerConfig): {
    assets: ScannedAssetState[];
    alerts: TrendAlert[];
  } {
    const nowSec = Math.floor(Date.now() / 1000);
    const currentBarStart = Math.floor(nowSec / 60) * 60;
    const secondsRemaining = Math.max(0, 60 - (nowSec - currentBarStart));

    const states: ScannedAssetState[] = IQ_OPTION_ASSETS.map((seed) => {
      const candles = this.candlesByAsset.get(seed.id) ?? [];
      const analysis = analyzeCandleTrend(candles, config);
      const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : seed.basePrice;
      return {
        asset: {
          id: seed.id,
          iqActiveId: seed.iqActiveId,
          name: seed.name,
          symbol: seed.symbol,
          category: seed.category,
          isOtc: seed.isOtc,
          payoutPercent: seed.payoutPercent,
          decimals: seed.decimals,
        },
        candles: candles.map((c) => ({ ...c })),
        analysis,
        lastPrice,
        secondsRemaining,
        updatedAt: Date.now(),
      };
    });

    const rank = (status: string) =>
      status === 'MATCH' ? 0 : status === 'FORMING' ? 1 : status === 'OVEREXTENDED' ? 2 : 3;

    states.sort((a, b) => {
      const r = rank(a.analysis.status) - rank(b.analysis.status);
      if (r !== 0) return r;
      return b.analysis.uniformityScore - a.analysis.uniformityScore;
    });

    return {
      assets: states,
      alerts: [...this.alerts],
    };
  }
}
