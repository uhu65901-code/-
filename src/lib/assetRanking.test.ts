import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceRankStabilityTracker,
  compareAssetsByFlowRank,
  countConsecutiveFlowCandles,
  createRankStabilityTracker,
  getAssetFlowRankInfo,
} from './assetRanking.ts';
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
    },
  };
}

test('sorts by flow tier, then highest flowing candle count descending, then alphabetically regardless of score fluctuations', () => {
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
    // MATCH 4 bars, lower score 87%
    makeAssetState({
      id: 'NZDCAD',
      name: 'NZD/CAD',
      status: 'MATCH',
      runLength: 4,
      matchScore: 87,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    // MATCH 6 bars, score 89% (should rank ABOVE 4 bars with 95%!)
    makeAssetState({
      id: 'EURUSD',
      name: 'EUR/USD',
      status: 'MATCH',
      runLength: 6,
      matchScore: 89,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
    }),
    // MATCH 6 bars, higher score 95%, starts with A -> must sit BEFORE EUR/USD alphabetically!
    makeAssetState({
      id: 'APPLE',
      name: 'Apple (OTC)',
      status: 'MATCH',
      runLength: 6,
      matchScore: 95,
      deltas: [-0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001],
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
    // NONE with 3 consecutive flowing bars (should rank ABOVE NONE with 1 bar)
    makeAssetState({
      id: 'AUDCAD',
      name: 'AUD/CAD',
      status: 'NONE',
      runLength: 0,
      matchScore: 60,
      deltas: [-0.001, 0.001, 0.001, 0.001],
    }),
    // OVEREXTENDED 7 bars (below active waiting/forming/match assets)
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
    sorted.map((s) => s.asset.name),
    [
      'Apple (OTC)', // MATCH, 6 bars, 'A'
      'EUR/USD',     // MATCH, 6 bars, 'E'
      'NZD/CAD',     // MATCH, 4 bars
      'GBP/USD',     // FORMING, 3 bars
      'AUD/CAD',     // NONE, 3 consecutive flowing bars
      'USD/JPY',     // NONE, 1 consecutive flowing bar
      'Bitcoin',     // OVEREXTENDED, 7 bars
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
