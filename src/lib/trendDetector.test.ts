import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCandleTrend, calculateEMA } from './trendDetector.ts';
import { DEFAULT_SCANNER_CONFIG, type Candle } from './types.ts';

function makeBaselineChoppyCandles(count: number, startPrice = 1.1): Candle[] {
  const out: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const open = price;
    const close = open + dir * 0.001;
    const high = Math.max(open, close) + 0.0004;
    const low = Math.min(open, close) - 0.0004;
    out.push({
      time: 1700000000 + i * 60,
      open,
      high,
      low,
      close,
    });
    price = close;
  }
  return out;
}

test('detects clean 5-candle short low-wick uptrend as MATCH', () => {
  const base = makeBaselineChoppyCandles(16, 5240);
  const scaled = base.map((c, idx) => ({
    ...c,
    open: 5240 + (idx % 2 === 0 ? 0 : 1),
    close: 5240 + (idx % 2 === 0 ? 1 : 0),
    high: 5241.3,
    low: 5239.7,
  }));

  // Index 15 was odd (5241 -> 5240, red), so 5 green candles start cleanly at idx 16
  let p = 5240;
  for (let i = 0; i < 5; i++) {
    const open = p;
    const close = open + 1.05;
    const high = close + 0.08;
    const low = open - 0.05;
    scaled.push({
      time: 1700000000 + (16 + i) * 60,
      open,
      high,
      low,
      close,
    });
    p = close;
  }

  const res = analyzeCandleTrend(scaled, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });

  assert.equal(res.status, 'MATCH');
  assert.equal(res.direction, 'UP');
  assert.equal(res.runLength, 5);
  assert.ok(res.avgWickRatio < 0.25);
  assert.ok(res.uniformityScore >= 85);
});

test('detects clean 6-candle short low-wick downtrend as MATCH', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 0.128 : 0.127;
    const c = i % 2 === 0 ? 0.127 : 0.128;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.0003,
      low: Math.min(o, c) - 0.0003,
    });
  }
  let p = 0.128;
  for (let i = 0; i < 6; i++) {
    const open = p;
    const close = open - 0.001;
    candles.push({
      time: 1700000000 + (16 + i) * 60,
      open,
      close,
      high: open + 0.00005,
      low: close - 0.00005,
    });
    p = close;
  }

  const res = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });

  assert.equal(res.status, 'MATCH');
  assert.equal(res.direction, 'DOWN');
  assert.equal(res.runLength, 6);
});

test('marks 4-candle run as FORMING before 5-6 match', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.101;
    const c = i % 2 === 0 ? 1.101 : 1.1;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.0002,
      low: Math.min(o, c) - 0.0002,
    });
  }
  let p = 1.1;
  for (let i = 0; i < 4; i++) {
    const open = p;
    const close = open + 0.001;
    candles.push({
      time: 1700000000 + (16 + i) * 60,
      open,
      close,
      high: close + 0.00005,
      low: open - 0.00005,
    });
    p = close;
  }

  const res = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });

  assert.equal(res.status, 'FORMING');
  assert.equal(res.runLength, 4);
});

test('rejects trend with large wicks', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.101;
    const c = i % 2 === 0 ? 1.101 : 1.1;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.0002,
      low: Math.min(o, c) - 0.0002,
    });
  }
  let p = 1.1;
  for (let i = 0; i < 5; i++) {
    const open = p;
    const close = open + 0.001;
    candles.push({
      time: 1700000000 + (16 + i) * 60,
      open,
      close,
      high: close + 0.0015,
      low: open - 0.0015,
    });
    p = close;
  }

  const res = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });

  assert.equal(res.status, 'NONE');
  assert.ok(res.avgWickRatio > DEFAULT_SCANNER_CONFIG.maxWickRatio);
});

test('marks 8-candle run as OVEREXTENDED (> 6 candles)', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 14; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.101;
    const c = i % 2 === 0 ? 1.101 : 1.1;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.0002,
      low: Math.min(o, c) - 0.0002,
    });
  }
  let p = 1.1;
  for (let i = 0; i < 8; i++) {
    const open = p;
    const close = open + 0.001;
    candles.push({
      time: 1700000000 + (14 + i) * 60,
      open,
      close,
      high: close + 0.00005,
      low: open - 0.00005,
    });
    p = close;
  }

  const res = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });

  assert.equal(res.status, 'OVEREXTENDED');
  assert.equal(res.runLength, 8);
});

test('allows 1 small counter-color candle when maxCounterCandles is 1', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 0.128 : 0.127;
    const c = i % 2 === 0 ? 0.127 : 0.128;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.0002,
      low: Math.min(o, c) - 0.0002,
    });
  }
  const deltas = [-0.001, -0.001, 0.0002, -0.001, -0.001];
  let p = 0.128;
  deltas.forEach((d, idx) => {
    const open = p;
    const close = open + d;
    candles.push({
      time: 1700000000 + (16 + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + 0.00005,
      low: Math.min(open, close) - 0.00005,
    });
    p = close;
  });

  const res = analyzeCandleTrend(
    candles,
    { ...DEFAULT_SCANNER_CONFIG, maxCounterCandles: 1 },
    { includeLastCandle: true }
  );

  assert.equal(res.status, 'MATCH');
  assert.equal(res.direction, 'DOWN');
  assert.equal(res.counterCandles, 1);
});

test('calculateEMA returns matching length array', () => {
  const candles = makeBaselineChoppyCandles(10);
  const ema = calculateEMA(candles, 7);
  assert.equal(ema.length, 10);
});
