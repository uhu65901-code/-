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

export interface ScannerConfig {
  scanWindowBars: number; // default 15 (M15: 15-20 candles max for clear trend visibility)
  targetMinCandles: number; // default 4 (compare latest 4-6 candles)
  targetMaxCandles: number; // default 6
  maxWickRatio: number; // default 0.25 (allow small natural wicks up to 25%)
  minUniformityScore: number; // default 76 (0..100 crisp uniform candle sizes)
  minMatchScore: number; // default 86 (0..100 balanced threshold so qualifying charts alert promptly)
  maxCounterCandles: number; // default 0 (0 = strictly same color, 1 = optional)
  maxBodyToMedianRatio: number; // default 1.65 (prevents oversized spike bars)
  minBodyToMedianRatio: number; // default 0.42 (prevents dead flat bars)
  realtimeAlertImmediate: boolean; // default true (alert immediately mid-bar without waiting for close)
  aiLearningEnabled: boolean; // default true (adaptive pattern scoring from user PASS/REJECT clicks)
  aiInfluencePercent: number; // default 35 (0..60 weight of AI pattern similarity adjustment)
  directionFilter: 'BOTH' | TrendDirection;
  categoryFilter: 'ALL' | AssetCategory;
  soundEnabled: boolean;
  soundVolume: number; // 0.2..1.0 (default 0.95)
  soundDurationMode: SoundDurationMode; // default 'LONG'
  includeFormingInList: boolean;
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
    idealUniformity: number;
    idealBodyRatio: number;
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
  maxCounterCandles: 0,
  maxBodyToMedianRatio: 1.65,
  minBodyToMedianRatio: 0.42,
  realtimeAlertImmediate: true,
  aiLearningEnabled: true,
  aiInfluencePercent: 35,
  directionFilter: 'BOTH',
  categoryFilter: 'ALL',
  soundEnabled: true,
  soundVolume: 0.95,
  soundDurationMode: 'LONG',
  includeFormingInList: true,
};
