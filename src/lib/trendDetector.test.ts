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

test('detects clean 4-candle short low-wick uptrend as MATCH under default 4-6 config', () => {
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

  const resDefault = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.equal(resDefault.status, 'MATCH');
  assert.equal(resDefault.direction, 'UP');
  assert.equal(resDefault.runLength, 4);

  // When user chooses 5-candle lookback, 4 candles is FORMING until 5th candle arrives
  const resFive = analyzeCandleTrend(
    candles,
    {
      ...DEFAULT_SCANNER_CONFIG,
      targetMinCandles: 5,
      targetMaxCandles: 6,
    },
    { includeLastCandle: true }
  );
  assert.equal(resFive.status, 'FORMING');
  assert.equal(resFive.runLength, 4);
});

test('alerts immediately on live forming candle without waiting for candle close', () => {
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
  // 3 closed green candles + 1 live forming green candle (not closed yet)
  let p = 1.1;
  for (let i = 0; i < 4; i++) {
    const open = p;
    const close = open + (i === 3 ? 0.00085 : 0.001);
    candles.push({
      time: 1700000000 + (16 + i) * 60,
      open,
      close,
      high: close + 0.00004,
      low: open - 0.00004,
    });
    p = close;
  }

  const immediateRes = analyzeCandleTrend(candles, {
    ...DEFAULT_SCANNER_CONFIG,
    realtimeAlertImmediate: true,
  });
  assert.equal(immediateRes.status, 'MATCH');
  assert.equal(immediateRes.signalTime, candles[candles.length - 1].time);

  // When realtimeAlertImmediate is disabled, it waits for the candle to close
  const waitCloseRes = analyzeCandleTrend(candles, {
    ...DEFAULT_SCANNER_CONFIG,
    realtimeAlertImmediate: false,
  });
  assert.equal(waitCloseRes.status, 'FORMING');
  assert.equal(waitCloseRes.runLength, 3);
});

test('rejects oversized swing candles that violate small-candle criterion', () => {
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
    const close = open + 0.0022; // > 1.6x median body
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
  assert.equal(res.status, 'NONE');
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
  assert.ok(res.matchScore >= 86);
});

test('rejects sideways consolidation inside prior choppy range even with same-color candles', () => {
  const candles: Candle[] = [];
  // Large sideways range between 1.100 and 1.106
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.106;
    const c = i % 2 === 0 ? 1.106 : 1.1;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.0004,
      low: Math.min(o, c) - 0.0004,
    });
  }
  // 4 tiny green bars trapped right inside the middle of the sideways range (1.101..1.1026)
  let p = 1.101;
  for (let i = 0; i < 4; i++) {
    const open = p;
    const close = open + 0.0004;
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
  assert.equal(res.status, 'NONE');
});

test('enforces balanced minMatchScore 86, 1-2 pullback allowance in 5-6 bars, and candle-close default', () => {
  assert.equal(DEFAULT_SCANNER_CONFIG.minMatchScore, 86);
  assert.equal(DEFAULT_SCANNER_CONFIG.maxCounterCandles, 2);
  assert.equal(DEFAULT_SCANNER_CONFIG.realtimeAlertImmediate, false);

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
  // Same-color reasonably uniform bars with small natural wicks (~18% of total range)
  const bodies = [0.00095, 0.00105, 0.0009, 0.0011, 0.001];
  for (let i = 0; i < bodies.length; i++) {
    const open = p;
    const close = open + bodies[i];
    candles.push({
      time: 1700000000 + (16 + i) * 60,
      open,
      close,
      high: close + 0.00014,
      low: open - 0.00008,
    });
    p = close;
  }

  const passRes = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.equal(passRes.status, 'MATCH');
  assert.ok(passRes.matchScore >= 86);
  assert.equal(passRes.counterCandles, 0);
  assert.ok(passRes.avgWickRatio > 0.1 && passRes.avgWickRatio <= 0.28);

  const strictRes = analyzeCandleTrend(
    candles,
    { ...DEFAULT_SCANNER_CONFIG, minMatchScore: 99 },
    { includeLastCandle: true }
  );
  assert.equal(strictRes.status, 'NONE');
});

test('strictly rejects counter-color interruption when maxCounterCandles=0', () => {
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
  const deltas = [0.001, 0.001, -0.0002, 0.001, 0.001];
  let p = 1.1;
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
    { ...DEFAULT_SCANNER_CONFIG, maxCounterCandles: 0 },
    { includeLastCandle: true }
  );
  assert.notEqual(res.status, 'MATCH');
});

test('allows 2 small counter-color pullback bars in a 6-bar trend under default config, while rejecting 3+', () => {
  const makeFlow = (deltas: number[]): Candle[] => {
    const out: Candle[] = [];
    for (let i = 0; i < 14; i++) {
      const o = i % 2 === 0 ? 1.1 : 1.101;
      const c = i % 2 === 0 ? 1.101 : 1.1;
      out.push({
        time: 1700000000 + i * 60,
        open: o,
        close: c,
        high: Math.max(o, c) + 0.00018,
        low: Math.min(o, c) - 0.00018,
      });
    }
    let p = 1.1;
    deltas.forEach((d, idx) => {
      const open = p;
      const close = open + d;
      out.push({
        time: 1700000000 + (14 + idx) * 60,
        open,
        close,
        high: Math.max(open, close) + 0.00005,
        low: Math.min(open, close) - 0.00005,
      });
      p = close;
    });
    return out;
  };

  // 6-bar UP trend with 2 small red pullback bars (bars 1 & 4)
  const sixBarTwoPullbacks = makeFlow([0.001, -0.00025, 0.001, 0.001, -0.00025, 0.001]);
  const res2 = analyzeCandleTrend(sixBarTwoPullbacks, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.equal(res2.status, 'MATCH');
  assert.equal(res2.direction, 'UP');
  assert.equal(res2.runLength, 6);
  assert.equal(res2.counterCandles, 2);
  assert.ok(res2.avgBodyToMedianRatio > 0);
  assert.ok(res2.avgWickRatio > 0);

  // 6-bar series with 3 counter-color bars must NOT match the full 6 bars (cuts off at 3rd counter)
  const sixBarThreeCounters = makeFlow([0.001, -0.00025, -0.00025, 0.001, -0.00025, 0.001]);
  const res3 = analyzeCandleTrend(sixBarThreeCounters, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.notEqual(res3.counterCandles, 3);
  assert.ok(res3.counterCandles <= 2);

  // When a 6-bar pullback wave is preceded by an earlier same-color bar (7 bars total), keep the 6-bar MATCH window
  const sevenSpanPullback = makeFlow([0.001, 0.001, 0.001, 0.001, -0.00025, 0.001, 0.001]);
  const resCap = analyzeCandleTrend(sevenSpanPullback, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.equal(resCap.status, 'MATCH');
  assert.equal(resCap.runLength, 6);
  assert.equal(resCap.counterCandles, 1);
});

test('rejects run when one bar is overly long or overly short relative to peers', () => {
  const buildSeries = (deltas: number[]): Candle[] => {
    const out: Candle[] = [];
    for (let i = 0; i < 16; i++) {
      const o = i % 2 === 0 ? 1.1 : 1.101;
      const c = i % 2 === 0 ? 1.101 : 1.1;
      out.push({
        time: 1700000000 + i * 60,
        open: o,
        close: c,
        high: Math.max(o, c) + 0.00015,
        low: Math.min(o, c) - 0.00015,
      });
    }
    let p = 1.1;
    deltas.forEach((d, idx) => {
      const open = p;
      const close = open + d;
      out.push({
        time: 1700000000 + (16 + idx) * 60,
        open,
        close,
        high: Math.max(open, close) + 0.00004,
        low: Math.min(open, close) - 0.00004,
      });
      p = close;
    });
    return out;
  };

  // One oversized bar (0.0022 vs 0.0009 peers -> > 2.4x peer ratio)
  const unevenLong = buildSeries([0.0009, 0.0009, 0.0022, 0.0009, 0.0009]);
  assert.equal(
    analyzeCandleTrend(unevenLong, DEFAULT_SCANNER_CONFIG, { includeLastCandle: true }).status,
    'NONE'
  );

  // One tiny flat bar (0.00025 vs 0.001 peers -> uneven)
  const unevenShort = buildSeries([0.001, 0.001, 0.00025, 0.001, 0.001]);
  assert.equal(
    analyzeCandleTrend(unevenShort, DEFAULT_SCANNER_CONFIG, { includeLastCandle: true }).status,
    'NONE'
  );
});

test('rejects run with intra-bar deep reverse wick swing', () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.101;
    const c = i % 2 === 0 ? 1.101 : 1.1;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.00015,
      low: Math.min(o, c) - 0.00015,
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
      high: close + 0.00004,
      // Deep lower-wick swing on bar 2
      low: i === 2 ? open - 0.00065 : open - 0.00004,
    });
    p = close;
  }

  const res = analyzeCandleTrend(candles, DEFAULT_SCANNER_CONFIG, {
    includeLastCandle: true,
  });
  assert.equal(res.status, 'NONE');
});

test('enforces M15 scanWindowBars (15-20 candles max) and remaps matchedIndices accurately', () => {
  const candles: Candle[] = [];
  // 25 older choppy/huge candles BEFORE the M15 window (indices 0..24)
  for (let i = 0; i < 25; i++) {
    const o = i % 2 === 0 ? 1.05 : 1.08;
    const c = i % 2 === 0 ? 1.08 : 1.05;
    candles.push({
      time: 1700000000 + i * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.003,
      low: Math.min(o, c) - 0.003,
    });
  }

  // Latest 15 candles (indices 25..39) form clean M15: 10 small choppy bars + 5 crisp uniform green bars
  for (let i = 0; i < 10; i++) {
    const o = i % 2 === 0 ? 1.1 : 1.1008;
    const c = i % 2 === 0 ? 1.1008 : 1.1;
    candles.push({
      time: 1700000000 + (25 + i) * 60,
      open: o,
      close: c,
      high: Math.max(o, c) + 0.00015,
      low: Math.min(o, c) - 0.00015,
    });
  }

  let p = 1.1;
  for (let i = 0; i < 5; i++) {
    const open = p;
    const close = open + 0.00095;
    candles.push({
      time: 1700000000 + (35 + i) * 60,
      open,
      close,
      high: close + 0.00006,
      low: open - 0.00005,
    });
    p = close;
  }

  const res = analyzeCandleTrend(
    candles,
    { ...DEFAULT_SCANNER_CONFIG, scanWindowBars: 15 },
    { includeLastCandle: true }
  );

  assert.equal(res.status, 'MATCH');
  assert.equal(res.direction, 'UP');
  assert.equal(res.runLength, 5);
  // Indices must be remapped to the full 40-bar input array (35..39), not 10..14!
  assert.deepEqual(res.matchedIndices, [35, 36, 37, 38, 39]);
  assert.equal(res.signalIndex, 39);
});

test('calculateEMA returns matching length array', () => {
  const candles = makeBaselineChoppyCandles(10);
  const ema = calculateEMA(candles, 7);
  assert.equal(ema.length, 10);
});
