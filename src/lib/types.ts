export type AssetCategory = 'BINARY' | 'DIGITAL';
export type TrendDirection = 'UP' | 'DOWN';
export type MatchStatus = 'MATCH' | 'FORMING' | 'OVEREXTENDED' | 'NONE';
export type ConnectionMode =
  | 'DEMO_STREAM'
  | 'IQ_OPTION_LIVE'
  | 'LOCAL_DEMO_STREAM'
  | 'IQ_BROWSER_LIVE';
export type SoundDurationMode = 'STANDARD' | 'LONG';

export interface Candle {
  time: number; // Unix timestamp in seconds (start of 1m bar)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AssetInfo {
  id: string;
  iqActiveId: number;
  name: string;
  symbol: string;
  category: AssetCategory;
  isOtc: boolean;
  payoutPercent: number;
  decimals: number;
}

export const MAX_AI_TRAINING_SAMPLES = 2000;

export interface CandleBodyDisplayConfig {
  mode: 'RANGE' | 'FIXED';
  minBars: number; // 2..8
  maxBars: number; // 2..10
  fixedBars: number; // 2..10
  avgMode: 'SYNC' | 'RANGE' | 'FIXED';
  avgMinBars: number; // 2..8
  avgMaxBars: number; // 2..10
  avgFixedBars: number; // 2..10
}

export const DEFAULT_CANDLE_BODY_CONFIG: CandleBodyDisplayConfig = {
  mode: 'RANGE',
  minBars: 5,
  maxBars: 6,
  fixedBars: 6,
  avgMode: 'SYNC',
  avgMinBars: 5,
  avgMaxBars: 6,
  avgFixedBars: 6,
};

export interface CandleDiffDisplayConfig {
  mode: 'RANGE' | 'FIXED';
  minBars: number; // 2..8
  maxBars: number; // 2..10
  fixedBars: number; // 2..10 (default 6)
}

export const DEFAULT_CANDLE_DIFF_CONFIG: CandleDiffDisplayConfig = {
  mode: 'FIXED',
  minBars: 4,
  maxBars: 6,
  fixedBars: 6,
};

export interface ChartPanelVisibility {
  showBody: boolean;
  showWick: boolean;
  showDiff: boolean;
}

export const DEFAULT_CHART_PANEL_VISIBILITY: ChartPanelVisibility = {
  showBody: true,
  showWick: true,
  showDiff: true,
};

export interface SpecialFlowFilterConfig {
  barMode: 'RANGE' | 'FIXED';
  minBars: number; // 2..8
  maxBars: number; // 2..10
  fixedBars: number; // 2..10
  maxBodyDiffRatio: number; // 0.00..2.00 (default 0.40)
  maxWickDiffRatio: number; // 0.00..2.00 (default 0.30)
}

export const DEFAULT_SPECIAL_FLOW_CONFIG: SpecialFlowFilterConfig = {
  barMode: 'RANGE',
  minBars: 4,
  maxBars: 6,
  fixedBars: 5,
  maxBodyDiffRatio: 0.4,
  maxWickDiffRatio: 0.3,
};

export interface SpecialLengthFilterConfig {
  barMode: 'RANGE' | 'FIXED';
  minBars: number; // 2..8
  maxBars: number; // 2..10
  fixedBars: number; // 2..10 (e.g. 3, 4, 5, 6, 7, 8)
  maxBodyLengthRatio: number; // Fixed 1.90x by program
  maxWickLengthRatio: number; // Fixed 0.80x by program
}

export const DEFAULT_SPECIAL_LENGTH_CONFIG: SpecialLengthFilterConfig = {
  barMode: 'FIXED',
  minBars: 4,
  maxBars: 6,
  fixedBars: 4,
  maxBodyLengthRatio: 1.9,
  maxWickLengthRatio: 0.8,
};

export interface SidewaysFilterConfig {
  barMode: 'FIXED' | 'RANGE';
  fixedBars: number; // 4..20 (presets: 8, 9, 10, 11, 12, 13, 14, 15)
  minBars: number; // 4..18
  maxBars: number; // 4..20
  minBodyLengthRatio: number; // Fixed 2.50x by program
}

export const DEFAULT_SIDEWAYS_CONFIG: SidewaysFilterConfig = {
  barMode: 'FIXED',
  fixedBars: 8,
  minBars: 8,
  maxBars: 15,
  minBodyLengthRatio: 2.5,
};

export interface ScannerConfig {
  scanWindowBars: number; // default 15 (M15: 15-20 candles max for clear trend visibility)
  targetMinCandles: number; // default 4 (compare latest 4-6 candles)
  targetMaxCandles: number; // default 6
  maxWickRatio: number; // default 0.25 (allow small natural wicks up to 25%)
  minUniformityScore: number; // default 76 (0..100 crisp uniform candle sizes)
  minMatchScore: number; // default 86 (0..100 balanced threshold so qualifying charts alert promptly)
  maxCounterCandles: number; // default 2 (allow 1-2 pullback bars in 5-6 candle trend)
  maxBodyToMedianRatio: number; // default 1.65 (prevents oversized spike bars)
  minBodyToMedianRatio: number; // default 0.42 (prevents dead flat bars)
  realtimeAlertImmediate: boolean; // default false (update after candle closes)
  aiLearningEnabled: boolean; // default true (adaptive pattern scoring from user PASS/REJECT clicks)
  aiInfluencePercent: number; // default 35 (0..60 weight of AI pattern similarity adjustment)
  directionFilter: 'BOTH' | TrendDirection;
  categoryFilter: 'ALL' | AssetCategory;
  soundEnabled: boolean;
  soundVolume: number; // 0.2..1.0 (default 0.95)
  soundDurationMode: SoundDurationMode; // default 'LONG'
  includeFormingInList: boolean;
  rankRefreshIntervalSec: number; // default 60
  candleBodyDisplay?: CandleBodyDisplayConfig;
  candleWickDisplay?: CandleBodyDisplayConfig;
  candleDiffDisplay?: CandleDiffDisplayConfig;
  specialFlowFilter?: SpecialFlowFilterConfig;
  specialLengthFilter?: SpecialLengthFilterConfig;
  sidewaysFilter?: SidewaysFilterConfig;
}

export interface PatternFeatureVector {
  runLengthNorm: number; // runLength / 6
  avgWickRatio: number; // 0..1
  reverseWickRatio: number; // avg reverse wick relative to body
  uniformityScoreNorm: number; // uniformityScore / 100
  avgBodyToMedianRatio: number; // body size vs 26-bar median
  bodyTrendSlope: number; // last-half body / first-half body
  directionalEfficiency: number; // 0..1 netMove / sum(ranges)
  emaDistanceRatio: number; // avg close distance from EMA7 in medianBody units
  swingScoreNorm: number; // swingScore / 100
}

export type PatternVerdict = 'PASS' | 'REJECT';

export interface PatternFeedbackSample {
  id: string;
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
  createdAt: number;
}

export interface AiPatternModel {
  passCount: number;
  rejectCount: number;
  passCentroid: PatternFeatureVector | null;
  rejectCentroid: PatternFeatureVector | null;
  featureWeights: Record<keyof PatternFeatureVector, number>;
  preferredSummary: {
    idealRunLength: number;
    idealWickPercent: number;
    maxWickPercent?: number;
    idealUniformity: number;
    minUniformity?: number;
    idealAlignment?: number;
    minAlignment?: number;
    idealBodyRatio: number;
    minBodyRatio?: number;
    maxBodyRatio?: number;
  } | null;
}

export interface TrendAnalysis {
  status: MatchStatus;
  direction: TrendDirection | null;
  runLength: number;
  matchedIndices: number[]; // indices in the input candle array belonging to the trend window
  signalIndex: number | null; // index of the latest candle in the matched signal
  signalPrice: number | null;
  signalTime: number | null;
  avgWickRatio: number; // 0..1
  uniformityScore: number; // 0..100
  matchScore: number; // 0..100 overall trend quality score
  baseMatchScore?: number; // pre-AI score
  directionalEfficiency: number; // 0..1 anti-sideways flow efficiency
  avgBodyToMedianRatio: number;
  counterCandles: number;
  swingScore: number; // 0..100 (higher = smoother stair-step without swings)
  emaValues: number[];
  reasons: string[];
  patternFeatures?: PatternFeatureVector;
  aiSimilarityScore?: number; // 0..100 similarity to user-approved patterns
  aiDeltaScore?: number; // adjustment applied by AI learner
  aiLabel?: string;
}

export interface ScannedAssetState {
  asset: AssetInfo;
  candles: Candle[];
  analysis: TrendAnalysis;
  lastPrice: number;
  secondsRemaining: number;
  updatedAt: number;
}

export type TradeOutcome = 'WIN' | 'LOSS' | 'DRAW';

export interface TrendAlert {
  id: string;
  assetId: string;
  assetName: string;
  assetSymbol: string;
  category: AssetCategory;
  payoutPercent: number;
  direction: TrendDirection;
  runLength: number;
  avgWickRatio: number;
  uniformityScore: number;
  matchScore?: number;
  priceAtAlert: number;
  candleTime: number;
  createdAt: number;
  acknowledged: boolean;
  decisionNote?: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED';
  tradeOutcome?: TradeOutcome;
  patternFeatures?: PatternFeatureVector;
  aiVerdict?: PatternVerdict;
  aiSimilarityScore?: number;
}

export interface DecisionRecord {
  id: string;
  alertId: string;
  assetId: string;
  assetName: string;
  direction: TrendDirection;
  payoutPercent: number;
  matchScore: number;
  runLength: number;
  decisionNote: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED';
  tradeOutcome?: TradeOutcome;
  recordedAt: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  scanWindowBars: 15,
  targetMinCandles: 4,
  targetMaxCandles: 6,
  maxWickRatio: 0.25,
  minUniformityScore: 76,
  minMatchScore: 86,
  maxCounterCandles: 2,
  maxBodyToMedianRatio: 1.65,
  minBodyToMedianRatio: 0.42,
  realtimeAlertImmediate: false,
  aiLearningEnabled: true,
  aiInfluencePercent: 35,
  directionFilter: 'BOTH',
  categoryFilter: 'ALL',
  soundEnabled: false,
  soundVolume: 0.95,
  soundDurationMode: 'LONG',
  includeFormingInList: true,
  rankRefreshIntervalSec: 60,
  candleBodyDisplay: { ...DEFAULT_CANDLE_BODY_CONFIG },
  candleWickDisplay: { ...DEFAULT_CANDLE_BODY_CONFIG },
  candleDiffDisplay: { ...DEFAULT_CANDLE_DIFF_CONFIG },
  specialFlowFilter: { ...DEFAULT_SPECIAL_FLOW_CONFIG },
  specialLengthFilter: { ...DEFAULT_SPECIAL_LENGTH_CONFIG },
  sidewaysFilter: { ...DEFAULT_SIDEWAYS_CONFIG },
};
