import { scoreCandlesForAiRanking } from './aiPatternLearner.ts';
import { getConsensusBarEpoch } from './assetRanking.ts';
import { getClosedM15MedianBody } from './candleBodyStats.ts';
import {
  AiPatternModel,
  Candle,
  DEFAULT_SPECIAL_LENGTH_CONFIG,
  PatternFeedbackSample,
  ScannedAssetState,
  SpecialLengthFilterConfig,
  TrendAnalysis,
  TrendDirection,
} from './types.ts';

export interface SpecialLengthEvalResult {
  qualified: boolean;
  matchedBars: number;
  direction: TrendDirection | null;
  maxBodyRatio: number;
  maxWickRatio: number;
  avgBodyRatio: number;
  avgWickRatio: number;
  avgWickPct: number;
  matchScore: number;
  aiBeautyScore?: number;
  status: TrendAnalysis['status'];
}

export interface SpecialLengthRankSnapshot {
  barEpoch: number;
  orderedIds: string[];
  evalById: Map<string, SpecialLengthEvalResult>;
  configSignature: string;
}

export const FIXED_SPECIAL_BODY_LIMIT = 1.9;
export const FIXED_SPECIAL_WICK_LIMIT = 0.8;

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeSpecialLengthConfig(
  raw?: Partial<SpecialLengthFilterConfig> | null
): SpecialLengthFilterConfig {
  if (!raw) {
    return {
      ...DEFAULT_SPECIAL_LENGTH_CONFIG,
      maxBodyLengthRatio: FIXED_SPECIAL_BODY_LIMIT,
      maxWickLengthRatio: FIXED_SPECIAL_WICK_LIMIT,
    };
  }
  const minBars = clampInt(raw.minBars, 2, 8, DEFAULT_SPECIAL_LENGTH_CONFIG.minBars);
  const maxBars = Math.max(
    minBars,
    clampInt(raw.maxBars, 2, 10, DEFAULT_SPECIAL_LENGTH_CONFIG.maxBars)
  );
  const fixedBars = clampInt(
    raw.fixedBars,
    2,
    10,
    DEFAULT_SPECIAL_LENGTH_CONFIG.fixedBars
  );

  return {
    barMode:
      raw.barMode === 'FIXED' || raw.barMode === 'RANGE'
        ? raw.barMode
        : DEFAULT_SPECIAL_LENGTH_CONFIG.barMode,
    minBars,
    maxBars,
    fixedBars,
    maxBodyLengthRatio: FIXED_SPECIAL_BODY_LIMIT,
    maxWickLengthRatio: FIXED_SPECIAL_WICK_LIMIT,
  };
}

export function getSpecialLengthConfigSignature(cfg: SpecialLengthFilterConfig): string {
  return [
    cfg.barMode,
    cfg.minBars,
    cfg.maxBars,
    cfg.fixedBars,
    cfg.maxBodyLengthRatio.toFixed(2),
    cfg.maxWickLengthRatio.toFixed(2),
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

function measureLengthStats(
  candles: Candle[],
  startIdx: number,
  endIdx: number,
  medBody: number
): {
  sameColor: boolean;
  direction: TrendDirection | null;
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
      maxBodyRatio: 99,
      maxWickRatio: 99,
      avgBodyRatio: 0,
      avgWickRatio: 0,
      avgWickPct: 0,
    };
  }

  let sameColor = true;
  let maxBody = -Infinity;
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

    if (bodyRatio > maxBody) maxBody = bodyRatio;
    if (wickRatio > maxWick) maxWick = wickRatio;

    bodySum += bodyRatio;
    wickSum += wickRatio;
    wickPctSum += wickPct;
  }

  if (!sameColor || count <= 0) {
    return {
      sameColor: false,
      direction: null,
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
    maxBodyRatio: Number(maxBody.toFixed(2)),
    maxWickRatio: Number(maxWick.toFixed(2)),
    avgBodyRatio: Number((bodySum / count).toFixed(2)),
    avgWickRatio: Number((wickSum / count).toFixed(2)),
    avgWickPct: Math.round(wickPctSum / count),
  };
}

/**
 * Evaluates whether an asset qualifies for Special Table 2 (คัดพิเศษ2 — Body & Wick Length Limit):
 * - Same-color consecutive flowing candles matching the configured count (e.g. fixed 4, 5, 6, 7, 8 or range)
 * - Every bar in the matched run has bodyRatio <= maxBodyLengthRatio AND wickRatio <= maxWickLengthRatio
 */
export function evaluateAssetForSpecialLength(
  item: ScannedAssetState,
  rawConfig?: Partial<SpecialLengthFilterConfig> | null,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] }
): SpecialLengthEvalResult {
  const cfg = sanitizeSpecialLengthConfig(rawConfig);
  const candles = item.candles;
  const emptyResult = (aiBeautyScore?: number): SpecialLengthEvalResult => ({
    qualified: false,
    matchedBars: 0,
    direction: null,
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
    const stats = measureLengthStats(candles, startIdx, endIdx, medBody);
    if (!stats.sameColor || !stats.direction) continue;

    if (
      stats.maxBodyRatio <= cfg.maxBodyLengthRatio + eps &&
      stats.maxWickRatio <= cfg.maxWickLengthRatio + eps
    ) {
      return {
        qualified: true,
        matchedBars: len,
        direction: stats.direction,
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
 * Builds a candle-close frozen ranking snapshot for Special Table 2 (คัดพิเศษ2):
 * - Sorted descending by matched flowing candle count
 * - Tied counts broken by AI beauty score, lowest maxWickRatio + maxBodyRatio, then A-Z
 */
export function buildSpecialLengthRankSnapshot(
  assets: ScannedAssetState[],
  rawConfig?: Partial<SpecialLengthFilterConfig> | null,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] },
  explicitEpoch?: number
): SpecialLengthRankSnapshot {
  const cfg = sanitizeSpecialLengthConfig(rawConfig);
  const evalById = new Map<string, SpecialLengthEvalResult>();
  const qualifying: Array<{ item: ScannedAssetState; evalResult: SpecialLengthEvalResult }> = [];

  for (const item of assets) {
    const res = evaluateAssetForSpecialLength(item, cfg, aiContext);
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
    const peakA = a.evalResult.maxWickRatio + a.evalResult.maxBodyRatio;
    const peakB = b.evalResult.maxWickRatio + b.evalResult.maxBodyRatio;
    if (Math.abs(peakA - peakB) > 1e-6) {
      return peakA - peakB;
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
    configSignature: getSpecialLengthConfigSignature(cfg),
  };
}
