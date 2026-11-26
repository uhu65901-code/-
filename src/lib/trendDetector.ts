import type {
  Candle,
  MatchStatus,
  ScannerConfig,
  TrendAnalysis,
  TrendDirection,
} from './types.ts';

/**
 * Computes Exponential Moving Average (EMA) over closing prices.
 * Matches the smooth yellow/gold EMA curve rendered across IQ Option 1m charts.
 */
export function calculateEMA(candles: Candle[], period = 7): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [candles[0].close];
  for (let i = 1; i < candles.length; i++) {
    const prev = ema[i - 1];
    ema.push(candles[i].close * k + prev * (1 - k));
  }
  return ema;
}

export function getCandleMetrics(candle: Candle) {
  const body = Math.abs(candle.close - candle.open);
  const totalRange = Math.max(candle.high - candle.low, body);
  const upperWick = Math.max(0, candle.high - Math.max(candle.open, candle.close));
  const lowerWick = Math.max(0, Math.min(candle.open, candle.close) - candle.low);
  const totalWick = upperWick + lowerWick;
  const wickRatio = totalRange > 0 ? totalWick / totalRange : 1;
  const dir: TrendDirection | 'DOJI' =
    candle.close > candle.open ? 'UP' : candle.close < candle.open ? 'DOWN' : 'DOJI';

  return {
    body,
    totalRange,
    upperWick,
    lowerWick,
    totalWick,
    wickRatio,
    dir,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function emptyAnalysis(emaValues: number[], reason: string): TrendAnalysis {
  return {
    status: 'NONE',
    direction: null,
    runLength: 0,
    matchedIndices: [],
    signalIndex: null,
    signalPrice: null,
    signalTime: null,
    avgWickRatio: 0,
    uniformityScore: 0,
    avgBodyToMedianRatio: 0,
    counterCandles: 0,
    swingScore: 0,
    emaValues,
    reasons: [reason],
  };
}

/**
 * Analyzes 1-minute candlesticks for a clean, steady, short-bodied,
 * minimal-wick flowing trend of 5-6 candles (not overextended, not swinging).
 */
export function analyzeCandleTrend(
  candles: Candle[],
  config: ScannerConfig,
  options: { includeLastCandle?: boolean } = {}
): TrendAnalysis {
  const emaValues = calculateEMA(candles, 7);
  const effectiveEnd = options.includeLastCandle
    ? candles.length
    : Math.max(0, candles.length - 1);

  if (effectiveEnd < Math.max(7, config.targetMinCandles)) {
    return emptyAnalysis(emaValues, 'ข้อมูลแท่งเทียน 1 นาที ยังไม่เพียงพอ');
  }

  const closedCandles = candles.slice(0, effectiveEnd);
  const baselineSlice = closedCandles.slice(-26);
  const baselineBodies = baselineSlice
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  const medianBody = median(baselineBodies);

  if (medianBody <= 0) {
    return emptyAnalysis(emaValues, 'กราฟไม่มีการเคลื่อนไหว');
  }

  const latestClosed = closedCandles[closedCandles.length - 1];
  const latestMetrics = getCandleMetrics(latestClosed);
  if (latestMetrics.dir === 'DOJI') {
    return emptyAnalysis(emaValues, 'แท่งล่าสุดเป็น Doji ยังไม่เลือกทาง');
  }

  const targetDir: TrendDirection = latestMetrics.dir;

  if (config.directionFilter !== 'BOTH' && config.directionFilter !== targetDir) {
    return emptyAnalysis(
      emaValues,
      `กราฟกำลังไหล${targetDir === 'UP' ? 'ขึ้น' : 'ลง'} (ถูกกรองตามทิศทางที่ตั้งไว้)`
    );
  }

  // Walk backwards from the latest closed candle to find the contiguous flowing run
  const maxInspect = Math.min(closedCandles.length, config.targetMaxCandles + 5);
  const runIndices: number[] = [];
  let counterCount = 0;

  for (let offset = 0; offset < maxInspect; offset++) {
    const idx = closedCandles.length - 1 - offset;
    const c = closedCandles[idx];
    const m = getCandleMetrics(c);

    if (m.dir === targetDir) {
      runIndices.unshift(idx);
    } else if (
      offset > 0 &&
      counterCount < config.maxCounterCandles &&
      m.body <= medianBody * 0.55
    ) {
      const prevIdx = idx - 1;
      if (prevIdx >= 0 && getCandleMetrics(closedCandles[prevIdx]).dir === targetDir) {
        counterCount++;
        runIndices.unshift(idx);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  const runLength = runIndices.length;

  // Check if overextended beyond 5-6 candles
  if (runLength > config.targetMaxCandles) {
    return {
      status: 'OVEREXTENDED',
      direction: targetDir,
      runLength,
      matchedIndices: runIndices,
      signalIndex: runIndices[runIndices.length - 1] ?? null,
      signalPrice: latestClosed.close,
      signalTime: latestClosed.time,
      avgWickRatio: 0,
      uniformityScore: 0,
      avgBodyToMedianRatio: 0,
      counterCandles: counterCount,
      swingScore: 0,
      emaValues,
      reasons: [
        `เทรนด์ไหลต่อเนื่อง ${runLength} แท่ง เกินกรอบ ${config.targetMaxCandles} แท่งแล้ว`,
      ],
    };
  }

  if (runLength < Math.max(3, config.targetMinCandles - 1)) {
    return emptyAnalysis(emaValues, `เพิ่งเรียงตัว ${runLength} แท่ง รอการยืนยัน`);
  }

  // Evaluate quality metrics on the directional candles in the run
  const runCandles = runIndices.map((i) => closedCandles[i]);
  const runMetrics = runCandles.map(getCandleMetrics);
  const sameDirMetrics = runMetrics.filter((m) => m.dir === targetDir);

  if (sameDirMetrics.length === 0) {
    return emptyAnalysis(emaValues, 'ไม่พบแท่งเทียนทิศทางเดียวกัน');
  }

  const bodies = sameDirMetrics.map((m) => m.body);
  const meanBody = bodies.reduce((sum, v) => sum + v, 0) / bodies.length;
  const variance =
    bodies.reduce((sum, v) => sum + (v - meanBody) ** 2, 0) / bodies.length;
  const stdDev = Math.sqrt(variance);
  const cv = meanBody > 0 ? stdDev / meanBody : 1;
  const uniformityScore = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));

  const avgWickRatio =
    sameDirMetrics.reduce((sum, m) => sum + m.wickRatio, 0) / sameDirMetrics.length;
  const maxSingleWickRatio = Math.max(...sameDirMetrics.map((m) => m.wickRatio));

  const avgBodyToMedianRatio = meanBody / medianBody;
  const maxSingleBodyRatio = Math.max(...bodies) / medianBody;
  const minSingleBodyRatio = Math.min(...bodies) / medianBody;

  let smoothSteps = 0;
  let totalSteps = 0;
  for (let i = 1; i < runCandles.length; i++) {
    const prev = runCandles[i - 1];
    const curr = runCandles[i];
    const prevMid = (prev.open + prev.close) / 2;
    totalSteps++;
    if (targetDir === 'UP') {
      const closesHigher = curr.close >= prev.close - medianBody * 0.15;
      const noDeepSwing = curr.low >= Math.min(prev.open, prevMid) - medianBody * 0.25;
      if (closesHigher && noDeepSwing) smoothSteps++;
    } else {
      const closesLower = curr.close <= prev.close + medianBody * 0.15;
      const noDeepSwing = curr.high <= Math.max(prev.open, prevMid) + medianBody * 0.25;
      if (closesLower && noDeepSwing) smoothSteps++;
    }
  }
  const swingScore =
    totalSteps > 0 ? Math.round((smoothSteps / totalSteps) * 100) : 100;

  const reasons: string[] = [];
  let passesQuality = true;

  if (avgWickRatio > config.maxWickRatio || maxSingleWickRatio > config.maxWickRatio * 1.75) {
    passesQuality = false;
    reasons.push(
      `ไส้เทียนเฉลี่ย ${(avgWickRatio * 100).toFixed(0)}% สูงกว่าเกณฑ์ ${(config.maxWickRatio * 100).toFixed(0)}%`
    );
  } else {
    reasons.push(`ไส้เทียนน้อยมาก เฉลี่ย ${(avgWickRatio * 100).toFixed(1)}%`);
  }

  if (uniformityScore < config.minUniformityScore) {
    passesQuality = false;
    reasons.push(`ขนาดแท่งเทียนไม่สม่ำเสมอ (${uniformityScore}/100)`);
  } else {
    reasons.push(`แท่งเทียนเรียงสม่ำเสมอ ${uniformityScore}/100`);
  }

  if (
    maxSingleBodyRatio > config.maxBodyToMedianRatio ||
    avgBodyToMedianRatio > config.maxBodyToMedianRatio * 0.9
  ) {
    passesQuality = false;
    reasons.push('พบแท่งยาวผิดปกติ (ไม่เข้าเงื่อนไขแท่งสั้น)');
  } else if (minSingleBodyRatio < config.minBodyToMedianRatio * 0.5) {
    passesQuality = false;
    reasons.push('มีแท่งเล็กเกินไปจนกราฟแบน');
  } else {
    reasons.push(`แท่งสั้นกระชับ (${avgBodyToMedianRatio.toFixed(2)}x ค่าเฉลี่ย)`);
  }

  if (swingScore < 75) {
    passesQuality = false;
    reasons.push('กราฟมีการสวิงย้อนตัวระหว่างแท่ง');
  } else {
    reasons.push(`ไหลต่อเนื่องไม่สวิง (${swingScore}%)`);
  }

  let status: MatchStatus = 'NONE';
  if (passesQuality) {
    if (runLength >= config.targetMinCandles && runLength <= config.targetMaxCandles) {
      status = 'MATCH';
    } else if (runLength === config.targetMinCandles - 1 && runLength >= 3) {
      status = 'FORMING';
    }
  }

  return {
    status,
    direction: targetDir,
    runLength,
    matchedIndices: runIndices,
    signalIndex:
      status === 'MATCH' || status === 'FORMING'
        ? runIndices[runIndices.length - 1] ?? null
        : null,
    signalPrice:
      status === 'MATCH' || status === 'FORMING' ? latestClosed.close : null,
    signalTime:
      status === 'MATCH' || status === 'FORMING' ? latestClosed.time : null,
    avgWickRatio,
    uniformityScore,
    avgBodyToMedianRatio,
    counterCandles: counterCount,
    swingScore,
    emaValues,
    reasons,
  };
}
