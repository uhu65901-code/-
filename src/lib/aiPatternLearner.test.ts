import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessChartFlowForAiTraining,
  buildAiPatternModel,
  createFeedbackSample,
  parseImportedAiSamples,
  scoreCandlesForAiRanking,
  scorePatternWithAi,
} from './aiPatternLearner.ts';
import { analyzeCandleTrend, calculateEMA } from './trendDetector.ts';
import {
  DEFAULT_SCANNER_CONFIG,
  MAX_AI_TRAINING_SAMPLES,
  type Candle,
  type PatternFeatureVector,
} from './types.ts';

function buildUniformTrendCandles(params: {
  bodies: number[];
  upperWick?: number;
  lowerWick?: number;
}): Candle[] {
  const { bodies, upperWick = 0.00008, lowerWick = 0.00008 } = params;
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.101;
    const c = i % 2 === 0 ? 1.101 : 1.1;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.00018,
      low: Math.min(o, c) - 0.00018,
    });
  }
  let p = 1.1;
  bodies.forEach((d, idx) => {
    const open = p;
    const close = open + d;
    candles.push({
      time: 1700000000 + (16 + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + upperWick,
      low: Math.min(open, close) - lowerWick,
    });
    p = close;
  });
  return candles;
}

test('buildAiPatternModel computes centroid and preferred summary from PASS samples', () => {
  const f1: PatternFeatureVector = {
    runLengthNorm: 5 / 6,
    avgWickRatio: 0.14,
    reverseWickRatio: 0.08,
    uniformityScoreNorm: 0.9,
    avgBodyToMedianRatio: 1.0,
    bodyTrendSlope: 1.0,
    directionalEfficiency: 0.88,
    emaDistanceRatio: 0.75,
    swingScoreNorm: 0.96,
  };
  const f2: PatternFeatureVector = {
    runLengthNorm: 5 / 6,
    avgWickRatio: 0.18,
    reverseWickRatio: 0.1,
    uniformityScoreNorm: 0.86,
    avgBodyToMedianRatio: 1.1,
    bodyTrendSlope: 1.02,
    directionalEfficiency: 0.84,
    emaDistanceRatio: 0.8,
    swingScoreNorm: 0.94,
  };

  const s1 = createFeedbackSample({
    assetId: 'EURUSD-OTC',
    assetName: 'EUR/USD (OTC)',
    direction: 'UP',
    verdict: 'PASS',
    baseMatchScore: 91,
    runLength: 5,
    avgWickRatio: 0.14,
    uniformityScore: 90,
    features: f1,
  });
  const s2 = createFeedbackSample({
    assetId: 'GBPUSD-OTC',
    assetName: 'GBP/USD (OTC)',
    direction: 'DOWN',
    verdict: 'PASS',
    baseMatchScore: 89,
    runLength: 5,
    avgWickRatio: 0.18,
    uniformityScore: 86,
    features: f2,
  });

  const model = buildAiPatternModel([s1, s2]);
  assert.equal(model.passCount, 2);
  assert.equal(model.rejectCount, 0);
  assert.ok(model.preferredSummary !== null);
  assert.equal(model.preferredSummary!.idealRunLength, 5);
  assert.equal(model.preferredSummary!.idealWickPercent, 16);
  assert.equal(model.preferredSummary!.maxWickPercent, 18);
  assert.equal(model.preferredSummary!.idealUniformity, 88);
  assert.equal(model.preferredSummary!.minUniformity, 86);
  assert.ok((model.preferredSummary!.idealAlignment ?? 0) >= 85);
  assert.ok((model.preferredSummary!.minAlignment ?? 0) >= 85);
  assert.equal(model.preferredSummary!.minBodyRatio, 1.0);
  assert.equal(model.preferredSummary!.maxBodyRatio, 1.1);
});

test('scorePatternWithAi rewards patterns matching PASS samples and penalizes REJECT patterns', () => {
  const goodFeat: PatternFeatureVector = {
    runLengthNorm: 5 / 6,
    avgWickRatio: 0.12,
    reverseWickRatio: 0.06,
    uniformityScoreNorm: 0.92,
    avgBodyToMedianRatio: 1.0,
    bodyTrendSlope: 1.0,
    directionalEfficiency: 0.9,
    emaDistanceRatio: 0.75,
    swingScoreNorm: 0.97,
  };
  const badFeat: PatternFeatureVector = {
    runLengthNorm: 4 / 6,
    avgWickRatio: 0.34,
    reverseWickRatio: 0.45,
    uniformityScoreNorm: 0.65,
    avgBodyToMedianRatio: 1.55,
    bodyTrendSlope: 1.4,
    directionalEfficiency: 0.62,
    emaDistanceRatio: 1.4,
    swingScoreNorm: 0.72,
  };

  const passSample = createFeedbackSample({
    assetId: 'A',
    assetName: 'Asset A',
    direction: 'UP',
    verdict: 'PASS',
    baseMatchScore: 92,
    runLength: 5,
    avgWickRatio: 0.12,
    uniformityScore: 92,
    features: goodFeat,
  });
  const rejectSample = createFeedbackSample({
    assetId: 'B',
    assetName: 'Asset B',
    direction: 'UP',
    verdict: 'REJECT',
    baseMatchScore: 85,
    runLength: 4,
    avgWickRatio: 0.34,
    uniformityScore: 65,
    features: badFeat,
  });

  const samples = [passSample, rejectSample];
  const model = buildAiPatternModel(samples);

  const likeGood = scorePatternWithAi(goodFeat, model, samples, 35);
  assert.ok((likeGood.aiSimilarityScore ?? 0) >= 85);
  assert.ok(likeGood.aiDeltaScore > 0);

  const likeBad = scorePatternWithAi(badFeat, model, samples, 35);
  assert.ok(likeBad.aiDeltaScore < 0);
});

test('analyzeCandleTrend uses learned AI model to boost matching patterns and downgrade rejected shapes', () => {
  const cleanCandles = buildUniformTrendCandles({
    bodies: [0.001, 0.001, 0.001, 0.001, 0.001],
    upperWick: 0.00012,
    lowerWick: 0.00008,
  });

  const baseline = analyzeCandleTrend(cleanCandles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.equal(baseline.status, 'MATCH');
  assert.ok(baseline.patternFeatures);

  // Train AI to PASS this exact clean shape
  const passSample = createFeedbackSample({
    assetId: 'USDJPY-OTC',
    assetName: 'USD/JPY (OTC)',
    direction: 'UP',
    verdict: 'PASS',
    baseMatchScore: baseline.baseMatchScore ?? baseline.matchScore,
    runLength: baseline.runLength,
    avgWickRatio: baseline.avgWickRatio,
    uniformityScore: baseline.uniformityScore,
    features: baseline.patternFeatures!,
  });
  const passModel = buildAiPatternModel([passSample]);

  // Under a slightly higher threshold (95%), base score alone might not hit 95,
  // but AI similarity boosts the score into MATCH!
  const highGateConfig = {
    ...DEFAULT_SCANNER_CONFIG,
    minMatchScore: Math.min(97, (baseline.baseMatchScore ?? baseline.matchScore) + 3),
    aiLearningEnabled: true,
    aiInfluencePercent: 45,
  };
  const withoutAi = analyzeCandleTrend(cleanCandles, highGateConfig, {
    includeLastCandle: true,
  });
  assert.equal(withoutAi.status, 'NONE');

  const withPassAi = analyzeCandleTrend(cleanCandles, highGateConfig, {
    includeLastCandle: true,
    aiModel: passModel,
    aiSamples: [passSample],
  });
  assert.equal(withPassAi.status, 'MATCH');
  assert.ok((withPassAi.aiDeltaScore ?? 0) > 0);
  assert.ok((withPassAi.aiSimilarityScore ?? 0) >= 85);

  // Conversely, if user marks this shape as REJECT, AI downgrades it
  const rejectSample = createFeedbackSample({
    assetId: 'USDJPY-OTC',
    assetName: 'USD/JPY (OTC)',
    direction: 'UP',
    verdict: 'REJECT',
    baseMatchScore: baseline.baseMatchScore ?? baseline.matchScore,
    runLength: baseline.runLength,
    avgWickRatio: baseline.avgWickRatio,
    uniformityScore: baseline.uniformityScore,
    features: baseline.patternFeatures!,
  });
  const rejectModel = buildAiPatternModel([rejectSample]);
  const withRejectAi = analyzeCandleTrend(
    cleanCandles,
    { ...DEFAULT_SCANNER_CONFIG, aiLearningEnabled: true, aiInfluencePercent: 45 },
    {
      includeLastCandle: true,
      aiModel: rejectModel,
      aiSamples: [rejectSample],
    }
  );
  assert.equal(withRejectAi.status, 'NONE');
  assert.ok((withRejectAi.aiDeltaScore ?? 0) < 0);
});

test('assessChartFlowForAiTraining accepts clean UP and DOWN flowing trends only', () => {
  const upCandles = buildUniformTrendCandles({
    bodies: [0.001, 0.0011, 0.00095, 0.001, 0.00105],
    upperWick: 0.0001,
    lowerWick: 0.0001,
  });
  const upEma = calculateEMA(upCandles, 9);
  const upResult = assessChartFlowForAiTraining(upCandles, upEma, DEFAULT_SCANNER_CONFIG);
  assert.equal(upResult.ok, true);
  if (upResult.ok) {
    assert.equal(upResult.direction, 'UP');
    assert.ok(upResult.directionalEfficiency >= 0.52);
    assert.ok(upResult.runLength >= 3);
    assert.ok(Number.isFinite(upResult.features.uniformityScoreNorm));
  }

  const downCandles = buildUniformTrendCandles({
    bodies: [-0.001, -0.0011, -0.00095, -0.001, -0.00105],
    upperWick: 0.0001,
    lowerWick: 0.0001,
  });
  const downEma = calculateEMA(downCandles, 9);
  const downResult = assessChartFlowForAiTraining(downCandles, downEma, DEFAULT_SCANNER_CONFIG);
  assert.equal(downResult.ok, true);
  if (downResult.ok) {
    assert.equal(downResult.direction, 'DOWN');
    assert.ok(downResult.directionalEfficiency >= 0.52);
  }
});

test('assessChartFlowForAiTraining strictly rejects sideways choppy charts even with forcedDirection', () => {
  const sidewaysCandles = buildUniformTrendCandles({
    bodies: [0.0009, -0.00085, 0.0008, -0.0009, 0.00085, -0.0008],
    upperWick: 0.00025,
    lowerWick: 0.00025,
  });
  const ema = calculateEMA(sidewaysCandles, 9);

  const autoRes = assessChartFlowForAiTraining(sidewaysCandles, ema, DEFAULT_SCANNER_CONFIG);
  assert.equal(autoRes.ok, false);

  const forcedUp = assessChartFlowForAiTraining(sidewaysCandles, ema, DEFAULT_SCANNER_CONFIG, 'UP');
  assert.equal(forcedUp.ok, false);
  if (!forcedUp.ok) {
    assert.ok(forcedUp.reason.includes('ไซด์เวย์') || forcedUp.reason.includes('เทรนด์'));
  }

  const forcedDown = assessChartFlowForAiTraining(
    sidewaysCandles,
    ema,
    DEFAULT_SCANNER_CONFIG,
    'DOWN'
  );
  assert.equal(forcedDown.ok, false);

  // User-judged REJECT is allowed even on choppy charts so AI learns what to filter out
  const userReject = assessChartFlowForAiTraining(
    sidewaysCandles,
    ema,
    DEFAULT_SCANNER_CONFIG,
    'UP',
    'REJECT'
  );
  assert.equal(userReject.ok, true);
  if (userReject.ok) {
    assert.ok(Number.isFinite(userReject.avgBodyToMedianRatio));
    assert.ok(Number.isFinite(userReject.avgWickRatio));
    assert.ok(Number.isFinite(userReject.uniformityScore));
  }
});

test('parseImportedAiSamples filters valid UP/DOWN samples and rejects malformed JSON payloads', () => {
  const sample = createFeedbackSample({
    assetId: 'EURUSD-OTC',
    assetName: 'EUR/USD (OTC)',
    direction: 'UP',
    verdict: 'PASS',
    baseMatchScore: 91,
    runLength: 5,
    avgWickRatio: 0.14,
    uniformityScore: 89,
    features: {
      runLengthNorm: 5 / 6,
      avgWickRatio: 0.14,
      reverseWickRatio: 0.08,
      uniformityScoreNorm: 0.89,
      avgBodyToMedianRatio: 1.0,
      bodyTrendSlope: 1.0,
      directionalEfficiency: 0.86,
      emaDistanceRatio: 0.72,
      swingScoreNorm: 0.95,
    },
  });

  const payload = JSON.stringify({
    samples: [
      sample,
      { assetId: 'BAD', assetName: 'Invalid', direction: 'SIDEWAYS', verdict: 'PASS' },
    ],
  });
  const imported = parseImportedAiSamples(payload);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].assetId, 'EURUSD-OTC');
  assert.equal(imported[0].direction, 'UP');

  assert.throws(() => parseImportedAiSamples('{"notSamples": true}'));
});

test('supports storing and importing more than 500 AI training samples (up to 2000)', () => {
  assert.ok(MAX_AI_TRAINING_SAMPLES > 500);
  assert.equal(MAX_AI_TRAINING_SAMPLES, 2000);

  const manySamples = Array.from({ length: 650 }, (_, idx) =>
    createFeedbackSample({
      assetId: `PAIR-${idx % 20}`,
      assetName: `PAIR/${idx % 20} (OTC)`,
      direction: idx % 2 === 0 ? 'UP' : 'DOWN',
      verdict: 'PASS',
      baseMatchScore: 90,
      runLength: 5,
      avgWickRatio: 0.14,
      uniformityScore: 88,
      features: {
        runLengthNorm: 5 / 6,
        avgWickRatio: 0.14,
        reverseWickRatio: 0.08,
        uniformityScoreNorm: 0.88,
        avgBodyToMedianRatio: 1.0,
        bodyTrendSlope: 1.0,
        directionalEfficiency: 0.86,
        emaDistanceRatio: 0.72,
        swingScoreNorm: 0.95,
      },
    })
  );

  const imported = parseImportedAiSamples(JSON.stringify({ samples: manySamples }));
  assert.equal(imported.length, 650);
});

test('scorePatternWithAi prioritizes candle body size, wick length, and uniformity specs taught by user', () => {
  const taughtPass = createFeedbackSample({
    assetId: 'EURUSD-OTC',
    assetName: 'EUR/USD (OTC)',
    direction: 'UP',
    verdict: 'PASS',
    baseMatchScore: 91,
    runLength: 5,
    avgWickRatio: 0.11,
    uniformityScore: 91,
    features: {
      runLengthNorm: 5 / 6,
      avgWickRatio: 0.11,
      reverseWickRatio: 0.06,
      uniformityScoreNorm: 0.91,
      avgBodyToMedianRatio: 0.95,
      bodyTrendSlope: 1.0,
      directionalEfficiency: 0.88,
      emaDistanceRatio: 0.75,
      swingScoreNorm: 0.96,
    },
  });
  const model = buildAiPatternModel([taughtPass]);

  // Same 3 pillars (body 0.96x, wick 12%, uniformity 90%) -> very high similarity even if runLength differs
  const matchingThreePillars: PatternFeatureVector = {
    runLengthNorm: 4 / 6,
    avgWickRatio: 0.12,
    reverseWickRatio: 0.07,
    uniformityScoreNorm: 0.9,
    avgBodyToMedianRatio: 0.96,
    bodyTrendSlope: 1.0,
    directionalEfficiency: 0.86,
    emaDistanceRatio: 0.8,
    swingScoreNorm: 0.94,
  };
  // Mismatched 3 pillars (oversized body 1.9x, long wick 36%, low uniformity 58%)
  const mismatchedThreePillars: PatternFeatureVector = {
    runLengthNorm: 5 / 6,
    avgWickRatio: 0.36,
    reverseWickRatio: 0.08,
    uniformityScoreNorm: 0.58,
    avgBodyToMedianRatio: 1.9,
    bodyTrendSlope: 1.0,
    directionalEfficiency: 0.88,
    emaDistanceRatio: 0.75,
    swingScoreNorm: 0.95,
  };

  const goodRes = scorePatternWithAi(matchingThreePillars, model, [taughtPass], 35);
  const badRes = scorePatternWithAi(mismatchedThreePillars, model, [taughtPass], 35);

  assert.ok((goodRes.aiSimilarityScore ?? 0) >= 85);
  assert.ok(goodRes.aiDeltaScore > 0);
  assert.ok((badRes.aiSimilarityScore ?? 100) < 50);
  assert.ok(badRes.aiDeltaScore < 0);
});

test('assessChartFlowForAiTraining always learns strictly from the latest 4-6 candles even on longer 8-bar runs', () => {
  const longFlow = buildUniformTrendCandles({
    bodies: [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    upperWick: 0.00008,
    lowerWick: 0.00008,
  });
  const ema = calculateEMA(longFlow, 7);
  const res = assessChartFlowForAiTraining(longFlow, ema, {
    targetMinCandles: 3,
    targetMaxCandles: 8,
    scanWindowBars: 15,
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok(res.runLength >= 4 && res.runLength <= 6);
    assert.ok(res.alignmentScore >= 85);
  }
});

test('scoreCandlesForAiRanking returns undefined until user teaches AI manually', () => {
  const clean = buildUniformTrendCandles({
    bodies: [0.001, 0.001, 0.001, 0.001, 0.001],
  });
  const ema = calculateEMA(clean, 7);
  const emptyModel = buildAiPatternModel([]);
  assert.equal(
    scoreCandlesForAiRanking(clean, ema, undefined, 0, undefined, emptyModel, []),
    undefined
  );
});

