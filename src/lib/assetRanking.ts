import type { Candle, ScannedAssetState, TrendDirection } from './types.ts';

export interface AssetFlowRankInfo {
  hasData: boolean;
  tier: number; // 0 = MATCH, 1 = FORMING, 2 = NONE (waiting flow), 3 = OVEREXTENDED, 4 = no data
  flowCount: number; // consecutive flowing candle count (more bars -> higher priority)
  direction: TrendDirection | null;
  latestCandleTime: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Counts consecutive same-color candles at the right edge of the candle series.
 * Ignores tiny opening-second noise on the forming candle (< 25% of recent median body)
 * so the ranking table never flickers back and forth on 1-pip micro-ticks.
 */
export function countConsecutiveFlowCandles(candles: Candle[]): {
  count: number;
  direction: TrendDirection | null;
} {
  if (candles.length === 0) {
    return { count: 0, direction: null };
  }

  const closedSlice = candles.length >= 2 ? candles.slice(-16, -1) : candles;
  const closedBodies = closedSlice
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  const medBody = median(closedBodies);

  let endIdx = candles.length - 1;
  if (candles.length >= 2 && medBody > 0) {
    const live = candles[candles.length - 1];
    const liveBody = Math.abs(live.close - live.open);
    if (liveBody < medBody * 0.25) {
      endIdx = candles.length - 2;
    }
  }

  const anchor = candles[endIdx];
  if (!anchor) return { count: 0, direction: null };
  const dir: TrendDirection | null =
    anchor.close > anchor.open ? 'UP' : anchor.close < anchor.open ? 'DOWN' : null;
  if (!dir) return { count: 0, direction: null };

  let count = 0;
  for (let i = endIdx; i >= 0; i--) {
    const c = candles[i];
    const barDir: TrendDirection | null =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : null;
    if (barDir === dir) {
      count++;
    } else {
      break;
    }
  }

  return { count, direction: dir };
}

export function getAssetFlowRankInfo(item: ScannedAssetState): AssetFlowRankInfo {
  const hasData = item.candles.length > 0;
  const latestCandleTime = hasData
    ? item.candles[item.candles.length - 1].time
    : 0;

  if (!hasData) {
    return {
      hasData: false,
      tier: 4,
      flowCount: 0,
      direction: null,
      latestCandleTime: 0,
    };
  }

  const st = item.analysis.status;
  const tier =
    st === 'MATCH'
      ? 0
      : st === 'FORMING'
        ? 1
        : st === 'OVEREXTENDED'
          ? 3
          : 2;

  if (st === 'MATCH' || st === 'FORMING' || st === 'OVEREXTENDED') {
    return {
      hasData: true,
      tier,
      flowCount: Math.max(0, item.analysis.runLength),
      direction: item.analysis.direction,
      latestCandleTime,
    };
  }

  const consecutive = countConsecutiveFlowCandles(item.candles);
  return {
    hasData: true,
    tier,
    flowCount: consecutive.count,
    direction: consecutive.direction ?? item.analysis.direction,
    latestCandleTime,
  };
}

/**
 * Stable deterministic comparator for asset ranking:
 * 1. Assets with candle data come before empty/loading assets.
 * 2. Active & waiting trend-flow tier: MATCH (0) -> FORMING (1) -> NONE waiting (2) -> OVEREXTENDED (3).
 * 3. Higher consecutive flowing candle count first (descending).
 * 4. Alphabetical by asset name (ascending) when tied — never swaps on micro score ticks.
 */
export function compareAssetsByFlowRank(
  a: ScannedAssetState,
  b: ScannedAssetState,
  overrideRank?: Map<string, AssetFlowRankInfo>
): number {
  const ra = overrideRank?.get(a.asset.id) ?? getAssetFlowRankInfo(a);
  const rb = overrideRank?.get(b.asset.id) ?? getAssetFlowRankInfo(b);

  if (ra.hasData !== rb.hasData) {
    return ra.hasData ? -1 : 1;
  }
  if (ra.tier !== rb.tier) {
    return ra.tier - rb.tier;
  }
  if (ra.flowCount !== rb.flowCount) {
    return rb.flowCount - ra.flowCount;
  }
  const nameCmp = a.asset.name.localeCompare(b.asset.name, 'en', {
    sensitivity: 'base',
  });
  if (nameCmp !== 0) return nameCmp;
  return a.asset.id.localeCompare(b.asset.id, 'en', { sensitivity: 'base' });
}

export interface RankStabilityTracker {
  committed: Map<string, AssetFlowRankInfo>;
  pending: Map<string, { info: AssetFlowRankInfo; streak: number }>;
}

export function createRankStabilityTracker(
  initialAssets: ScannedAssetState[] = []
): RankStabilityTracker {
  const committed = new Map<string, AssetFlowRankInfo>();
  for (const item of initialAssets) {
    committed.set(item.asset.id, getAssetFlowRankInfo(item));
  }
  return {
    committed,
    pending: new Map(),
  };
}

/**
 * Updates committed rank info only when:
 * - asset is new or just received candle data,
 * - a new 1m candle opened/closed (candle time changed), OR
 * - a mid-candle tier/flowCount change persists for `confirmTicks` consecutive updates.
 * Prevents the sidebar ranking from jumping back and forth on single-tick threshold wobbles.
 */
export function advanceRankStabilityTracker(
  tracker: RankStabilityTracker,
  assets: ScannedAssetState[],
  confirmTicks = 3
): Map<string, AssetFlowRankInfo> {
  const activeIds = new Set<string>();

  for (const item of assets) {
    const id = item.asset.id;
    activeIds.add(id);
    const nextInfo = getAssetFlowRankInfo(item);
    const prevCommitted = tracker.committed.get(id);

    if (
      !prevCommitted ||
      (!prevCommitted.hasData && nextInfo.hasData) ||
      nextInfo.latestCandleTime !== prevCommitted.latestCandleTime
    ) {
      tracker.committed.set(id, nextInfo);
      tracker.pending.delete(id);
      continue;
    }

    if (
      prevCommitted.tier === nextInfo.tier &&
      prevCommitted.flowCount === nextInfo.flowCount
    ) {
      // Keep direction fresh while rank position stays identical
      tracker.committed.set(id, nextInfo);
      tracker.pending.delete(id);
      continue;
    }

    const prevPending = tracker.pending.get(id);
    if (
      prevPending &&
      prevPending.info.tier === nextInfo.tier &&
      prevPending.info.flowCount === nextInfo.flowCount
    ) {
      const nextStreak = prevPending.streak + 1;
      if (nextStreak >= confirmTicks) {
        tracker.committed.set(id, nextInfo);
        tracker.pending.delete(id);
      } else {
        tracker.pending.set(id, { info: nextInfo, streak: nextStreak });
      }
    } else {
      tracker.pending.set(id, { info: nextInfo, streak: 1 });
    }
  }

  for (const existingId of Array.from(tracker.committed.keys())) {
    if (!activeIds.has(existingId)) {
      tracker.committed.delete(existingId);
      tracker.pending.delete(existingId);
    }
  }

  return new Map(tracker.committed);
}
