import test from 'node:test';
import assert from 'node:assert/strict';
import { computePerformanceStats, deduplicateAlertsByAsset } from './performanceStats.ts';
import type { DecisionRecord, TrendAlert } from './types.ts';

test('deduplicateAlertsByAsset keeps only one latest alert per asset name', () => {
  const sample: TrendAlert[] = [
    {
      id: 'eurusd-2',
      assetId: 'eurusd',
      assetName: 'EUR/USD',
      assetSymbol: 'EURUSD',
      category: 'BINARY',
      payoutPercent: 85,
      direction: 'UP',
      runLength: 5,
      avgWickRatio: 0.08,
      uniformityScore: 95,
      matchScore: 96,
      priceAtAlert: 1.086,
      candleTime: 1700000120,
      createdAt: 2000,
      acknowledged: false,
    },
    {
      id: 'dash-1',
      assetId: 'iq-1',
      assetName: 'DASHUSD-OTC',
      assetSymbol: 'DASHUSD-OTC',
      category: 'BINARY',
      payoutPercent: 83,
      direction: 'DOWN',
      runLength: 4,
      avgWickRatio: 0.09,
      uniformityScore: 92,
      matchScore: 93,
      priceAtAlert: 25.1,
      candleTime: 1700000060,
      createdAt: 1500,
      acknowledged: false,
    },
    {
      id: 'eurusd-1',
      assetId: 'iq-99',
      assetName: 'EUR/USD',
      assetSymbol: 'EURUSD',
      category: 'BINARY',
      payoutPercent: 85,
      direction: 'UP',
      runLength: 4,
      avgWickRatio: 0.1,
      uniformityScore: 90,
      matchScore: 91,
      priceAtAlert: 1.085,
      candleTime: 1700000000,
      createdAt: 1000,
      acknowledged: false,
    },
  ];

  const deduped = deduplicateAlertsByAsset(sample);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 'eurusd-2');
  assert.equal(deduped[1].assetName, 'DASHUSD-OTC');
});

test('computePerformanceStats computes accurate Win Rate, Net Profit, and equity curve', () => {
  const records: DecisionRecord[] = [
    {
      id: 'r1',
      alertId: 'a1',
      assetId: 'eurusd',
      assetName: 'EUR/USD',
      direction: 'UP',
      payoutPercent: 85,
      matchScore: 96,
      runLength: 5,
      decisionNote: 'TRADED_MANUAL',
      tradeOutcome: 'WIN',
      recordedAt: 1700000000000,
    },
    {
      id: 'r2',
      alertId: 'a2',
      assetId: 'dashusd-otc',
      assetName: 'DASHUSD-OTC',
      direction: 'DOWN',
      payoutPercent: 83,
      matchScore: 92,
      runLength: 4,
      decisionNote: 'TRADED_MANUAL',
      tradeOutcome: 'WIN',
      recordedAt: 1700000060000,
    },
    {
      id: 'r3',
      alertId: 'a3',
      assetId: 'gbpusd',
      assetName: 'GBP/USD',
      direction: 'UP',
      payoutPercent: 84,
      matchScore: 91,
      runLength: 4,
      decisionNote: 'TRADED_MANUAL',
      tradeOutcome: 'LOSS',
      recordedAt: 1700000120000,
    },
    {
      id: 'r4',
      alertId: 'a4',
      assetId: 'usdjpy',
      assetName: 'USD/JPY',
      direction: 'DOWN',
      payoutPercent: 85,
      matchScore: 93,
      runLength: 4,
      decisionNote: 'SKIPPED',
      recordedAt: 1700000180000,
    },
  ];

  const stats = computePerformanceStats(records, [], 100);
  assert.equal(stats.tradedCount, 3);
  assert.equal(stats.wins, 2);
  assert.equal(stats.losses, 1);
  assert.equal(stats.skippedCount, 1);
  assert.equal(stats.winRate, 66.7);
  // +85 + 83 - 100 = +68
  assert.equal(stats.netProfit, 68);
  assert.equal(stats.equitySeries.length, 3);
  assert.equal(stats.equitySeries[2].cumulativeProfit, 68);
});
