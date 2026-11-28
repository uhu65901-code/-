import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceRankStabilityTracker,
  compareAssetsByFlowRank,
  computeLockedRankIds,
  countConsecutiveFlowCandles,
  createRankStabilityTracker,
  getAssetFlowRankInfo,
  orderAssetsByLockedIds,
} from './assetRanking.ts';
import { buildAiPatternModel, createFeedbackSample } from './aiPatternLearner.ts';
import type { Candle, ScannedAssetState, TrendAnalysis } from './types.ts';

function makeCandles(deltas: number[], basePrice = 1.1): Candle[] {
  const out: Candle[] = [];
  let p = basePrice;
  deltas.forEach((d, idx) => {
    const open = p;
    const close = open + d;
    out.push({
      time: 1700000000 + idx * 60,
      open,
      close,
      high: Math.max(open, close) + 0.0001,
      low: Math.min(open, close) - 0.0001,
    });
    p = close;
  });
  return out;
}

function makeAssetState(params: {
  id: string;
  name: string;
  status: TrendAnalysis['status'];
  runLength: number;
  matchScore: number;
  deltas: number[];
  direction?: 'UP' | 'DOWN' | null;
  aiSimilarityScore?: number;
}): ScannedAssetState {
  const candles = makeCandles(params.deltas);
  return {
    asset: {
      id: params.id,
      iqActiveId: 1,
      name: params.name,
      symbol: params.id,
      category: 'BINARY',
      isOtc: true,
      payoutPercent: 85,
      decimals: 5,
    },
    candles,
    lastPrice: candles[candles.length - 1]?.close ?? 0,
    secondsRemaining: 30,
    updatedAt: Date.now(),
    analysis: {
      status: params.status,
      direction: params.direction ?? 'UP',
      runLength: params.runLength,
      matchedIndices: [],
      signalIndex: null,
      signalPrice: null,
      signalTime: null,
      avgWickRatio: 0.1,
      uniformityScore: 88,
      matchScore: params.matchScore,
      directionalEfficiency: 0.85,
      avgBodyToMedianRatio: 1,
      counterCandles: 0,
      swingScore: 95,
      emaValues: [],
      reasons: [],
      aiSimilarityScore: params.aiSimilarityScore,
    },
  };
}

test('sorts strictly by highest flowing candle count descending regardless of status, then tier and alphabetical A-Z', () => {
  const assets: ScannedAssetState[] = [
    // NONE with 1 bar
    makeAssetState({
      id: 'USDJPY',
      name: 'USD/JPY',
      status: 'NONE',
      runLength: 0,
      matchScore: 70,
      deltas: [-0.001, -0.001, 0.001],
    }),
    // MATCH 4 bars
    makeAssetState({
      id: 'NZDCAD',
      name: 'NZD/CAD',
      status: 'MATCH',
      runLength: 4,
      matchScore: 87,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    // MATCH 6 bars
    makeAssetState({
      id: 'EURUSD',
      name: 'EUR/USD',
      status: 'MATCH',
      runLength: 6,
      matchScore: 89,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    // MATCH 6 bars, starts with A -> sits BEFORE EUR/USD alphabetically when tied on 6 bars
    makeAssetState({
      id: 'APPLE',
      name: 'Apple (OTC)',
      status: 'MATCH',
      runLength: 6,
      matchScore: 95,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    // NONE with 5 consecutive flowing bars -> must rank ABOVE MATCH 4 bars!
    makeAssetState({
      id: 'USDCAD',
      name: 'USD/CAD',
      status: 'NONE',
      runLength: 0,
      matchScore: 75,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    // FORMING 3 bars
    makeAssetState({
      id: 'GBPUSD',
      name: 'GBP/USD',
      status: 'FORMING',
      runLength: 3,
      matchScore: 82,
      deltas: [-0.001, 0.001, 0.001, 0.001],
    }),
    // NONE with 3 consecutive flowing bars (below FORMING 3 bars by tier)
    makeAssetState({
      id: 'AUDCAD',
      name: 'AUD/CAD',
      status: 'NONE',
      runLength: 0,
      matchScore: 60,
      deltas: [-0.001, 0.001, 0.001, 0.001],
    }),
    // OVEREXTENDED 7 bars -> most flowing bars, sits at VERY TOP regardless of status!
    makeAssetState({
      id: 'BTCUSD',
      name: 'Bitcoin',
      status: 'OVEREXTENDED',
      runLength: 7,
      matchScore: 0,
      deltas: [0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    }),
  ];

  // Even when Apple's score dips from 95 -> 86 and EUR/USD rises to 99, Apple stays above EUR/USD
  assets[3].analysis.matchScore = 86;
  assets[2].analysis.matchScore = 99;

  const sorted = [...assets].sort((a, b) => compareAssetsByFlowRank(a, b));
  assert.deepEqual(
    sorted.map((s) => `${s.asset.name}:${s.analysis.status === 'NONE' ? countConsecutiveFlowCandles(s.candles).count : s.analysis.runLength}`),
    [
      'Bitcoin:7',
      'Apple (OTC):6',
      'EUR/USD:6',
      'USD/CAD:5',
      'NZD/CAD:4',
      'GBP/USD:3',
      'AUD/CAD:3',
      'USD/JPY:1',
    ]
  );
});

test('ignores tiny opening-second live bar jitter so consecutive flowing bar count stays steady', () => {
  // 3 solid closed green bars + 1 tiny red live tick (0.00005 vs 0.001 median body)
  const candles = makeCandles([-0.001, 0.001, 0.001, 0.001, -0.00005]);
  const res = countConsecutiveFlowCandles(candles);
  assert.equal(res.count, 3);
  assert.equal(res.direction, 'UP');

  // Once the live bar moves meaningfully in reverse (-0.0008), count updates cleanly
  const movedCandles = makeCandles([-0.001, 0.001, 0.001, 0.001, -0.0008]);
  const movedRes = countConsecutiveFlowCandles(movedCandles);
  assert.equal(movedRes.count, 1);
  assert.equal(movedRes.direction, 'DOWN');
});

test('getAssetFlowRankInfo places empty-candle assets at the bottom', () => {
  const emptyAsset = makeAssetState({
    id: 'EMPTY',
    name: 'Empty Pair',
    status: 'NONE',
    runLength: 0,
    matchScore: 0,
    deltas: [],
  });
  const info = getAssetFlowRankInfo(emptyAsset);
  assert.equal(info.hasData, false);
  assert.equal(info.tier, 4);
});

test('advanceRankStabilityTracker prevents brief mid-candle threshold wobbles from swapping rank order', () => {
  const pairA = makeAssetState({
    id: 'A',
    name: 'AUD/USD',
    status: 'MATCH',
    runLength: 5,
    matchScore: 87,
    deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
  });
  const pairB = makeAssetState({
    id: 'B',
    name: 'EUR/USD',
    status: 'MATCH',
    runLength: 5,
    matchScore: 90,
    deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
  });

  const tracker = createRankStabilityTracker([pairA, pairB]);

  // Simulate 1-tick wobble: pairA temporarily drops to NONE (same candle time)
  const wobbleA: ScannedAssetState = {
    ...pairA,
    analysis: { ...pairA.analysis, status: 'NONE', runLength: 5, matchScore: 85 },
  };
  let map = advanceRankStabilityTracker(tracker, [wobbleA, pairB], 3);
  assert.equal(map.get('A')?.tier, 0); // stays steady at MATCH (tier 0)

  // Tick 2 still NONE -> still held steady
  map = advanceRankStabilityTracker(tracker, [wobbleA, pairB], 3);
  assert.equal(map.get('A')?.tier, 0);

  // Tick 3 reverts back to MATCH -> never caused a visual swap!
  map = advanceRankStabilityTracker(tracker, [pairA, pairB], 3);
  assert.equal(map.get('A')?.tier, 0);

  // If change genuinely persists for 3 consecutive ticks, rank updates cleanly
  advanceRankStabilityTracker(tracker, [wobbleA, pairB], 3);
  advanceRankStabilityTracker(tracker, [wobbleA, pairB], 3);
  map = advanceRankStabilityTracker(tracker, [wobbleA, pairB], 3);
  assert.equal(map.get('A')?.tier, 2);
});

test('computeLockedRankIds and orderAssetsByLockedIds freeze row positions between 30-60s refreshes while keeping live data fresh', () => {
  const apple = makeAssetState({
    id: 'APPLE',
    name: 'Apple (OTC)',
    status: 'MATCH',
    runLength: 6,
    matchScore: 93,
    deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
  });
  const eurusd = makeAssetState({
    id: 'EURUSD',
    name: 'EUR/USD',
    status: 'FORMING',
    runLength: 3,
    matchScore: 84,
    deltas: [-0.001, 0.001, 0.001, 0.001],
  });
  const usdjpy = makeAssetState({
    id: 'USDJPY',
    name: 'USD/JPY',
    status: 'NONE',
    runLength: 0,
    matchScore: 65,
    deltas: [-0.001, 0.001],
  });

  const lockedIds = computeLockedRankIds([usdjpy, eurusd, apple]);
  assert.deepEqual(lockedIds, ['APPLE', 'EURUSD', 'USDJPY']);

  // Live ticks change statuses/scores/runLength drastically before next 30-60s refresh:
  const nextTickAssets: ScannedAssetState[] = [
    {
      ...apple,
      candles: makeCandles([0.001, -0.001, 0.001]),
      analysis: { ...apple.analysis, status: 'NONE', runLength: 1, matchScore: 55 },
    },
    {
      ...eurusd,
      analysis: { ...eurusd.analysis, status: 'MATCH', runLength: 6, matchScore: 95 },
    },
    {
      ...usdjpy,
      analysis: { ...usdjpy.analysis, status: 'MATCH', runLength: 5, matchScore: 91 },
    },
  ];

  // Order stays completely frozen on lockedIds while displaying fresh live matchScore
  const projected = orderAssetsByLockedIds(nextTickAssets, lockedIds);
  assert.deepEqual(
    projected.map((a) => a.asset.id),
    ['APPLE', 'EURUSD', 'USDJPY']
  );
  assert.equal(projected[0].analysis.matchScore, 55);
  assert.equal(projected[1].analysis.matchScore, 95);

  // Only when scheduled 30-60s re-rank runs does the order update (5 > 1)
  const refreshedIds = computeLockedRankIds(nextTickAssets);
  assert.deepEqual(refreshedIds, ['EURUSD', 'USDJPY', 'APPLE']);
});

test('ranks more uniform user-taught AI beauty charts higher when tied on flowing candle count', () => {
  const cleanSample = createFeedbackSample({
    assetId: 'TEACH',
    assetName: 'Clean Flow',
    direction: 'UP',
    verdict: 'PASS',
    baseMatchScore: 93,
    runLength: 5,
    avgWickRatio: 0.1,
    uniformityScore: 94,
    features: {
      runLengthNorm: 5 / 6,
      avgWickRatio: 0.1,
      reverseWickRatio: 0.05,
      uniformityScoreNorm: 0.94,
      avgBodyToMedianRatio: 1.0,
      bodyTrendSlope: 1.0,
      directionalEfficiency: 0.9,
      emaDistanceRatio: 0.7,
      swingScoreNorm: 0.98,
    },
  });
  const aiCtx = {
    model: buildAiPatternModel([cleanSample]),
    samples: [cleanSample],
  };

  // Both have 5 consecutive UP candles, but ZZZ is clean & uniform while AAA is uneven
  const unevenAaa = makeAssetState({
    id: 'AAA',
    name: 'AAA Sloppy',
    status: 'NONE',
    runLength: 0,
    matchScore: 60,
    deltas: [-0.001, 0.0003, 0.003, 0.0004, 0.0025, 0.0005],
  });
  const cleanZzz = makeAssetState({
    id: 'ZZZ',
    name: 'ZZZ Clean',
    status: 'NONE',
    runLength: 0,
    matchScore: 80,
    deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
  });

  // Without AI, AAA comes before ZZZ alphabetically; WITH user-taught AI, ZZZ Clean jumps ahead of AAA Sloppy!
  const noAiOrder = computeLockedRankIds([unevenAaa, cleanZzz]);
  assert.deepEqual(noAiOrder, ['AAA', 'ZZZ']);

  const withAiOrder = computeLockedRankIds([unevenAaa, cleanZzz], aiCtx);
  assert.deepEqual(withAiOrder, ['ZZZ', 'AAA']);
});

test('separates pure same-color flows (counterCandles=0) from 1-2 counter-bar 5-6 candle pullback flows and computes body & wick stats', () => {
  const sameColorAsset = makeAssetState({
    id: 'SAME',
    name: 'EUR/USD',
    status: 'MATCH',
    runLength: 5,
    matchScore: 92,
    deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
  });

  // 6-bar UP trend with 2 small red pullback bars (even if analysis status is NONE/not yet updated, fallback detects it)
  const mixedAsset = makeAssetState({
    id: 'MIXED',
    name: 'EUR/JPY',
    status: 'NONE',
    runLength: 0,
    matchScore: 78,
    deltas: [
      -0.001, 0.001, -0.001, 0.001, // choppy baseline
      0.001, -0.00025, 0.001, 0.001, -0.00025, 0.001, // 6-bar UP with 2 counter bars
    ],
  });

  const sameInfo = getAssetFlowRankInfo(sameColorAsset);
  assert.equal(sameInfo.counterCandles, 0);
  assert.equal(sameInfo.flowCount, 5);
  assert.ok(sameInfo.avgBodyToMedianRatio > 0);
  assert.ok(sameInfo.avgBodyRangePct > 0);
  assert.ok(sameInfo.avgWickRatio >= 0);

  const mixedInfo = getAssetFlowRankInfo(mixedAsset);
  assert.equal(mixedInfo.direction, 'UP');
  assert.equal(mixedInfo.flowCount, 6);
  assert.equal(mixedInfo.counterCandles, 2);
  assert.ok(mixedInfo.avgBodyToMedianRatio > 0);
  assert.ok(mixedInfo.avgBodyRangePct > 0);
  assert.ok(mixedInfo.avgWickRatio > 0);
});

import {
  buildCommittedRankSnapshot,
  evaluateCandleCloseRankUpdate,
  getConsensusBarEpoch,
  projectAssetsWithCommittedSnapshot,
} from './assetRanking.ts';

test('freezes ranking order, table split, and stats until consensus 1-minute candle closes', () => {
  const initialAssets: ScannedAssetState[] = [
    makeAssetState({
      id: 'PAIR1',
      name: 'EUR/USD',
      status: 'MATCH',
      runLength: 6,
      matchScore: 93,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    makeAssetState({
      id: 'PAIR2',
      name: 'GBP/USD',
      status: 'FORMING',
      runLength: 4,
      matchScore: 84,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    makeAssetState({
      id: 'PAIR3',
      name: 'USD/JPY',
      status: 'NONE',
      runLength: 0,
      matchScore: 70,
      deltas: [-0.001, 0.001, -0.001, 0.001, -0.001, 0.001, 0.001],
    }),
  ];

  const baseEpoch = getConsensusBarEpoch(initialAssets);
  const snap = buildCommittedRankSnapshot(initialAssets);
  assert.deepEqual(snap.orderedIds, ['PAIR1', 'PAIR2', 'PAIR3']);
  assert.equal(snap.rankInfoById.get('PAIR1')?.counterCandles, 0);

  // Mid-minute: PAIR1 reverses live & gets counterCandles/status NONE, PAIR3 surges to MATCH 6 bars!
  // Also simulate 1 rogue outlier pair (#PAIR3) ticking +60s ahead while majority remain in same minute
  const midMinuteAssets: ScannedAssetState[] = [
    {
      ...initialAssets[0],
      candles: makeCandles([0.001, -0.001, 0.001, 0.001, 0.001, 0.001, -0.001]),
      analysis: { ...initialAssets[0].analysis, status: 'NONE', runLength: 1, matchScore: 45, counterCandles: 1 },
    },
    {
      ...initialAssets[1],
      candles: makeCandles([-0.001, 0.001, 0.001, 0.001, 0.001]),
      analysis: { ...initialAssets[1].analysis, status: 'FORMING', runLength: 4, matchScore: 84 },
    },
    {
      ...initialAssets[2],
      candles: makeCandles([-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001]), // 1 outlier +60s ahead
      analysis: { ...initialAssets[2].analysis, status: 'MATCH', runLength: 6, matchScore: 96 },
    },
  ];

  const midEval = evaluateCandleCloseRankUpdate(snap, midMinuteAssets, 1000, null);
  assert.equal(midEval.shouldUpdate, false);

  // Mid-minute projection keeps exact order + snapshot counterCandles/status frozen!
  const projected = projectAssetsWithCommittedSnapshot(midMinuteAssets, snap);
  assert.deepEqual(
    projected.map((a) => a.asset.id),
    ['PAIR1', 'PAIR2', 'PAIR3']
  );
  assert.equal(snap.rankInfoById.get('PAIR1')?.counterCandles, 0);
  assert.equal(snap.statusById.get('PAIR1')?.status, 'MATCH');

  // Now all 3 assets close the 1-minute candle and advance epoch +60s!
  const nextMinuteAssets = midMinuteAssets.map((a) => ({
    ...a,
    candles: [
      ...a.candles.slice(0, -1),
      { ...a.candles[a.candles.length - 1], time: baseEpoch + 60 },
    ],
  }));

  const closeEval = evaluateCandleCloseRankUpdate(snap, nextMinuteAssets, 5000, midEval.nextPending);
  assert.equal(closeEval.shouldUpdate, true);
  assert.equal(closeEval.targetEpoch, baseEpoch + 60);

  const nextSnap = buildCommittedRankSnapshot(nextMinuteAssets, undefined, closeEval.targetEpoch);
  assert.deepEqual(nextSnap.orderedIds, ['PAIR3', 'PAIR2', 'PAIR1']);
});


