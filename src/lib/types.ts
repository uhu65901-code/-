export type AssetCategory = 'BINARY' | 'DIGITAL';
export type TrendDirection = 'UP' | 'DOWN';
export type MatchStatus = 'MATCH' | 'FORMING' | 'OVEREXTENDED' | 'NONE';
export type ConnectionMode = 'DEMO_STREAM' | 'IQ_OPTION_LIVE' | 'LOCAL_DEMO_STREAM';
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

export interface ScannerConfig {
  targetMinCandles: number; // default 5
  targetMaxCandles: number; // default 6
  maxWickRatio: number; // default 0.26 (26%)
  minUniformityScore: number; // default 70 (0..100)
  maxCounterCandles: number; // default 0 (0 or 1)
  maxBodyToMedianRatio: number; // default 2.1 (prevents big swing/spike bars)
  minBodyToMedianRatio: number; // default 0.32 (prevents dead flat bars)
  directionFilter: 'BOTH' | TrendDirection;
  categoryFilter: 'ALL' | AssetCategory;
  soundEnabled: boolean;
  soundVolume: number; // 0.2..1.0 (default 0.95)
  soundDurationMode: SoundDurationMode; // default 'LONG'
  includeFormingInList: boolean;
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
  avgBodyToMedianRatio: number;
  counterCandles: number;
  swingScore: number; // 0..100 (higher = smoother stair-step without swings)
  emaValues: number[];
  reasons: string[];
}

export interface ScannedAssetState {
  asset: AssetInfo;
  candles: Candle[];
  analysis: TrendAnalysis;
  lastPrice: number;
  secondsRemaining: number;
  updatedAt: number;
}

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
  priceAtAlert: number;
  candleTime: number;
  createdAt: number;
  acknowledged: boolean;
  decisionNote?: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED';
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  targetMinCandles: 5,
  targetMaxCandles: 6,
  maxWickRatio: 0.26,
  minUniformityScore: 70,
  maxCounterCandles: 0,
  maxBodyToMedianRatio: 2.1,
  minBodyToMedianRatio: 0.32,
  directionFilter: 'BOTH',
  categoryFilter: 'ALL',
  soundEnabled: true,
  soundVolume: 0.95,
  soundDurationMode: 'LONG',
  includeFormingInList: true,
};
