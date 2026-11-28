import { extractPatternFeatures, scorePatternWithAi } from './aiPatternLearner.ts';
import type {
  AiPatternModel,
  Candle,
  MatchStatus,
  PatternFeedbackSample,
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
    matchScore: 0,
    directionalEfficiency: 0,
    avgBodyToMedianRatio: 0,
    counterCandles: 0,
    swingScore: 0,
    emaValues,
    reasons: [reason],
  };
}

/**
 * Evaluates a slice of 1-minute candlesticks (up to the last bar in `slice`)
 * for a clean, steady, small-bodied, minimal-wick, same-color, non-sideways flowing trend.
 */
function analyzeCandleSlice(
  slice: Candle[],
  fullEmaValues: number[],
  config: ScannerConfig,
  aiContext?: { model: AiPatternModel; samples: PatternFeedbackSample[] }
): TrendAnalysis {
  if (slice.length < Math.max(6, config.targetMinCandles)) {
    return emptyAnalysis(fullEmaValues, 'ข้อมูลแท่งเทียน M15 ยังไม่เพียงพอ');
  }

  // Strictly scan only the M15 window (15-20 latest 1m candles)
  const windowBars = Math.min(20, Math.max(15, Math.round(config.scanWindowBars ?? 15)));
  const windowStart = Math.max(0, slice.length - windowBars);
  const windowSlice = slice.slice(windowStart);
  const windowEma = fullEmaValues.slice(windowStart, slice.length);

  const baselineBodies = windowSlice
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  const medianBody = median(baselineBodies);

  if (medianBody <= 0) {
    return emptyAnalysis(fullEmaValues, 'กราฟไม่มีการเคลื่อนไหว');
  }

  const latestBar = windowSlice[windowSlice.length - 1];
  const latestMetrics = getCandleMetrics(latestBar);
  if (latestMetrics.dir === 'DOJI') {
    return emptyAnalysis(fullEmaValues, 'แท่งล่าสุดเป็น Doji ยังไม่เลือกทาง');
  }

  const targetDir: TrendDirection = latestMetrics.dir;

  if (config.directionFilter !== 'BOTH' && config.directionFilter !== targetDir) {
    return emptyAnalysis(
      fullEmaValues,
      `กราฟกำลังไหล${targetDir === 'UP' ? 'ขึ้น' : 'ลง'} (ถูกกรองตามทิศทางที่ตั้งไว้)`
    );
  }

  // Walk backwards from the latest bar within the M15 window (<= 20 bars)
  // Allows 1-2 small pullback/pause candles inside a 5-6 candle continuation flow
  const maxCounterAllowed = Math.min(
    2,
    Math.max(0, Math.round(config.maxCounterCandles ?? 2))
  );
  const maxInspect = Math.min(
    windowSlice.length,
    Math.max(config.targetMaxCandles, 6) + 5
  );
  let runIndices: number[] = [];
  let counterCount = 0;

  for (let offset = 0; offset < maxInspect; offset++) {
    const idx = windowSlice.length - 1 - offset;
    const c = windowSlice[idx];
    const m = getCandleMetrics(c);

    if (m.dir === targetDir) {
      if (counterCount > 0 && runIndices.length >= config.targetMaxCandles) {
        break;
      }
      runIndices.unshift(idx);
    } else if (
      offset > 0 &&
      counterCount < maxCounterAllowed &&
      runIndices.length < config.targetMaxCandles &&
      m.body <= medianBody * 0.85
    ) {
      // Gather contiguous pullback block (1-2 bars within remaining counter budget)
      const remainingBudget = maxCounterAllowed - counterCount;
      const pbIndices: number[] = [];
      let probe = idx;
      while (
        pbIndices.length < remainingBudget &&
        probe >= 0 &&
        windowSlice.length - 1 - probe < maxInspect
      ) {
        const pm = getCandleMetrics(windowSlice[probe]);
        if (pm.dir === targetDir) break;
        if (pm.body > medianBody * 0.85) {
          pbIndices.length = 0;
          break;
        }
        pbIndices.unshift(probe);
        probe--;
      }

      if (
        pbIndices.length === 0 ||
        probe < 0 ||
        runIndices.length + pbIndices.length + 1 > config.targetMaxCandles
      ) {
        break;
      }

      // Gather contiguous targetDir impulse leg immediately left of the pullback block
      const priorLegIndices: number[] = [];
      let legProbe = probe;
      while (legProbe >= 0 && windowSlice.length - 1 - legProbe < maxInspect) {
        const lm = getCandleMetrics(windowSlice[legProbe]);
        if (lm.dir !== targetDir) break;
        priorLegIndices.unshift(legProbe);
        legProbe--;
      }

      if (priorLegIndices.length === 0) {
        break;
      }

      const priorStart = windowSlice[priorLegIndices[0]];
      const priorEnd = windowSlice[priorLegIndices[priorLegIndices.length - 1]];
      const avgPriorBody =
        priorLegIndices.reduce(
          (s, li) => s + getCandleMetrics(windowSlice[li]).body,
          0
        ) / priorLegIndices.length;
      const maxPbBody = Math.max(
        ...pbIndices.map((pi) => getCandleMetrics(windowSlice[pi]).body)
      );

      const priorGain =
        targetDir === 'UP'
          ? priorEnd.close - priorStart.open
          : priorStart.open - priorEnd.close;
      const pullbackDepth =
        targetDir === 'UP'
          ? priorEnd.close -
            Math.min(...pbIndices.map((pi) => Math.min(windowSlice[pi].open, windowSlice[pi].close)))
          : Math.max(...pbIndices.map((pi) => Math.max(windowSlice[pi].open, windowSlice[pi].close))) -
            priorEnd.close;

      if (
        priorGain > 0 &&
        pullbackDepth < priorGain * 0.78 &&
        maxPbBody <= avgPriorBody * 0.88
      ) {
        counterCount += pbIndices.length;
        for (let k = pbIndices.length - 1; k >= 0; k--) {
          runIndices.unshift(pbIndices[k]);
        }
        offset += pbIndices.length - 1;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  // Trim any leading non-targetDir bars just in case
  while (
    runIndices.length > 0 &&
    getCandleMetrics(windowSlice[runIndices[0]]).dir !== targetDir
  ) {
    runIndices.shift();
  }

  // 2 counter-color candles are strictly permitted only for 5-6+ bar flows;
  // shorter (< 5) runs allow at most 1 counter candle, and < 4 allow 0.
  const countCountersIn = (indices: number[]) =>
    indices.filter((i) => getCandleMetrics(windowSlice[i]).dir !== targetDir).length;

  counterCount = countCountersIn(runIndices);
  if (runIndices.length < 5 && counterCount > 1) {
    // Keep only the tail from the second counter bar onward (strictly <= 1 counter)
    let seen = 0;
    let cutAt = 0;
    for (let k = runIndices.length - 1; k >= 0; k--) {
      if (getCandleMetrics(windowSlice[runIndices[k]]).dir !== targetDir) {
        seen++;
        if (seen > 1) {
          cutAt = k + 1;
          break;
        }
      }
    }
    runIndices = runIndices.slice(cutAt);
    while (
      runIndices.length > 0 &&
      getCandleMetrics(windowSlice[runIndices[0]]).dir !== targetDir
    ) {
      runIndices.shift();
    }
    counterCount = countCountersIn(runIndices);
  }
  if (runIndices.length < 4 && counterCount > 0) {
    let cutAt = 0;
    for (let k = runIndices.length - 1; k >= 0; k--) {
      if (getCandleMetrics(windowSlice[runIndices[k]]).dir !== targetDir) {
        cutAt = k + 1;
        break;
      }
    }
    runIndices = runIndices.slice(cutAt);
    counterCount = countCountersIn(runIndices);
  }

  const runLength = runIndices.length;
  const globalMatchedIndices = runIndices.map((idx) => idx + windowStart);

  // Compute basic body & wick stats upfront so OVEREXTENDED and NONE always report real metrics
  const basicCandles = runIndices.map((i) => windowSlice[i]);
  const basicMetrics = basicCandles.map(getCandleMetrics);
  const basicSameDir = basicMetrics.filter((m) => m.dir === targetDir);
  const basicWickRatio =
    basicSameDir.length > 0
      ? basicSameDir.reduce((s, m) => s + m.wickRatio, 0) / basicSameDir.length
      : 0;
  const basicMeanBody =
    basicSameDir.length > 0
      ? basicSameDir.reduce((s, m) => s + m.body, 0) / basicSameDir.length
      : 0;
  const basicBodyRatio = medianBody > 0 ? basicMeanBody / medianBody : 0;

  // Check if overextended beyond configured max candles
  if (runLength > config.targetMaxCandles) {
    return {
      status: 'OVEREXTENDED',
      direction: targetDir,
      runLength,
      matchedIndices: globalMatchedIndices,
      signalIndex: globalMatchedIndices[globalMatchedIndices.length - 1] ?? null,
      signalPrice: latestBar.close,
      signalTime: latestBar.time,
      avgWickRatio: basicWickRatio,
      uniformityScore: 0,
      matchScore: 0,
      directionalEfficiency: 0,
      avgBodyToMedianRatio: basicBodyRatio,
      counterCandles: counterCount,
      swingScore: 0,
      emaValues: fullEmaValues,
      reasons: [
        `เทรนด์ไหลต่อเนื่อง ${runLength} แท่ง เกินกรอบ ${config.targetMaxCandles} แท่งแล้ว`,
      ],
    };
  }

  if (runLength < Math.max(2, config.targetMinCandles - 1)) {
    const res = emptyAnalysis(fullEmaValues, `เพิ่งเรียงตัว ${runLength} แท่ง รอการยืนยัน`);
    res.direction = targetDir;
    res.runLength = runLength;
    res.matchedIndices = globalMatchedIndices;
    res.avgWickRatio = basicWickRatio;
    res.avgBodyToMedianRatio = basicBodyRatio;
    res.counterCandles = counterCount;
    return res;
  }

  // Evaluate quality metrics across the recent compared candles in M15 window
  const runCandles = runIndices.map((i) => windowSlice[i]);
  const runMetrics = runCandles.map(getCandleMetrics);
  const sameDirMetrics = runMetrics.filter((m) => m.dir === targetDir);

  if (sameDirMetrics.length === 0) {
    return emptyAnalysis(fullEmaValues, 'ไม่พบแท่งเทียนทิศทางเดียวกัน');
  }

  const bodies = sameDirMetrics.map((m) => m.body);
  const meanBody = bodies.reduce((sum, v) => sum + v, 0) / bodies.length;
  const variance =
    bodies.reduce((sum, v) => sum + (v - meanBody) ** 2, 0) / bodies.length;
  const stdDev = Math.sqrt(variance);
  const cv = meanBody > 0 ? stdDev / meanBody : 1;
  const maxBody = Math.max(...bodies);
  const minBody = Math.min(...bodies);
  const bodySpreadRatio = minBody > 0 ? maxBody / minBody : 99;
  const spreadPenalty = bodySpreadRatio > 2.3 ? Math.min(28, (bodySpreadRatio - 2.3) * 18) : 0;
  const uniformityScore = Math.max(
    0,
    Math.min(100, Math.round((1 - cv) * 100 - spreadPenalty))
  );

  const avgWickRatio =
    sameDirMetrics.reduce((sum, m) => sum + m.wickRatio, 0) / sameDirMetrics.length;
  const maxSingleWickRatio = Math.max(...sameDirMetrics.map((m) => m.wickRatio));
  const hasExcessiveReverseWick = sameDirMetrics.some((m) => {
    const revWick = targetDir === 'UP' ? m.lowerWick : m.upperWick;
    return revWick > Math.max(m.body * 0.5, medianBody * 0.25);
  });

  const avgBodyToMedianRatio = meanBody / medianBody;
  const maxSingleBodyRatio = maxBody / medianBody;
  const minSingleBodyRatio = minBody / medianBody;
  const hasUnevenPeerBar =
    bodySpreadRatio > 2.35 ||
    maxBody > meanBody * 1.58 ||
    minBody < meanBody * 0.45;

  let smoothSteps = 0;
  let totalSteps = 0;
  for (let i = 1; i < runCandles.length; i++) {
    const prev = runCandles[i - 1];
    const prevM = runMetrics[i - 1];
    const curr = runCandles[i];
    const currM = runMetrics[i];
    const prevMid = (prev.open + prev.close) / 2;
    totalSteps++;
    if (currM.dir !== targetDir) {
      const noCounterSwing =
        targetDir === 'UP'
          ? curr.low >= prevMid - medianBody * 0.25
          : curr.high <= prevMid + medianBody * 0.25;
      if (noCounterSwing) smoothSteps++;
      continue;
    }
    const prevAnchorOpen = prevM.dir !== targetDir ? prev.close : prev.open;
    const prevAnchorClose = prevM.dir !== targetDir ? prev.open : prev.close;
    if (targetDir === 'UP') {
      const closesHigher = curr.close > prevAnchorClose - medianBody * 0.08;
      const opensClean = curr.open >= prevAnchorOpen - medianBody * 0.22;
      const noDeepSwing = curr.low >= Math.min(prev.open, prevMid) - medianBody * 0.24;
      if (closesHigher && opensClean && noDeepSwing) smoothSteps++;
    } else {
      const closesLower = curr.close < prevAnchorClose + medianBody * 0.08;
      const opensClean = curr.open <= prevAnchorOpen + medianBody * 0.22;
      const noDeepSwing = curr.high <= Math.max(prev.open, prevMid) + medianBody * 0.24;
      if (closesLower && opensClean && noDeepSwing) smoothSteps++;
    }
  }
  const swingScore =
    totalSteps > 0 ? Math.round((smoothSteps / totalSteps) * 100) : 100;

  // Anti-sideways directional flow & EMA alignment checks
  const firstRunBar = runCandles[0];
  const lastRunBar = runCandles[runCandles.length - 1];
  const netMove =
    targetDir === 'UP'
      ? lastRunBar.close - firstRunBar.open
      : firstRunBar.open - lastRunBar.close;
  const totalCandleRanges = runCandles.reduce(
    (sum, c) => sum + Math.max(c.high - c.low, Math.abs(c.close - c.open)),
    0
  );
  const directionalEfficiency =
    totalCandleRanges > 0
      ? Math.max(0, Math.min(1, netMove / totalCandleRanges))
      : 0;

  let emaAlignedCount = 0;
  for (const idx of runIndices) {
    const c = windowSlice[idx];
    const e = windowEma[idx];
    if (!Number.isFinite(e)) continue;
    if (targetDir === 'UP' ? c.close >= e : c.close <= e) {
      emaAlignedCount++;
    }
  }
  const emaAlignedRatio =
    runIndices.length > 0 ? emaAlignedCount / runIndices.length : 0;
  const firstEma = windowEma[runIndices[0]];
  const lastEma = windowEma[runIndices[runIndices.length - 1]];
  const emaSlopeAligned =
    Number.isFinite(firstEma) && Number.isFinite(lastEma)
      ? targetDir === 'UP'
        ? lastEma > firstEma
        : lastEma < firstEma
      : true;

  // Reject sideways consolidation inside the M15 window (15-20 bars):
  // the run must break out of prior M15 cluster & cover meaningful share of the M15 range
  const preBars = windowSlice.slice(0, runIndices[0]);
  const m15High = Math.max(...windowSlice.map((b) => b.high));
  const m15Low = Math.min(...windowSlice.map((b) => b.low));
  const m15Span = Math.max(m15High - m15Low, medianBody);
  const m15NetDominance = m15Span > 0 ? netMove / m15Span : 0;
  let breaksPriorRange = true;
  if (preBars.length >= 3) {
    const preHigh = Math.max(...preBars.map((b) => b.high));
    const preLow = Math.min(...preBars.map((b) => b.low));
    const preMid = (preHigh + preLow) / 2;
    const preSpan = Math.max(preHigh - preLow, medianBody);
    breaksPriorRange =
      (targetDir === 'UP'
        ? lastRunBar.close >= preHigh - preSpan * 0.08 ||
          lastRunBar.close - preMid >= medianBody * 1.6
        : lastRunBar.close <= preLow + preSpan * 0.08 ||
          preMid - lastRunBar.close >= medianBody * 1.6) &&
      m15NetDominance >= 0.32;
  }

  const wickScore = Math.max(0, Math.min(100, Math.round(100 - avgWickRatio * 72)));
  const effMultiplier =
    counterCount >= 2 ? 175 : counterCount === 1 ? 145 : 108;
  const effScore = Math.max(
    0,
    Math.min(100, Math.round(directionalEfficiency * effMultiplier))
  );
  const emaTrendScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (counterCount >= 1 ? Math.min(1, emaAlignedRatio * 1.25) : emaAlignedRatio) *
          70 +
          (emaSlopeAligned ? 30 : 0)
      )
    )
  );
  const effectiveSwingForScore =
    counterCount >= 1 ? Math.min(100, Math.round(swingScore * 1.15)) : swingScore;
  const baseMatchScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        uniformityScore * 0.28 +
          wickScore * 0.22 +
          effectiveSwingForScore * 0.2 +
          effScore * 0.16 +
          emaTrendScore * 0.14
      )
    )
  );

  const patternFeatures = extractPatternFeatures({
    runCandles,
    emaValues: windowEma,
    runIndices,
    direction: targetDir,
    medianBody,
    avgWickRatio,
    uniformityScore,
    avgBodyToMedianRatio,
    directionalEfficiency,
    swingScore,
  });

  const aiResult =
    config.aiLearningEnabled && aiContext
      ? scorePatternWithAi(
          patternFeatures,
          aiContext.model,
          aiContext.samples,
          config.aiInfluencePercent ?? 35
        )
      : { aiSimilarityScore: undefined, aiDeltaScore: 0, aiLabel: undefined };

  const matchScore = Math.max(
    0,
    Math.min(100, baseMatchScore + aiResult.aiDeltaScore)
  );

  const reasons: string[] = [];
  let passesQuality = true;

  const learnedPref =
    config.aiLearningEnabled && aiContext && aiContext.model.passCount >= 1
      ? aiContext.model.preferredSummary
      : null;
  const strongAiSpecMatch =
    Boolean(learnedPref) &&
    (aiResult.aiSimilarityScore ?? 0) >= 82 &&
    directionalEfficiency >= 0.65;

  const effectiveMaxWick =
    strongAiSpecMatch && learnedPref?.maxWickPercent !== undefined
      ? Math.max(config.maxWickRatio, Math.min(0.4, learnedPref.maxWickPercent / 100 + 0.03))
      : config.maxWickRatio;

  const effectiveMinUniformity =
    strongAiSpecMatch && learnedPref?.minUniformity !== undefined
      ? Math.min(config.minUniformityScore, Math.max(64, learnedPref.minUniformity - 4))
      : config.minUniformityScore;

  const effectiveMaxBodyRatio =
    strongAiSpecMatch && learnedPref?.maxBodyRatio !== undefined
      ? Math.max(config.maxBodyToMedianRatio, Math.min(2.25, learnedPref.maxBodyRatio * 1.1))
      : config.maxBodyToMedianRatio;

  if (
    avgWickRatio > effectiveMaxWick ||
    maxSingleWickRatio > effectiveMaxWick * 1.65 ||
    hasExcessiveReverseWick
  ) {
    passesQuality = false;
    reasons.push(
      `ไส้เทียนเฉลี่ย ${(avgWickRatio * 100).toFixed(0)}% สูงกว่าเกณฑ์ ${(effectiveMaxWick * 100).toFixed(0)}%`
    );
  } else {
    reasons.push(`ไส้เล็กน้อยสวยงาม เฉลี่ย ${(avgWickRatio * 100).toFixed(1)}%`);
  }

  if (uniformityScore < effectiveMinUniformity || hasUnevenPeerBar) {
    passesQuality = false;
    reasons.push(
      `ขนาดแท่งเทียนต่างกันมากเกินไป (${uniformityScore}/100)`
    );
  } else {
    reasons.push(`ขนาดแท่งสม่ำเสมอดี ${uniformityScore}/100`);
  }

  if (
    maxSingleBodyRatio > effectiveMaxBodyRatio ||
    avgBodyToMedianRatio > effectiveMaxBodyRatio * 0.94
  ) {
    passesQuality = false;
    reasons.push('พบแท่งยาวกระชากเกินเกณฑ์');
  } else if (minSingleBodyRatio < config.minBodyToMedianRatio) {
    passesQuality = false;
    reasons.push('มีแท่งเล็กสั้นจนแทบไม่มีเนื้อเทียน');
  } else {
    reasons.push(`ขนาดเนื้อเทียนพอดี (${avgBodyToMedianRatio.toFixed(2)}x ค่าเฉลี่ย)`);
  }

  const requiredSwing = counterCount >= 2 ? 60 : counterCount === 1 ? 72 : 88;
  if (swingScore < requiredSwing) {
    passesQuality = false;
    reasons.push('กราฟมีการสวิงย้อนตัวระหว่างแท่ง');
  } else {
    reasons.push(
      counterCount > 0
        ? `พักตัว ${counterCount} แท่งแล้วไหลต่อสวย (${swingScore}%)`
        : `เรียงตัวสีเดียวสวย (${swingScore}%)`
    );
  }

  const requiredEfficiency = counterCount >= 2 ? 0.38 : counterCount === 1 ? 0.48 : 0.7;
  const requiredEmaRatio = counterCount >= 2 ? 0.5 : counterCount === 1 ? 0.6 : 0.75;
  const requiredNetMove =
    counterCount > 0
      ? medianBody * Math.max(1.4, (sameDirMetrics.length - counterCount) * 0.65)
      : medianBody * Math.max(1.8, runLength * 0.48);
  const pullbackWithinStart =
    counterCount === 0 ||
    runCandles.every((bar) =>
      targetDir === 'UP'
        ? bar.low >= firstRunBar.open - medianBody * 0.35
        : bar.high <= firstRunBar.open + medianBody * 0.35
    );
  const counterBarsValidForLen =
    counterCount === 0 ||
    (counterCount === 1 && runLength >= 4 && sameDirMetrics.length >= 3) ||
    (counterCount === 2 && runLength >= 5 && sameDirMetrics.length >= 3);

  if (
    !counterBarsValidForLen ||
    !pullbackWithinStart ||
    directionalEfficiency < requiredEfficiency ||
    netMove < requiredNetMove ||
    !emaSlopeAligned ||
    emaAlignedRatio < requiredEmaRatio ||
    !breaksPriorRange
  ) {
    passesQuality = false;
    reasons.push('กราฟยังแกว่งออกข้าง (Sideways) ในกรอบ M15 หรือยังไม่ไหลตามเส้น EMA');
  } else {
    reasons.push(`ไหลสวยชัดเจนในกรอบ M15 (ความชัน ${Math.round(directionalEfficiency * 100)}%)`);
  }

  if (aiResult.aiLabel && aiResult.aiDeltaScore <= -6) {
    passesQuality = false;
    reasons.push(aiResult.aiLabel);
  } else if (aiResult.aiLabel) {
    reasons.push(aiResult.aiLabel);
  }

  const requiredMatchScore = config.minMatchScore ?? 86;
  if (matchScore < requiredMatchScore) {
    passesQuality = false;
    reasons.push(`คะแนนรวม ${matchScore}% ต่ำกว่าเกณฑ์คัดกรอง ${requiredMatchScore}%`);
  } else {
    reasons.push(`เข้าเกณฑ์คุณภาพดี ${matchScore}%`);
  }

  let status: MatchStatus = 'NONE';
  if (passesQuality) {
    if (runLength >= config.targetMinCandles && runLength <= config.targetMaxCandles) {
      status = 'MATCH';
    } else if (runLength === config.targetMinCandles - 1 && runLength >= 2) {
      status = 'FORMING';
    }
  } else if (
    runLength === config.targetMinCandles - 1 &&
    runLength >= 2 &&
    counterCount === 0 &&
    !hasUnevenPeerBar &&
    !hasExcessiveReverseWick &&
    swingScore >= 88 &&
    matchScore >= Math.max(76, requiredMatchScore - 10) &&
    directionalEfficiency >= 0.7 &&
    emaSlopeAligned &&
    emaAlignedRatio >= 0.75 &&
    avgWickRatio <= config.maxWickRatio &&
    uniformityScore >= config.minUniformityScore
  ) {
    status = 'FORMING';
  }

  return {
    status,
    direction: targetDir,
    runLength,
    matchedIndices: globalMatchedIndices,
    signalIndex:
      status === 'MATCH' || status === 'FORMING'
        ? globalMatchedIndices[globalMatchedIndices.length - 1] ?? null
        : null,
    signalPrice:
      status === 'MATCH' || status === 'FORMING' ? latestBar.close : null,
    signalTime:
      status === 'MATCH' || status === 'FORMING' ? latestBar.time : null,
    avgWickRatio,
    uniformityScore,
    matchScore,
    baseMatchScore,
    directionalEfficiency,
    avgBodyToMedianRatio,
    counterCandles: counterCount,
    swingScore,
    emaValues: fullEmaValues,
    reasons,
    patternFeatures,
    aiSimilarityScore: aiResult.aiSimilarityScore,
    aiDeltaScore: aiResult.aiDeltaScore,
    aiLabel: aiResult.aiLabel,
  };
}

/**
 * Analyzes 1-minute candlesticks for a clean, steady, small-bodied,
 * minimal-wick, same-color flowing trend over the latest configured candles.
 * When `realtimeAlertImmediate` (or `options.includeLastCandle`) is enabled,
 * evaluates the live forming candle in real time so signals trigger immediately
 * without waiting for the 1-minute timer to finish.
 */
export function analyzeCandleTrend(
  candles: Candle[],
  config: ScannerConfig,
  options: {
    includeLastCandle?: boolean;
    aiModel?: AiPatternModel;
    aiSamples?: PatternFeedbackSample[];
  } = {}
): TrendAnalysis {
  const emaValues = calculateEMA(candles, 7);
  const useImmediate =
    options.includeLastCandle !== undefined
      ? options.includeLastCandle
      : config.realtimeAlertImmediate;
  const aiContext =
    options.aiModel && options.aiSamples
      ? { model: options.aiModel, samples: options.aiSamples }
      : undefined;

  if (!useImmediate) {
    const closedOnly = candles.slice(0, Math.max(0, candles.length - 1));
    return analyzeCandleSlice(closedOnly, emaValues, config, aiContext);
  }

  const liveResult = analyzeCandleSlice(candles, emaValues, config, aiContext);
  if (liveResult.status === 'MATCH' || liveResult.status === 'OVEREXTENDED') {
    return liveResult;
  }

  // If the current live bar just opened (tiny/doji body), keep any active closed-bar
  // match or forming signal instead of flickering to NONE during the first few seconds.
  if (candles.length >= 2) {
    const recentBodies = candles
      .slice(-Math.min(20, Math.max(15, config.scanWindowBars ?? 15)), -1)
      .map((c) => Math.abs(c.close - c.open))
      .filter((b) => b > 0);
    const medianBody = median(recentBodies);
    const liveBar = candles[candles.length - 1];
    const liveBody = Math.abs(liveBar.close - liveBar.open);
    if (medianBody > 0 && liveBody < medianBody * 0.35) {
      const closedResult = analyzeCandleSlice(
        candles.slice(0, -1),
        emaValues,
        config,
        aiContext
      );
      if (closedResult.status === 'MATCH' || closedResult.status === 'FORMING') {
        return closedResult;
      }
    }
  }

  return liveResult;
}
