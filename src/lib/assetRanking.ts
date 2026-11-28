import { scoreCandlesForAiRanking } from './aiPatternLearner.ts';
import type {
  AiPatternModel,
  Candle,
  PatternFeedbackSample,
  ScannedAssetState,
  TrendDirection,
} from './types.ts';

export interface AssetFlowRankInfo {
  hasData: boolean;
  tier: number; // 0 = MATCH, 1 = FORMING, 2 = NONE (waiting flow), 3 = OVEREXTENDED, 4 = no data
  flowCount: number; // consecutive/pullback flowing candle count (most -> top, least -> bottom)
  counterCandles: number; // 0 = same color only, 1..2 = mixed-color pullback candles
  avgBodyToMedianRatio: number; // average body size vs M15 median body (e.g. 0.96x)
  avgBodyRangePct: number; // 0..100 body portion of full candle range
  avgWickRatio: number; // 0..1 wick portion of full candle range
  aiBeautyScore?: number; // 0..100 computed only when user has taught AI
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

function getMedianBodyForCandles(candles: Candle[]): number {
  const slice = candles.length >= 2 ? candles.slice(-16, -1) : candles;
  const bodies = slice
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  return median(bodies);
}

function resolveEndIndex(candles: Candle[], medBody: number): number {
  let endIdx = candles.length - 1;
  if (candles.length >= 2 && medBody > 0) {
    const live = candles[candles.length - 1];
    const liveBody = Math.abs(live.close - live.open);
    if (liveBody < medBody * 0.25) {
      endIdx = candles.length - 2;
    }
  }
  return endIdx;
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

  const medBody = getMedianBodyForCandles(candles);
  const endIdx = resolveEndIndex(candles, medBody);

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

/**
 * Detects a 5-6 candle flowing trend containing 1-2 pullback (counter-color) candles.
 */
function detectMixedPullbackFlow(candles: Candle[]): {
  count: number;
  counterCandles: number;
  direction: TrendDirection | null;
  indices: number[];
} {
  if (candles.length < 5) {
    return { count: 0, counterCandles: 0, direction: null, indices: [] };
  }
  const medBody = getMedianBodyForCandles(candles);
  const endIdx = resolveEndIndex(candles, medBody);
  const anchor = candles[endIdx];
  if (!anchor) return { count: 0, counterCandles: 0, direction: null, indices: [] };
  const dir: TrendDirection | null =
    anchor.close > anchor.open ? 'UP' : anchor.close < anchor.open ? 'DOWN' : null;
  if (!dir) return { count: 0, counterCandles: 0, direction: null, indices: [] };

  const safeMed = medBody > 0 ? medBody : Math.abs(anchor.close - anchor.open);
  const indices: number[] = [];
  let counterCount = 0;

  for (let offset = 0; offset < 6; offset++) {
    const idx = endIdx - offset;
    if (idx < 0) break;
    const c = candles[idx];
    const body = Math.abs(c.close - c.open);
    const barDir: TrendDirection | null =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : null;

    if (barDir === dir) {
      indices.unshift(idx);
    } else if (
      offset > 0 &&
      counterCount < 2 &&
      indices.length < 6 &&
      body <= safeMed * 0.85
    ) {
      const rem = 2 - counterCount;
      const pbIndices: number[] = [];
      let probe = idx;
      while (pbIndices.length < rem && probe >= 0 && endIdx - probe < 6) {
        const pc = candles[probe];
        const pDir = pc.close > pc.open ? 'UP' : pc.close < pc.open ? 'DOWN' : null;
        if (pDir === dir) break;
        if (Math.abs(pc.close - pc.open) > safeMed * 0.85) {
          pbIndices.length = 0;
          break;
        }
        pbIndices.unshift(probe);
        probe--;
      }

      if (
        pbIndices.length === 0 ||
        probe < 0 ||
        indices.length + pbIndices.length + 1 > 6
      ) {
        break;
      }

      const priorLegIndices: number[] = [];
      let legProbe = probe;
      while (legProbe >= 0 && endIdx - legProbe < 6) {
        const lc = candles[legProbe];
        const lDir = lc.close > lc.open ? 'UP' : lc.close < lc.open ? 'DOWN' : null;
        if (lDir !== dir) break;
        priorLegIndices.unshift(legProbe);
        legProbe--;
      }
      if (priorLegIndices.length === 0) break;

      const priorStart = candles[priorLegIndices[0]];
      const priorEnd = candles[priorLegIndices[priorLegIndices.length - 1]];
      const avgPriorBody =
        priorLegIndices.reduce(
          (s, li) => s + Math.abs(candles[li].close - candles[li].open),
          0
        ) / priorLegIndices.length;
      const maxPbBody = Math.max(
        ...pbIndices.map((pi) => Math.abs(candles[pi].close - candles[pi].open))
      );

      const priorGain =
        dir === 'UP'
          ? priorEnd.close - priorStart.open
          : priorStart.open - priorEnd.close;
      const pullbackDepth =
        dir === 'UP'
          ? priorEnd.close -
            Math.min(...pbIndices.map((pi) => Math.min(candles[pi].open, candles[pi].close)))
          : Math.max(...pbIndices.map((pi) => Math.max(candles[pi].open, candles[pi].close))) -
            priorEnd.close;

      if (
        priorGain > 0 &&
        pullbackDepth < priorGain * 0.78 &&
        maxPbBody <= avgPriorBody * 0.88
      ) {
        counterCount += pbIndices.length;
        for (let k = pbIndices.length - 1; k >= 0; k--) {
          indices.unshift(pbIndices[k]);
        }
        offset += pbIndices.length - 1;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  while (indices.length > 0) {
    const first = candles[indices[0]];
    const fDir = first.close > first.open ? 'UP' : first.close < first.open ? 'DOWN' : null;
    if (fDir === dir) break;
    indices.shift();
  }

  if (indices.length < 5 || counterCount === 0 || counterCount > 2) {
    return { count: 0, counterCandles: 0, direction: null, indices: [] };
  }

  const sameCount = indices.filter((i) => {
    const c = candles[i];
    return dir === 'UP' ? c.close > c.open : c.close < c.open;
  }).length;
  const firstBar = candles[indices[0]];
  const lastBar = candles[indices[indices.length - 1]];
  const netMove = dir === 'UP' ? lastBar.close - firstBar.open : firstBar.open - lastBar.close;

  if (sameCount < 3 || netMove <= safeMed * 0.9) {
    return { count: 0, counterCandles: 0, direction: null, indices: [] };
  }

  return {
    count: indices.length,
    counterCandles: counterCount,
    direction: dir,
    indices,
  };
}

function computeBodyAndWickFromCandles(
  candles: Candle[],
  indices: number[],
  dir: TrendDirection | null,
  medBody: number
): { avgBodyToMedianRatio: number; avgBodyRangePct: number; avgWickRatio: number } {
  const selected = indices
    .map((i) => candles[i])
    .filter((c): c is Candle => Boolean(c));
  if (selected.length === 0) {
    return { avgBodyToMedianRatio: 0, avgBodyRangePct: 0, avgWickRatio: 0 };
  }
  const sameDir = dir
    ? selected.filter((c) => (dir === 'UP' ? c.close >= c.open : c.close <= c.open))
    : selected;
  const sample = sameDir.length > 0 ? sameDir : selected;

  let bodySum = 0;
  let wickRatioSum = 0;
  let bodyRangePctSum = 0;
  for (const c of sample) {
    const body = Math.abs(c.close - c.open);
    const range = Math.max(c.high - c.low, body);
    const upWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickRatio = range > 0 ? (upWick + lowWick) / range : 0;
    const bodyPct = range > 0 ? Math.min(100, Math.max(0, (body / range) * 100)) : 0;
    bodySum += body;
    wickRatioSum += wickRatio;
    bodyRangePctSum += bodyPct;
  }

  const meanBody = bodySum / sample.length;
  const ratio = medBody > 0 ? meanBody / medBody : 1;
  return {
    avgBodyToMedianRatio: Number(ratio.toFixed(2)),
    avgBodyRangePct: Math.round(bodyRangePctSum / sample.length),
    avgWickRatio: Number((wickRatioSum / sample.length).toFixed(3)),
  };
}

export function getAssetFlowRankInfo(
  item: ScannedAssetState,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] }
): AssetFlowRankInfo {
  const hasData = item.candles.length > 0;
  const latestCandleTime = hasData
    ? item.candles[item.candles.length - 1].time
    : 0;

  if (!hasData) {
    return {
      hasData: false,
      tier: 4,
      flowCount: 0,
      counterCandles: 0,
      avgBodyToMedianRatio: 0,
      avgBodyRangePct: 0,
      avgWickRatio: 0,
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

  const medBody = getMedianBodyForCandles(item.candles);
  const endIdx = resolveEndIndex(item.candles, medBody);
  const consecutive = countConsecutiveFlowCandles(item.candles);
  const mixed =
    st === 'NONE' && consecutive.count < 5
      ? detectMixedPullbackFlow(item.candles)
      : { count: 0, counterCandles: 0, direction: null, indices: [] };

  const useAnalysis =
    st === 'MATCH' || st === 'FORMING' || st === 'OVEREXTENDED';
  const counterCandles = useAnalysis
    ? Math.min(2, Math.max(0, item.analysis.counterCandles ?? 0))
    : mixed.counterCandles;
  const flowCount = useAnalysis
    ? Math.max(0, item.analysis.runLength)
    : mixed.counterCandles > 0
      ? mixed.count
      : consecutive.count;
  const direction = useAnalysis
    ? item.analysis.direction
    : mixed.direction ?? consecutive.direction ?? item.analysis.direction;

  // Build indices covering the detected flow to measure body length & wick ratio reliably
  let metricIndices: number[] = [];
  if (useAnalysis && item.analysis.matchedIndices.length > 0) {
    metricIndices = item.analysis.matchedIndices;
  } else if (mixed.indices.length > 0) {
    metricIndices = mixed.indices;
  } else if (consecutive.count > 0) {
    const start = Math.max(0, endIdx - consecutive.count + 1);
    for (let i = start; i <= endIdx; i++) metricIndices.push(i);
  } else {
    metricIndices = [endIdx];
  }

  const computedStats = computeBodyAndWickFromCandles(
    item.candles,
    metricIndices,
    direction,
    medBody
  );
  const avgBodyToMedianRatio =
    useAnalysis && item.analysis.avgBodyToMedianRatio > 0
      ? Number(item.analysis.avgBodyToMedianRatio.toFixed(2))
      : computedStats.avgBodyToMedianRatio;
  const avgWickRatio =
    useAnalysis && item.analysis.avgWickRatio > 0
      ? item.analysis.avgWickRatio
      : computedStats.avgWickRatio;
  const avgBodyRangePct = computedStats.avgBodyRangePct;

  const hasUserAi =
    Boolean(aiContext) &&
    (aiContext!.model.passCount > 0 || aiContext!.model.rejectCount > 0);
  const aiBeautyScore = hasUserAi
    ? scoreCandlesForAiRanking(
        item.candles,
        item.analysis.emaValues,
        item.analysis.patternFeatures,
        item.analysis.runLength,
        item.analysis.aiSimilarityScore,
        aiContext!.model,
        aiContext!.samples
      )
    : item.analysis.aiSimilarityScore;

  return {
    hasData: true,
    tier,
    flowCount,
    counterCandles,
    avgBodyToMedianRatio,
    avgBodyRangePct,
    avgWickRatio,
    aiBeautyScore,
    direction,
    latestCandleTime,
  };
}

/**
 * Deterministic comparator for asset ranking:
 * 1. Assets with candle data come before empty/loading assets.
 * 2. Highest consecutive flowing candle count first (descending) regardless of status or bar length.
 * 3. When tied on flowCount and user has taught AI: highest AI-taught beauty alignment descending.
 * 4. Quality tier (MATCH -> FORMING -> NONE -> OVEREXTENDED) then alphabetical A-Z.
 */
export function compareAssetsByFlowRank(
  a: ScannedAssetState,
  b: ScannedAssetState,
  overrideRank?: Map<string, AssetFlowRankInfo>,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] }
): number {
  const ra = overrideRank?.get(a.asset.id) ?? getAssetFlowRankInfo(a, aiContext);
  const rb = overrideRank?.get(b.asset.id) ?? getAssetFlowRankInfo(b, aiContext);

  if (ra.hasData !== rb.hasData) {
    return ra.hasData ? -1 : 1;
  }
  if (ra.flowCount !== rb.flowCount) {
    return rb.flowCount - ra.flowCount;
  }
  if (ra.aiBeautyScore !== undefined || rb.aiBeautyScore !== undefined) {
    const scoreA = ra.aiBeautyScore ?? -1;
    const scoreB = rb.aiBeautyScore ?? -1;
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
  }
  if (ra.tier !== rb.tier) {
    return ra.tier - rb.tier;
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

/**
 * Computes a deterministic ordered list of asset IDs:
 * most flowing bars descending -> user-taught AI beauty score descending -> tier -> alphabetical A-Z.
 */
export function computeLockedRankIds(
  assets: ScannedAssetState[],
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] }
): string[] {
  return [...assets]
    .sort((a, b) => compareAssetsByFlowRank(a, b, undefined, aiContext))
    .map((item) => item.asset.id);
}

/**
 * Projects live asset states onto a previously locked ID sequence so row order stays
 * completely still between scheduled 30-60s re-rank refreshes while live values stay fresh.
 */
export function orderAssetsByLockedIds(
  assets: ScannedAssetState[],
  lockedIds: string[]
): ScannedAssetState[] {
  if (lockedIds.length === 0) {
    return [...assets].sort((a, b) => compareAssetsByFlowRank(a, b));
  }
  const rankIndex = new Map<string, number>();
  lockedIds.forEach((id, index) => rankIndex.set(id, index));

  const lockedItems: ScannedAssetState[] = [];
  const newItems: ScannedAssetState[] = [];

  for (const item of assets) {
    if (rankIndex.has(item.asset.id)) {
      lockedItems.push(item);
    } else {
      newItems.push(item);
    }
  }

  lockedItems.sort(
    (a, b) => (rankIndex.get(a.asset.id) ?? 0) - (rankIndex.get(b.asset.id) ?? 0)
  );
  if (newItems.length > 1) {
    newItems.sort((a, b) => compareAssetsByFlowRank(a, b));
  }
  return [...lockedItems, ...newItems];
}

export interface CommittedAssetStatusSnapshot {
  status: ScannedAssetState['analysis']['status'];
  direction: TrendDirection | null;
  matchScore: number;
  lastPrice: number;
}

export interface CommittedRankSnapshot {
  barEpoch: number;
  orderedIds: string[];
  rankInfoById: Map<string, AssetFlowRankInfo>;
  statusById: Map<string, CommittedAssetStatusSnapshot>;
  assetsWithDataCount: number;
}

export interface PendingBarEpochState {
  epoch: number;
  firstSeenMs: number;
}

/**
 * Finds the highest 1-minute candle epoch held by at least `minRatio` of assets with candle data.
 * Falls back to the modal (most common) epoch if none reaches `minRatio`.
 */
export function getConsensusBarEpoch(
  assets: ScannedAssetState[],
  minRatio = 0.5
): number {
  const counts = new Map<number, number>();
  let totalWithData = 0;
  for (const a of assets) {
    const last = a.candles[a.candles.length - 1];
    if (last && last.time > 0) {
      totalWithData++;
      counts.set(last.time, (counts.get(last.time) ?? 0) + 1);
    }
  }
  if (totalWithData === 0) return 0;

  let highestQualifying = 0;
  let bestCount = -1;
  let modalEpoch = 0;

  for (const [epoch, count] of counts.entries()) {
    if (count / totalWithData >= minRatio && epoch > highestQualifying) {
      highestQualifying = epoch;
    }
    if (count > bestCount || (count === bestCount && epoch > modalEpoch)) {
      bestCount = count;
      modalEpoch = epoch;
    }
  }

  return highestQualifying > 0 ? highestQualifying : modalEpoch;
}

/**
 * Captures a complete candle-close snapshot of ranking order, flow metrics, and table membership
 * so the sidebar ranking stays 100% motionless until the next 1-minute candle finishes.
 */
export function buildCommittedRankSnapshot(
  assets: ScannedAssetState[],
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] },
  explicitEpoch?: number
): CommittedRankSnapshot {
  const sorted = [...assets].sort((a, b) =>
    compareAssetsByFlowRank(a, b, undefined, aiContext)
  );
  const rankInfoById = new Map<string, AssetFlowRankInfo>();
  const statusById = new Map<string, CommittedAssetStatusSnapshot>();
  let assetsWithDataCount = 0;

  for (const item of sorted) {
    if (item.candles.length > 0) assetsWithDataCount++;
    rankInfoById.set(item.asset.id, getAssetFlowRankInfo(item, aiContext));
    statusById.set(item.asset.id, {
      status: item.analysis.status,
      direction: item.analysis.direction,
      matchScore: item.analysis.matchScore,
      lastPrice: item.lastPrice,
    });
  }

  const barEpoch =
    typeof explicitEpoch === 'number' && explicitEpoch > 0
      ? explicitEpoch
      : getConsensusBarEpoch(assets);

  return {
    barEpoch,
    orderedIds: sorted.map((s) => s.asset.id),
    rankInfoById,
    statusById,
    assetsWithDataCount,
  };
}

/**
 * Determines whether the ranking snapshot should update:
 * - Only on initial candle hydration, OR
 * - When a 1-minute candle actually finishes (consensus epoch advances across assets).
 * Mid-minute live candle ticks NEVER trigger a re-rank regardless of rank/status swings.
 */
export function evaluateCandleCloseRankUpdate(
  snapshot: CommittedRankSnapshot | null,
  assets: ScannedAssetState[],
  nowMs: number,
  pendingEpochState: PendingBarEpochState | null
): {
  shouldUpdate: boolean;
  targetEpoch: number;
  nextPending: PendingBarEpochState | null;
} {
  if (assets.length === 0) {
    return {
      shouldUpdate: snapshot !== null && snapshot.orderedIds.length > 0,
      targetEpoch: 0,
      nextPending: null,
    };
  }

  const counts = new Map<number, number>();
  let withDataCount = 0;
  for (const a of assets) {
    const last = a.candles[a.candles.length - 1];
    if (last && last.time > 0) {
      withDataCount++;
      counts.set(last.time, (counts.get(last.time) ?? 0) + 1);
    }
  }

  const consensusEpoch = getConsensusBarEpoch(assets, 0.5);

  if (
    !snapshot ||
    snapshot.orderedIds.length === 0 ||
    (snapshot.assetsWithDataCount === 0 && withDataCount > 0)
  ) {
    return {
      shouldUpdate: true,
      targetEpoch: consensusEpoch,
      nextPending: null,
    };
  }

  // Initial progressive hydration grace (e.g. live WebSocket loading 5 -> 60 pairs in first 1-2s)
  if (
    snapshot.assetsWithDataCount < Math.ceil(assets.length * 0.5) &&
    withDataCount >= snapshot.assetsWithDataCount + 5
  ) {
    return {
      shouldUpdate: true,
      targetEpoch: consensusEpoch,
      nextPending: null,
    };
  }

  if (withDataCount === 0 || snapshot.barEpoch <= 0) {
    return {
      shouldUpdate: false,
      targetEpoch: consensusEpoch,
      nextPending: null,
    };
  }

  let majorityEpoch = 0;
  let quarterEpoch = 0;
  for (const [epoch, count] of counts.entries()) {
    const ratio = count / withDataCount;
    if (ratio >= 0.8 && epoch > majorityEpoch) {
      majorityEpoch = epoch;
    }
    if (ratio >= 0.25 && epoch > quarterEpoch) {
      quarterEpoch = epoch;
    }
  }

  // All/most pairs closed the 1-minute candle cleanly -> update immediately
  if (majorityEpoch > snapshot.barEpoch) {
    return {
      shouldUpdate: true,
      targetEpoch: majorityEpoch,
      nextPending: null,
    };
  }

  // Live staggered feed: once >= 25% of pairs advance, allow up to 2s settle window for stragglers then lock once
  if (quarterEpoch > snapshot.barEpoch) {
    if (pendingEpochState && pendingEpochState.epoch === quarterEpoch) {
      if (nowMs - pendingEpochState.firstSeenMs >= 2000) {
        return {
          shouldUpdate: true,
          targetEpoch: quarterEpoch,
          nextPending: null,
        };
      }
      return {
        shouldUpdate: false,
        targetEpoch: snapshot.barEpoch,
        nextPending: pendingEpochState,
      };
    }
    return {
      shouldUpdate: false,
      targetEpoch: snapshot.barEpoch,
      nextPending: { epoch: quarterEpoch, firstSeenMs: nowMs },
    };
  }

  return {
    shouldUpdate: false,
    targetEpoch: snapshot.barEpoch,
    nextPending: null,
  };
}

/**
 * Projects live asset states strictly onto a committed candle-close snapshot so rows stay
 * completely frozen in their exact rank, table, and status until the 1m candle finishes.
 */
export function projectAssetsWithCommittedSnapshot(
  assets: ScannedAssetState[],
  snapshot: CommittedRankSnapshot | null
): ScannedAssetState[] {
  if (!snapshot || snapshot.orderedIds.length === 0) {
    return [...assets];
  }
  const byId = new Map<string, ScannedAssetState>();
  for (const item of assets) {
    byId.set(item.asset.id, item);
  }

  const ordered: ScannedAssetState[] = [];
  const seen = new Set<string>();
  for (const id of snapshot.orderedIds) {
    const found = byId.get(id);
    if (found) {
      ordered.push(found);
      seen.add(id);
    }
  }
  for (const item of assets) {
    if (!seen.has(item.asset.id)) {
      ordered.push(item);
    }
  }
  return ordered;
}

