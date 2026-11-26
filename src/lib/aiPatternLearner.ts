import {
  MAX_AI_TRAINING_SAMPLES,
  type AiPatternModel,
  type Candle,
  type PatternFeatureVector,
  type PatternFeedbackSample,
  type PatternVerdict,
  type ScannerConfig,
  type TrendDirection,
} from './types.ts';

const FEATURE_KEYS: Array<keyof PatternFeatureVector> = [
  'runLengthNorm',
  'avgWickRatio',
  'reverseWickRatio',
  'uniformityScoreNorm',
  'avgBodyToMedianRatio',
  'bodyTrendSlope',
  'directionalEfficiency',
  'emaDistanceRatio',
  'swingScoreNorm',
];

const FEATURE_SCALES: Record<keyof PatternFeatureVector, number> = {
  runLengthNorm: 0.3,
  avgWickRatio: 0.12,
  reverseWickRatio: 0.18,
  uniformityScoreNorm: 0.14,
  avgBodyToMedianRatio: 0.35,
  bodyTrendSlope: 0.32,
  directionalEfficiency: 0.15,
  emaDistanceRatio: 0.6,
  swingScoreNorm: 0.14,
};

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function defaultWeights(): Record<keyof PatternFeatureVector, number> {
  return {
    runLengthNorm: 1.0,
    avgWickRatio: 1.25,
    reverseWickRatio: 1.2,
    uniformityScoreNorm: 1.3,
    avgBodyToMedianRatio: 1.2,
    bodyTrendSlope: 0.95,
    directionalEfficiency: 1.25,
    emaDistanceRatio: 1.0,
    swingScoreNorm: 1.25,
  };
}

export function extractPatternFeatures(params: {
  runCandles: Candle[];
  emaValues: number[];
  runIndices: number[];
  direction: TrendDirection;
  medianBody: number;
  avgWickRatio: number;
  uniformityScore: number;
  avgBodyToMedianRatio: number;
  directionalEfficiency: number;
  swingScore: number;
}): PatternFeatureVector {
  const {
    runCandles,
    emaValues,
    runIndices,
    direction,
    medianBody,
    avgWickRatio,
    uniformityScore,
    avgBodyToMedianRatio,
    directionalEfficiency,
    swingScore,
  } = params;

  const safeMedian = Math.max(medianBody, 1e-9);
  const bodies = runCandles.map((c) => Math.abs(c.close - c.open));

  let revWickSum = 0;
  for (const c of runCandles) {
    const body = Math.max(Math.abs(c.close - c.open), safeMedian * 0.25);
    const revWick =
      direction === 'UP'
        ? Math.max(0, Math.min(c.open, c.close) - c.low)
        : Math.max(0, c.high - Math.max(c.open, c.close));
    revWickSum += revWick / body;
  }
  const reverseWickRatio = clamp(
    runCandles.length > 0 ? revWickSum / runCandles.length : 0,
    0,
    1.5
  );

  const half = Math.max(1, Math.floor(bodies.length / 2));
  const firstHalfMean =
    bodies.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const secondHalfSlice = bodies.slice(half);
  const secondHalfMean =
    secondHalfSlice.length > 0
      ? secondHalfSlice.reduce((s, v) => s + v, 0) / secondHalfSlice.length
      : firstHalfMean;
  const bodyTrendSlope = clamp(
    firstHalfMean > 0 ? secondHalfMean / firstHalfMean : 1,
    0.4,
    1.8
  );

  let emaGapSum = 0;
  let emaCount = 0;
  for (let k = 0; k < runIndices.length; k++) {
    const c = runCandles[k];
    const e = emaValues[runIndices[k]];
    if (c && Number.isFinite(e)) {
      emaGapSum += Math.abs(c.close - e) / safeMedian;
      emaCount++;
    }
  }
  const emaDistanceRatio = clamp(emaCount > 0 ? emaGapSum / emaCount : 0.6, 0, 3);

  return {
    runLengthNorm: clamp(runCandles.length / 6, 0.3, 1.6),
    avgWickRatio: clamp(avgWickRatio, 0, 1),
    reverseWickRatio,
    uniformityScoreNorm: clamp(uniformityScore / 100, 0, 1),
    avgBodyToMedianRatio: clamp(avgBodyToMedianRatio, 0.2, 2.5),
    bodyTrendSlope,
    directionalEfficiency: clamp(directionalEfficiency, 0, 1),
    emaDistanceRatio,
    swingScoreNorm: clamp(swingScore / 100, 0, 1),
  };
}

function meanVector(vectors: PatternFeatureVector[]): PatternFeatureVector | null {
  if (vectors.length === 0) return null;
  const out = {} as PatternFeatureVector;
  for (const key of FEATURE_KEYS) {
    out[key] =
      vectors.reduce((sum, vec) => sum + (Number.isFinite(vec[key]) ? vec[key] : 0), 0) /
      vectors.length;
  }
  return out;
}

export function buildAiPatternModel(samples: PatternFeedbackSample[]): AiPatternModel {
  const passSamples = samples.filter((s) => s.verdict === 'PASS' && s.features);
  const rejectSamples = samples.filter((s) => s.verdict === 'REJECT' && s.features);

  const passCentroid = meanVector(passSamples.map((s) => s.features));
  const rejectCentroid = meanVector(rejectSamples.map((s) => s.features));
  const weights = defaultWeights();

  if (passCentroid && passSamples.length >= 2) {
    for (const key of FEATURE_KEYS) {
      const scale = FEATURE_SCALES[key];
      const variance =
        passSamples.reduce(
          (sum, s) => sum + ((s.features[key] - passCentroid[key]) / scale) ** 2,
          0
        ) / passSamples.length;
      const tightness = clamp(1.35 - Math.sqrt(variance) * 0.4, 0.85, 1.75);
      let separation = 1;
      if (rejectCentroid) {
        const diff = Math.abs(passCentroid[key] - rejectCentroid[key]) / scale;
        separation = clamp(1 + diff * 0.45, 1, 1.6);
      }
      weights[key] = Number((weights[key] * tightness * separation).toFixed(3));
    }
  }

  const preferredSummary =
    passCentroid && passSamples.length > 0
      ? {
          idealRunLength: Number((passCentroid.runLengthNorm * 6).toFixed(1)),
          idealWickPercent: Math.round(passCentroid.avgWickRatio * 100),
          idealUniformity: Math.round(passCentroid.uniformityScoreNorm * 100),
          idealBodyRatio: Number(passCentroid.avgBodyToMedianRatio.toFixed(2)),
        }
      : null;

  return {
    passCount: passSamples.length,
    rejectCount: rejectSamples.length,
    passCentroid,
    rejectCentroid,
    featureWeights: weights,
    preferredSummary,
  };
}

function rbfSimilarity(
  a: PatternFeatureVector,
  b: PatternFeatureVector,
  weights: Record<keyof PatternFeatureVector, number>
): number {
  let weightedSq = 0;
  let weightSum = 0;
  for (const key of FEATURE_KEYS) {
    const w = weights[key] ?? 1;
    const scale = FEATURE_SCALES[key];
    const diff = (a[key] - b[key]) / scale;
    weightedSq += w * diff * diff;
    weightSum += w;
  }
  const normalizedDistSq = weightSum > 0 ? weightedSq / weightSum : 0;
  return Math.exp(-0.55 * normalizedDistSq) * 100;
}

export function scorePatternWithAi(
  features: PatternFeatureVector,
  model: AiPatternModel,
  samples: PatternFeedbackSample[],
  influencePercent = 35
): {
  aiSimilarityScore: number | undefined;
  aiDeltaScore: number;
  aiLabel?: string;
} {
  if (model.passCount === 0 && model.rejectCount === 0) {
    return { aiSimilarityScore: undefined, aiDeltaScore: 0 };
  }

  const strength = clamp(influencePercent / 35, 0, 1.75);
  const passSamples = samples.filter((s) => s.verdict === 'PASS' && s.features);
  const rejectSamples = samples.filter((s) => s.verdict === 'REJECT' && s.features);

  let simPass = 65;
  if (model.passCentroid && passSamples.length > 0) {
    const centroidSim = rbfSimilarity(features, model.passCentroid, model.featureWeights);
    let nearestSim = 0;
    for (const s of passSamples.slice(-300)) {
      const sim = rbfSimilarity(features, s.features, model.featureWeights);
      if (sim > nearestSim) nearestSim = sim;
    }
    simPass = centroidSim * 0.55 + nearestSim * 0.45;
  }

  let simReject = 0;
  if (model.rejectCentroid && rejectSamples.length > 0) {
    const centroidRej = rbfSimilarity(features, model.rejectCentroid, model.featureWeights);
    let nearestRej = 0;
    for (const s of rejectSamples.slice(-300)) {
      const sim = rbfSimilarity(features, s.features, model.featureWeights);
      if (sim > nearestRej) nearestRej = sim;
    }
    simReject = centroidRej * 0.5 + nearestRej * 0.5;
  }

  let aiSimilarityScore: number;
  let rawDelta = 0;

  if (model.passCount > 0 && model.rejectCount > 0) {
    aiSimilarityScore = Math.round(clamp(simPass - Math.max(0, simReject - 45) * 0.45, 0, 100));
    if (simReject > simPass + 8 && simReject >= 62) {
      rawDelta = -Math.round(clamp(((simReject - simPass) / 35) * 10, 4, 14) * strength);
    } else if (aiSimilarityScore >= 78) {
      rawDelta = Math.round(clamp(((aiSimilarityScore - 72) / 28) * 9, 2, 10) * strength);
    } else if (aiSimilarityScore < 52) {
      rawDelta = -Math.round(clamp(((58 - aiSimilarityScore) / 30) * 8, 2, 9) * strength);
    }
  } else if (model.passCount > 0) {
    aiSimilarityScore = Math.round(clamp(simPass, 0, 100));
    if (aiSimilarityScore >= 76) {
      rawDelta = Math.round(clamp(((aiSimilarityScore - 70) / 30) * 9, 2, 10) * strength);
    } else if (aiSimilarityScore < 50) {
      rawDelta = -Math.round(clamp(((56 - aiSimilarityScore) / 32) * 7, 2, 8) * strength);
    }
  } else {
    aiSimilarityScore = Math.round(clamp(100 - simReject * 0.8, 0, 100));
    if (simReject >= 68) {
      rawDelta = -Math.round(clamp(((simReject - 60) / 35) * 10, 3, 12) * strength);
    }
  }

  let aiLabel: string;
  if (rawDelta >= 3 || aiSimilarityScore >= 82) {
    aiLabel = `AI ชอบทรงนี้ ${aiSimilarityScore}%`;
  } else if (rawDelta <= -4 || aiSimilarityScore < 55) {
    aiLabel = `ต่างจากทรงที่สอน AI (${aiSimilarityScore}%)`;
  } else {
    aiLabel = `คล้ายทรงที่สอน AI ${aiSimilarityScore}%`;
  }

  return {
    aiSimilarityScore,
    aiDeltaScore: rawDelta,
    aiLabel,
  };
}

export function createFeedbackSample(params: {
  alertId?: string;
  assetId: string;
  assetName: string;
  direction: TrendDirection;
  verdict: PatternVerdict;
  baseMatchScore: number;
  aiScoreAtTime?: number;
  runLength: number;
  avgWickRatio: number;
  uniformityScore: number;
  features: PatternFeatureVector;
}): PatternFeedbackSample {
  return {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...params,
    createdAt: Date.now(),
  };
}

export type FlowAiAssessment =
  | {
      ok: true;
      direction: TrendDirection;
      runLength: number;
      avgWickRatio: number;
      uniformityScore: number;
      baseMatchScore: number;
      directionalEfficiency: number;
      features: PatternFeatureVector;
    }
  | {
      ok: false;
      reason: string;
    };

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Validates that a chart's recent candles form a genuine flowing UP or DOWN trend
 * (never sideways consolidation) before allowing AI pattern learning.
 */
export function assessChartFlowForAiTraining(
  candles: Candle[],
  emaValues: number[],
  config: Pick<ScannerConfig, 'targetMinCandles' | 'targetMaxCandles'> & {
    scanWindowBars?: number;
  },
  forcedDirection?: TrendDirection
): FlowAiAssessment {
  if (candles.length < 8) {
    return {
      ok: false,
      reason: 'ข้อมูลแท่งเทียน M15 ยังไม่เพียงพอสำหรับสอน AI (ต้องมีอย่างน้อย 8 แท่ง)',
    };
  }

  const windowBars = Math.min(20, Math.max(15, Math.round(config.scanWindowBars ?? 15)));
  const m15Start = Math.max(0, candles.length - windowBars);
  const m15Candles = candles.slice(m15Start);
  const m15Ema = emaValues.slice(m15Start);

  const baselineBodies = m15Candles
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  const medianBody = computeMedian(baselineBodies);
  if (medianBody <= 0) {
    return {
      ok: false,
      reason: 'กราฟหยุดนิ่งไม่มีการเคลื่อนไหว AI จะเรียนรู้เฉพาะกราฟไหลขึ้นหรือลงเท่านั้น',
    };
  }

  const latest = m15Candles[m15Candles.length - 1];
  const latestDiff = latest.close - latest.open;
  let targetDir: TrendDirection | null = forcedDirection ?? null;

  if (!targetDir) {
    if (latestDiff > 0) targetDir = 'UP';
    else if (latestDiff < 0) targetDir = 'DOWN';
    else {
      const lookWindow = m15Candles.slice(-Math.max(3, config.targetMinCandles));
      const net = lookWindow[lookWindow.length - 1].close - lookWindow[0].open;
      if (Math.abs(net) > medianBody * 0.8) {
        targetDir = net > 0 ? 'UP' : 'DOWN';
      }
    }
  }

  if (!targetDir) {
    return {
      ok: false,
      reason: 'กราฟยังไม่เลือกทิศทางชัดเจน — AI จะเรียนรู้เฉพาะกราฟไหลเป็นเทรนด์ขึ้นหรือลงเท่านั้น',
    };
  }

  const maxInspect = Math.min(m15Candles.length, Math.max(4, config.targetMaxCandles));
  const minInspect = Math.min(m15Candles.length, Math.max(3, config.targetMinCandles));

  let bestIndices: number[] | null = null;
  let bestScore = -1;

  for (let len = minInspect; len <= maxInspect; len++) {
    const startIdx = m15Candles.length - len;
    const indices: number[] = [];
    for (let k = startIdx; k < m15Candles.length; k++) indices.push(k);
    const slice = indices.map((i) => m15Candles[i]);

    const first = slice[0];
    const last = slice[slice.length - 1];
    const netMove =
      targetDir === 'UP' ? last.close - first.open : first.open - last.close;
    if (netMove <= 0) continue;

    const totalRanges = slice.reduce(
      (sum, c) => sum + Math.max(c.high - c.low, Math.abs(c.close - c.open)),
      0
    );
    const eff = totalRanges > 0 ? clamp(netMove / totalRanges, 0, 1) : 0;

    let sameColorCount = 0;
    for (const c of slice) {
      if (targetDir === 'UP' ? c.close > c.open : c.close < c.open) {
        sameColorCount++;
      }
    }
    const sameColorRatio = sameColorCount / slice.length;

    const candidateScore = eff * 0.55 + sameColorRatio * 0.45;
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestIndices = indices;
    }
  }

  // Also check pure contiguous run from latest bar inside M15 window
  const runIndices: number[] = [];
  for (let offset = 0; offset < maxInspect; offset++) {
    const idx = m15Candles.length - 1 - offset;
    const c = m15Candles[idx];
    const isTarget = targetDir === 'UP' ? c.close > c.open : c.close < c.open;
    if (isTarget) {
      runIndices.unshift(idx);
    } else {
      break;
    }
  }
  const chosenIndices =
    runIndices.length >= 3 && (!bestIndices || runIndices.length >= minInspect)
      ? runIndices
      : bestIndices;

  if (!chosenIndices || chosenIndices.length < 3) {
    return {
      ok: false,
      reason:
        'กราฟนี้ยังเป็นไซด์เวย์/สลับสีในกรอบ M15 — AI จะเรียนรู้เฉพาะกราฟไหลเป็นเทรนด์ขึ้นหรือเทรนด์ลงเท่านั้น',
    };
  }

  const runCandles = chosenIndices.map((i) => m15Candles[i]);
  const firstBar = runCandles[0];
  const lastBar = runCandles[runCandles.length - 1];
  const netMove =
    targetDir === 'UP' ? lastBar.close - firstBar.open : firstBar.open - lastBar.close;
  const totalRanges = runCandles.reduce(
    (sum, c) => sum + Math.max(c.high - c.low, Math.abs(c.close - c.open)),
    0
  );
  const directionalEfficiency =
    totalRanges > 0 ? clamp(netMove / totalRanges, 0, 1) : 0;

  let sameDirCount = 0;
  let wickRatioSum = 0;
  const sameBodies: number[] = [];
  for (const c of runCandles) {
    const body = Math.abs(c.close - c.open);
    const range = Math.max(c.high - c.low, body);
    const upperWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowerWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickRatio = range > 0 ? (upperWick + lowerWick) / range : 1;
    wickRatioSum += wickRatio;
    if (targetDir === 'UP' ? c.close > c.open : c.close < c.open) {
      sameDirCount++;
      sameBodies.push(body);
    }
  }

  const minSameNeeded = Math.max(3, Math.ceil(runCandles.length * 0.72));
  if (
    netMove < medianBody * 1.45 ||
    directionalEfficiency < 0.58 ||
    sameDirCount < minSameNeeded
  ) {
    return {
      ok: false,
      reason:
        'กราฟนี้ยังเป็นไซด์เวย์หรือไม่ไหลตามทิศทางชัดเจนในกรอบ M15 — AI จะเรียนรู้เฉพาะกราฟไหลเป็นเทรนด์ขึ้นหรือเทรนด์ลงเท่านั้น',
    };
  }

  const avgWickRatio = wickRatioSum / runCandles.length;
  const meanBody =
    sameBodies.reduce((s, v) => s + v, 0) / Math.max(1, sameBodies.length);
  const variance =
    sameBodies.reduce((s, v) => s + (v - meanBody) ** 2, 0) /
    Math.max(1, sameBodies.length);
  const cv = meanBody > 0 ? Math.sqrt(variance) / meanBody : 1;
  const uniformityScore = Math.round(clamp((1 - cv) * 100, 0, 100));
  const avgBodyToMedianRatio = meanBody / medianBody;
  const swingScore = Math.round(
    clamp((sameDirCount / runCandles.length) * 65 + directionalEfficiency * 35, 0, 100)
  );
  const baseMatchScore = Math.round(
    clamp(
      uniformityScore * 0.3 +
        (100 - avgWickRatio * 70) * 0.22 +
        directionalEfficiency * 100 * 0.28 +
        swingScore * 0.2,
      0,
      100
    )
  );

  const features = extractPatternFeatures({
    runCandles,
    emaValues: m15Ema,
    runIndices: chosenIndices,
    direction: targetDir,
    medianBody,
    avgWickRatio,
    uniformityScore,
    avgBodyToMedianRatio,
    directionalEfficiency,
    swingScore,
  });

  return {
    ok: true,
    direction: targetDir,
    runLength: runCandles.length,
    avgWickRatio,
    uniformityScore,
    baseMatchScore,
    directionalEfficiency,
    features,
  };
}

export function parseImportedAiSamples(rawJson: string): PatternFeedbackSample[] {
  const parsed = JSON.parse(rawJson);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.samples)
      ? parsed.samples
      : null;
  if (!list) {
    throw new Error('รูปแบบไฟล์สำรองข้อมูล AI ไม่ถูกต้อง');
  }
  const valid: PatternFeedbackSample[] = [];
  for (const item of list) {
    if (
      item &&
      typeof item.assetId === 'string' &&
      typeof item.assetName === 'string' &&
      (item.direction === 'UP' || item.direction === 'DOWN') &&
      (item.verdict === 'PASS' || item.verdict === 'REJECT') &&
      item.features &&
      typeof item.features.avgWickRatio === 'number' &&
      typeof item.features.directionalEfficiency === 'number'
    ) {
      valid.push({
        id:
          typeof item.id === 'string' && item.id
            ? item.id
            : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        alertId: typeof item.alertId === 'string' ? item.alertId : undefined,
        assetId: item.assetId,
        assetName: item.assetName,
        direction: item.direction,
        verdict: item.verdict,
        baseMatchScore: Number(item.baseMatchScore) || 88,
        aiScoreAtTime:
          typeof item.aiScoreAtTime === 'number' ? item.aiScoreAtTime : undefined,
        runLength: Number(item.runLength) || 5,
        avgWickRatio: Number(item.avgWickRatio) || 0.15,
        uniformityScore: Number(item.uniformityScore) || 80,
        features: item.features as PatternFeatureVector,
        createdAt: Number(item.createdAt) || Date.now(),
      });
    }
  }
  return valid.slice(-MAX_AI_TRAINING_SAMPLES);
}
