import { scoreCandlesForAiRanking } from './aiPatternLearner.ts';
import { getConsensusBarEpoch } from './assetRanking.ts';
import { getClosedM15MedianBody } from './candleBodyStats.ts';
import {
  AiPatternModel,
  Candle,
  DEFAULT_SPECIAL_FLOW_CONFIG,
  PatternFeedbackSample,
  ScannedAssetState,
  SpecialFlowFilterConfig,
  TrendAnalysis,
  TrendDirection,
} from './types.ts';

export interface SpecialFlowEvalResult {
  qualified: boolean;
  matchedBars: number;
  direction: TrendDirection | null;
  bodyDiffRatio: number;
  wickDiffRatio: number;
  maxBodyRatio: number;
  maxWickRatio: number;
  avgBodyRatio: number;
  avgWickRatio: number;
  avgWickPct: number;
  matchScore: number;
  aiBeautyScore?: number;
  status: TrendAnalysis['status'];
}

export interface SpecialFlowRankSnapshot {
  barEpoch: number;
  orderedIds: string[];
  evalById: Map<string, SpecialFlowEvalResult>;
  configSignature: string;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampRatio(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return Number(clamped.toFixed(2));
}

export function sanitizeSpecialFlowConfig(
  raw?: Partial<SpecialFlowFilterConfig> | null
): SpecialFlowFilterConfig {
  if (!raw) return { ...DEFAULT_SPECIAL_FLOW_CONFIG };
  const minBars = clampInt(raw.minBars, 2, 8, DEFAULT_SPECIAL_FLOW_CONFIG.minBars);
  const maxBars = Math.max(
    minBars,
    clampInt(raw.maxBars, 2, 10, DEFAULT_SPECIAL_FLOW_CONFIG.maxBars)
  );
  const fixedBars = clampInt(
    raw.fixedBars,
    2,
    10,
    DEFAULT_SPECIAL_FLOW_CONFIG.fixedBars
  );

  return {
    barMode:
      raw.barMode === 'FIXED' || raw.barMode === 'RANGE'
        ? raw.barMode
        : DEFAULT_SPECIAL_FLOW_CONFIG.barMode,
    minBars,
    maxBars,
    fixedBars,
    maxBodyDiffRatio: clampRatio(
      raw.maxBodyDiffRatio,
      0,
      2,
      DEFAULT_SPECIAL_FLOW_CONFIG.maxBodyDiffRatio
    ),
    maxWickDiffRatio: clampRatio(
      raw.maxWickDiffRatio,
      0,
      2,
      DEFAULT_SPECIAL_FLOW_CONFIG.maxWickDiffRatio
    ),
  };
}

export function getSpecialFlowConfigSignature(cfg: SpecialFlowFilterConfig): string {
  return [
    cfg.barMode,
    cfg.minBars,
    cfg.maxBars,
    cfg.fixedBars,
    cfg.maxBodyDiffRatio.toFixed(2),
    cfg.maxWickDiffRatio.toFixed(2),
  ].join('|');
}

function getEndIndex(candles: Candle[], medBody: number): number {
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

function measureWindowStats(
  candles: Candle[],
  startIdx: number,
  endIdx: number,
  medBody: number
): {
  sameColor: boolean;
  direction: TrendDirection | null;
  bodyDiffRatio: number;
  wickDiffRatio: number;
  maxBodyRatio: number;
  maxWickRatio: number;
  avgBodyRatio: number;
  avgWickRatio: number;
  avgWickPct: number;
} {
  const first = candles[startIdx];
  const dir: TrendDirection | null =
    first.close > first.open ? 'UP' : first.close < first.open ? 'DOWN' : null;
  if (!dir || medBody <= 0) {
    return {
      sameColor: false,
      direction: null,
      bodyDiffRatio: 99,
      wickDiffRatio: 99,
      maxBodyRatio: 99,
      maxWickRatio: 99,
      avgBodyRatio: 0,
      avgWickRatio: 0,
      avgWickPct: 0,
    };
  }

  let sameColor = true;
  let minBody = Infinity;
  let maxBody = -Infinity;
  let minWick = Infinity;
  let maxWick = -Infinity;
  let bodySum = 0;
  let wickSum = 0;
  let wickPctSum = 0;
  const count = endIdx - startIdx + 1;

  for (let i = startIdx; i <= endIdx; i++) {
    const c = candles[i];
    const barDir: TrendDirection | null =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : null;
    if (barDir !== dir) {
      sameColor = false;
      break;
    }
    const body = Math.abs(c.close - c.open);
    const totalRange = Math.max(c.high - c.low, body);
    const upWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickLen = upWick + lowWick;

    const bodyRatio = Number((body / medBody).toFixed(2));
    const wickRatio = Number((wickLen / medBody).toFixed(2));
    const wickPct =
      totalRange > 0 ? Math.min(100, Math.max(0, (wickLen / totalRange) * 100)) : 0;

    if (bodyRatio < minBody) minBody = bodyRatio;
    if (bodyRatio > maxBody) maxBody = bodyRatio;
    if (wickRatio < minWick) minWick = wickRatio;
    if (wickRatio > maxWick) maxWick = wickRatio;

    bodySum += bodyRatio;
    wickSum += wickRatio;
    wickPctSum += wickPct;
  }

  if (!sameColor || count <= 0) {
    return {
      sameColor: false,
      direction: null,
      bodyDiffRatio: 99,
      wickDiffRatio: 99,
      maxBodyRatio: 99,
      maxWickRatio: 99,
      avgBodyRatio: 0,
      avgWickRatio: 0,
      avgWickPct: 0,
    };
  }

  return {
    sameColor: true,
    direction: dir,
    bodyDiffRatio: Number(Math.max(0, maxBody - minBody).toFixed(2)),
    wickDiffRatio: Number(Math.max(0, maxWick - minWick).toFixed(2)),
    maxBodyRatio: Number(maxBody.toFixed(2)),
    maxWickRatio: Number(maxWick.toFixed(2)),
    avgBodyRatio: Number((bodySum / count).toFixed(2)),
    avgWickRatio: Number((wickSum / count).toFixed(2)),
    avgWickPct: Math.round(wickPctSum / count),
  };
}

/**
 * Evaluates whether an asset qualifies for Special Curated Table 1 (คัดพิเศษ — Spread Only):
 * - Same-color consecutive flowing candles matching the configured window (e.g., 4-6 or fixed 4..8)
 * - Candle body spread across the window <= maxBodyDiffRatio (default 0.40x, range 0.00..2.00x)
 * - Candle wick spread across the window <= maxWickDiffRatio (default 0.30x, range 0.00..2.00x)
 */
export function evaluateAssetForSpecialFlow(
  item: ScannedAssetState,
  rawConfig?: Partial<SpecialFlowFilterConfig> | null,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] }
): SpecialFlowEvalResult {
  const cfg = sanitizeSpecialFlowConfig(rawConfig);
  const candles = item.candles;
  const emptyResult = (aiBeautyScore?: number): SpecialFlowEvalResult => ({
    qualified: false,
    matchedBars: 0,
    direction: null,
    bodyDiffRatio: 0,
    wickDiffRatio: 0,
    maxBodyRatio: 0,
    maxWickRatio: 0,
    avgBodyRatio: 0,
    avgWickRatio: 0,
    avgWickPct: 0,
    matchScore: item.analysis.matchScore,
    aiBeautyScore,
    status: item.analysis.status,
  });

  if (candles.length < 3) {
    return emptyResult();
  }

  const medBody = getClosedM15MedianBody(candles);
  const endIdx = getEndIndex(candles, medBody);
  if (medBody <= 0 || endIdx < 1) {
    return emptyResult();
  }

  const candidateLengths: number[] = [];
  if (cfg.barMode === 'FIXED') {
    if (endIdx + 1 >= cfg.fixedBars) {
      candidateLengths.push(cfg.fixedBars);
    }
  } else {
    const maxLen = Math.min(cfg.maxBars, endIdx + 1);
    for (let k = maxLen; k >= cfg.minBars; k--) {
      candidateLengths.push(k);
    }
  }

  const hasUserAi =
    Boolean(aiContext) &&
    (aiContext!.model.passCount > 0 || aiContext!.model.rejectCount > 0);
  const aiBeautyScore = hasUserAi
    ? scoreCandlesForAiRanking(
        candles,
        item.analysis.emaValues,
        item.analysis.patternFeatures,
        item.analysis.runLength,
        item.analysis.aiSimilarityScore,
        aiContext!.model,
        aiContext!.samples
      )
    : item.analysis.aiSimilarityScore;

  const eps = 1e-6;
  for (const len of candidateLengths) {
    const startIdx = endIdx - len + 1;
    const stats = measureWindowStats(candles, startIdx, endIdx, medBody);
    if (!stats.sameColor || !stats.direction) continue;

    if (
      stats.bodyDiffRatio <= cfg.maxBodyDiffRatio + eps &&
      stats.wickDiffRatio <= cfg.maxWickDiffRatio + eps
    ) {
      return {
        qualified: true,
        matchedBars: len,
        direction: stats.direction,
        bodyDiffRatio: stats.bodyDiffRatio,
        wickDiffRatio: stats.wickDiffRatio,
        maxBodyRatio: stats.maxBodyRatio,
        maxWickRatio: stats.maxWickRatio,
        avgBodyRatio: stats.avgBodyRatio,
        avgWickRatio: stats.avgWickRatio,
        avgWickPct: stats.avgWickPct,
        matchScore: item.analysis.matchScore,
        aiBeautyScore,
        status: item.analysis.status,
      };
    }
  }

  return emptyResult(aiBeautyScore);
}

/**
 * Builds a candle-close frozen ranking snapshot strictly for Special Table 1 (คัดพิเศษ):
 * - Sorted descending by highest matched flowing candle count
 * - Tied counts broken by AI beauty score (if trained), tightest spread (bodyDiff + wickDiff), then A-Z
 */
export function buildSpecialFlowRankSnapshot(
  assets: ScannedAssetState[],
  rawConfig?: Partial<SpecialFlowFilterConfig> | null,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] },
  explicitEpoch?: number
): SpecialFlowRankSnapshot {
  const cfg = sanitizeSpecialFlowConfig(rawConfig);
  const evalById = new Map<string, SpecialFlowEvalResult>();
  const qualifying: Array<{ item: ScannedAssetState; evalResult: SpecialFlowEvalResult }> = [];

  for (const item of assets) {
    const res = evaluateAssetForSpecialFlow(item, cfg, aiContext);
    evalById.set(item.asset.id, res);
    if (res.qualified) {
      qualifying.push({ item, evalResult: res });
    }
  }

  qualifying.sort((a, b) => {
    if (a.evalResult.matchedBars !== b.evalResult.matchedBars) {
      return b.evalResult.matchedBars - a.evalResult.matchedBars;
    }
    if (
      a.evalResult.aiBeautyScore !== undefined ||
      b.evalResult.aiBeautyScore !== undefined
    ) {
      const sa = a.evalResult.aiBeautyScore ?? -1;
      const sb = b.evalResult.aiBeautyScore ?? -1;
      if (sa !== sb) return sb - sa;
    }
    const spreadA = a.evalResult.bodyDiffRatio + a.evalResult.wickDiffRatio;
    const spreadB = b.evalResult.bodyDiffRatio + b.evalResult.wickDiffRatio;
    if (Math.abs(spreadA - spreadB) > 1e-6) {
      return spreadA - spreadB;
    }
    const nameCmp = a.item.asset.name.localeCompare(b.item.asset.name, 'en', {
      sensitivity: 'base',
    });
    if (nameCmp !== 0) return nameCmp;
    return a.item.asset.id.localeCompare(b.item.asset.id, 'en', { sensitivity: 'base' });
  });

  const barEpoch =
    typeof explicitEpoch === 'number' && explicitEpoch > 0
      ? explicitEpoch
      : getConsensusBarEpoch(assets);

  return {
    barEpoch,
    orderedIds: qualifying.map((q) => q.item.asset.id),
    evalById,
    configSignature: getSpecialFlowConfigSignature(cfg),
  };
}
