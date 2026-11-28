import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  AssetFlowRankInfo,
  buildCommittedRankSnapshot,
  CommittedRankSnapshot,
  evaluateCandleCloseRankUpdate,
  getAssetFlowRankInfo,
  PendingBarEpochState,
  projectAssetsWithCommittedSnapshot,
} from '../lib/assetRanking';
import {
  buildSpecialFlowRankSnapshot,
  sanitizeSpecialFlowConfig,
  SpecialFlowRankSnapshot,
} from '../lib/specialFlowRanking';
import {
  buildSpecialLengthRankSnapshot,
  FIXED_SPECIAL_BODY_LIMIT,
  FIXED_SPECIAL_WICK_LIMIT,
  sanitizeSpecialLengthConfig,
  SpecialLengthRankSnapshot,
} from '../lib/specialLengthRanking';
import {
  buildSidewaysRankSnapshot,
  FIXED_SIDEWAYS_MIN_BODY_RATIO,
  sanitizeSidewaysConfig,
  SidewaysRankSnapshot,
} from '../lib/sidewaysRanking';
import {
  AiPatternModel,
  AssetCategory,
  DEFAULT_SIDEWAYS_CONFIG,
  DEFAULT_SPECIAL_FLOW_CONFIG,
  DEFAULT_SPECIAL_LENGTH_CONFIG,
  PatternFeedbackSample,
  ScannedAssetState,
  SidewaysFilterConfig,
  SpecialFlowFilterConfig,
  SpecialLengthFilterConfig,
  TrendDirection,
} from '../lib/types';

interface ScannerSidebarProps {
  assets: ScannedAssetState[];
  selectedAssetIds: string[];
  activeSlotIndex: number;
  candleSecondsRemaining?: number;
  onSelectAsset: (assetId: string, assetName?: string) => void;
  categoryFilter: 'ALL' | AssetCategory;
  directionFilter: 'BOTH' | TrendDirection;
  targetMinCandles?: number;
  targetMaxCandles?: number;
  aiModel?: AiPatternModel;
  aiSamples?: PatternFeedbackSample[];
  specialFlowFilter?: SpecialFlowFilterConfig;
  onChangeSpecialFlowFilter?: (next: SpecialFlowFilterConfig) => void;
  specialLengthFilter?: SpecialLengthFilterConfig;
  onChangeSpecialLengthFilter?: (next: SpecialLengthFilterConfig) => void;
  sidewaysFilter?: SidewaysFilterConfig;
  onChangeSidewaysFilter?: (next: SidewaysFilterConfig) => void;
  onChangeFilters: (patch: {
    categoryFilter?: 'ALL' | AssetCategory;
    directionFilter?: 'BOTH' | TrendDirection;
  }) => void;
}

type TableViewMode =
  | 'BOTH'
  | 'SAME_COLOR'
  | 'MIXED_COLOR'
  | 'SPECIAL'
  | 'SPECIAL_2'
  | 'SIDEWAYS';

function getSidewaysBarPresetKey(cfg: SidewaysFilterConfig): string {
  if (cfg.barMode === 'FIXED' && cfg.fixedBars >= 8 && cfg.fixedBars <= 15) {
    return `fixed-${cfg.fixedBars}`;
  }
  return 'custom';
}

function getSpecialBarPresetKey(cfg: {
  barMode: 'RANGE' | 'FIXED';
  minBars: number;
  maxBars: number;
  fixedBars: number;
}): string {
  if (cfg.barMode === 'RANGE') {
    if (cfg.minBars === 2 && cfg.maxBars === 4) return 'range-2-4';
    if (cfg.minBars === 4 && cfg.maxBars === 6) return 'range-4-6';
    if (cfg.minBars === 5 && cfg.maxBars === 6) return 'range-5-6';
    return 'custom';
  }
  if ([3, 4, 5, 6, 7, 8].includes(cfg.fixedBars)) {
    return `fixed-${cfg.fixedBars}`;
  }
  return 'custom';
}

interface RatioNumberInputProps {
  testId: string;
  ariaLabel: string;
  value: number;
  onCommit: (nextValue: number) => void;
  className: string;
}

const RatioNumberInput: React.FC<RatioNumberInputProps> = ({
  testId,
  ariaLabel,
  value,
  onCommit,
  className,
}) => {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => value.toFixed(2));

  useEffect(() => {
    if (!focused) {
      setDraft(value.toFixed(2));
    }
  }, [value, focused]);

  const commitDraft = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '.' || trimmed === '0.') return;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(2, Math.max(0, Math.round(parsed * 100) / 100));
      onCommit(clamped);
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      data-testid={testId}
      aria-label={ariaLabel}
      value={focused ? draft : value.toFixed(2)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(value.toFixed(2));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const nextRaw = e.target.value.replace(',', '.');
        if (nextRaw !== '' && !/^\d{0,2}(\.\d{0,2})?$/.test(nextRaw)) {
          return;
        }
        setDraft(nextRaw);
        if (nextRaw !== '' && !nextRaw.endsWith('.')) {
          commitDraft(nextRaw);
        }
      }}
      onBlur={() => {
        setFocused(false);
        const parsed = Number(draft.trim());
        const clamped = Number.isFinite(parsed) && draft.trim() !== ''
          ? Math.min(2, Math.max(0, Math.round(parsed * 100) / 100))
          : value;
        setDraft(clamped.toFixed(2));
        onCommit(clamped);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const delta = e.key === 'ArrowUp' ? 0.01 : -0.01;
          const base = Number.isFinite(Number(draft)) && draft.trim() !== '' ? Number(draft) : value;
          const next = Math.min(2, Math.max(0, Math.round((base + delta) * 100) / 100));
          setDraft(next.toFixed(2));
          onCommit(next);
        }
      }}
      className={className}
    />
  );
};

export const ScannerSidebar: React.FC<ScannerSidebarProps> = ({
  assets,
  selectedAssetIds,
  activeSlotIndex,
  candleSecondsRemaining,
  onSelectAsset,
  categoryFilter,
  directionFilter,
  targetMinCandles = 4,
  targetMaxCandles = 6,
  aiModel,
  aiSamples = [],
  specialFlowFilter,
  onChangeSpecialFlowFilter,
  specialLengthFilter,
  onChangeSpecialLengthFilter,
  sidewaysFilter,
  onChangeSidewaysFilter,
  onChangeFilters,
}) => {
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'OTC' | 'REGULAR'>('ALL');
  const [onlyQualified, setOnlyQualified] = useState(false);
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('BOTH');
  const [localSpecialConfig, setLocalSpecialConfig] = useState<SpecialFlowFilterConfig>(() =>
    sanitizeSpecialFlowConfig(specialFlowFilter ?? DEFAULT_SPECIAL_FLOW_CONFIG)
  );
  const [showCustomSpecialRange, setShowCustomSpecialRange] = useState(false);
  const [localSpecial2Config, setLocalSpecial2Config] = useState<SpecialLengthFilterConfig>(() =>
    sanitizeSpecialLengthConfig(specialLengthFilter ?? DEFAULT_SPECIAL_LENGTH_CONFIG)
  );
  const [showCustomSpecial2Range, setShowCustomSpecial2Range] = useState(false);
  const [localSidewaysConfig, setLocalSidewaysConfig] = useState<SidewaysFilterConfig>(() =>
    sanitizeSidewaysConfig(sidewaysFilter ?? DEFAULT_SIDEWAYS_CONFIG)
  );
  const [showCustomSidewaysBars, setShowCustomSidewaysBars] = useState(false);

  useEffect(() => {
    if (specialFlowFilter) {
      setLocalSpecialConfig(sanitizeSpecialFlowConfig(specialFlowFilter));
    }
  }, [specialFlowFilter]);

  useEffect(() => {
    if (specialLengthFilter) {
      setLocalSpecial2Config(sanitizeSpecialLengthConfig(specialLengthFilter));
    }
  }, [specialLengthFilter]);

  useEffect(() => {
    if (sidewaysFilter) {
      setLocalSidewaysConfig(sanitizeSidewaysConfig(sidewaysFilter));
    }
  }, [sidewaysFilter]);

  const activeSpecialConfig = specialFlowFilter
    ? sanitizeSpecialFlowConfig(specialFlowFilter)
    : localSpecialConfig;
  const activeSpecialConfigRef = useRef(activeSpecialConfig);
  activeSpecialConfigRef.current = activeSpecialConfig;

  const activeSpecial2Config = specialLengthFilter
    ? sanitizeSpecialLengthConfig(specialLengthFilter)
    : localSpecial2Config;
  const activeSpecial2ConfigRef = useRef(activeSpecial2Config);
  activeSpecial2ConfigRef.current = activeSpecial2Config;

  const activeSidewaysConfig = sidewaysFilter
    ? sanitizeSidewaysConfig(sidewaysFilter)
    : localSidewaysConfig;
  const activeSidewaysConfigRef = useRef(activeSidewaysConfig);
  activeSidewaysConfigRef.current = activeSidewaysConfig;

  const aiContext = useMemo(
    () => (aiModel && aiSamples.length > 0 ? { model: aiModel, samples: aiSamples } : undefined),
    [aiModel, aiSamples]
  );
  const aiContextRef = useRef(aiContext);
  aiContextRef.current = aiContext;

  const latestAssetsRef = useRef<ScannedAssetState[]>(assets);
  latestAssetsRef.current = assets;

  const [committedSnapshot, setCommittedSnapshot] = useState<CommittedRankSnapshot | null>(() =>
    assets.length > 0 ? buildCommittedRankSnapshot(assets, aiContext) : null
  );
  const snapshotRef = useRef<CommittedRankSnapshot | null>(committedSnapshot);
  snapshotRef.current = committedSnapshot;
  const committedAssetsRef = useRef<ScannedAssetState[]>(assets);
  const [specialSnapshot, setSpecialSnapshot] = useState<SpecialFlowRankSnapshot | null>(() =>
    assets.length > 0
      ? buildSpecialFlowRankSnapshot(assets, activeSpecialConfig, aiContext)
      : null
  );
  const [special2Snapshot, setSpecial2Snapshot] = useState<SpecialLengthRankSnapshot | null>(() =>
    assets.length > 0
      ? buildSpecialLengthRankSnapshot(assets, activeSpecial2Config, aiContext)
      : null
  );
  const [sidewaysSnapshot, setSidewaysSnapshot] = useState<SidewaysRankSnapshot | null>(() =>
    assets.length > 0
      ? buildSidewaysRankSnapshot(assets, activeSidewaysConfig)
      : null
  );
  const pendingEpochRef = useRef<PendingBarEpochState | null>(null);

  // Freeze ENTIRE ranking (order + table split + status + flow counts) until the 1-minute candle closes
  useEffect(() => {
    const decision = evaluateCandleCloseRankUpdate(
      snapshotRef.current,
      assets,
      Date.now(),
      pendingEpochRef.current
    );
    pendingEpochRef.current = decision.nextPending;

    if (!decision.shouldUpdate) return;

    if (assets.length === 0) {
      snapshotRef.current = null;
      committedAssetsRef.current = [];
      setCommittedSnapshot(null);
      setSpecialSnapshot(null);
      setSpecial2Snapshot(null);
      setSidewaysSnapshot(null);
      return;
    }

    committedAssetsRef.current = assets;
    const nextSnapshot = buildCommittedRankSnapshot(
      assets,
      aiContextRef.current,
      decision.targetEpoch > 0 ? decision.targetEpoch : undefined
    );
    snapshotRef.current = nextSnapshot;
    setCommittedSnapshot(nextSnapshot);
    setSpecialSnapshot(
      buildSpecialFlowRankSnapshot(
        assets,
        activeSpecialConfigRef.current,
        aiContextRef.current,
        decision.targetEpoch > 0 ? decision.targetEpoch : undefined
      )
    );
    setSpecial2Snapshot(
      buildSpecialLengthRankSnapshot(
        assets,
        activeSpecial2ConfigRef.current,
        aiContextRef.current,
        decision.targetEpoch > 0 ? decision.targetEpoch : undefined
      )
    );
    setSidewaysSnapshot(
      buildSidewaysRankSnapshot(
        assets,
        activeSidewaysConfigRef.current,
        decision.targetEpoch > 0 ? decision.targetEpoch : undefined
      )
    );
  }, [assets]);

  const updateSpecialConfig = (patch: Partial<SpecialFlowFilterConfig>) => {
    const next = sanitizeSpecialFlowConfig({ ...activeSpecialConfig, ...patch });
    setLocalSpecialConfig(next);
    activeSpecialConfigRef.current = next;
    onChangeSpecialFlowFilter?.(next);
    const sourceAssets =
      committedAssetsRef.current.length > 0
        ? committedAssetsRef.current
        : latestAssetsRef.current;
    if (sourceAssets.length > 0) {
      setSpecialSnapshot(
        buildSpecialFlowRankSnapshot(
          sourceAssets,
          next,
          aiContextRef.current,
          snapshotRef.current?.barEpoch
        )
      );
    }
  };

  const updateSpecial2Config = (patch: Partial<SpecialLengthFilterConfig>) => {
    const next = sanitizeSpecialLengthConfig({ ...activeSpecial2Config, ...patch });
    setLocalSpecial2Config(next);
    activeSpecial2ConfigRef.current = next;
    onChangeSpecialLengthFilter?.(next);
    const sourceAssets =
      committedAssetsRef.current.length > 0
        ? committedAssetsRef.current
        : latestAssetsRef.current;
    if (sourceAssets.length > 0) {
      setSpecial2Snapshot(
        buildSpecialLengthRankSnapshot(
          sourceAssets,
          next,
          aiContextRef.current,
          snapshotRef.current?.barEpoch
        )
      );
    }
  };

  const updateSidewaysConfig = (patch: Partial<SidewaysFilterConfig>) => {
    const next = sanitizeSidewaysConfig({ ...activeSidewaysConfig, ...patch });
    setLocalSidewaysConfig(next);
    activeSidewaysConfigRef.current = next;
    onChangeSidewaysFilter?.(next);
    const sourceAssets =
      committedAssetsRef.current.length > 0
        ? committedAssetsRef.current
        : latestAssetsRef.current;
    if (sourceAssets.length > 0) {
      setSidewaysSnapshot(
        buildSidewaysRankSnapshot(
          sourceAssets,
          next,
          snapshotRef.current?.barEpoch
        )
      );
    }
  };

  const handleManualReRank = () => {
    pendingEpochRef.current = null;
    if (latestAssetsRef.current.length === 0) return;
    committedAssetsRef.current = latestAssetsRef.current;
    const nextSnapshot = buildCommittedRankSnapshot(
      latestAssetsRef.current,
      aiContextRef.current
    );
    snapshotRef.current = nextSnapshot;
    setCommittedSnapshot(nextSnapshot);
    setSpecialSnapshot(
      buildSpecialFlowRankSnapshot(
        latestAssetsRef.current,
        activeSpecialConfigRef.current,
        aiContextRef.current,
        nextSnapshot.barEpoch
      )
    );
    setSpecial2Snapshot(
      buildSpecialLengthRankSnapshot(
        latestAssetsRef.current,
        activeSpecial2ConfigRef.current,
        aiContextRef.current,
        nextSnapshot.barEpoch
      )
    );
    setSidewaysSnapshot(
      buildSidewaysRankSnapshot(
        latestAssetsRef.current,
        activeSidewaysConfigRef.current,
        nextSnapshot.barEpoch
      )
    );
  };

  const rankedAssets = useMemo(
    () => projectAssetsWithCommittedSnapshot(assets, committedSnapshot),
    [assets, committedSnapshot]
  );

  const rankInfoByAssetId = useMemo(() => {
    const map = new Map<string, AssetFlowRankInfo>();
    for (const item of rankedAssets) {
      const frozen = committedSnapshot?.rankInfoById.get(item.asset.id);
      map.set(item.asset.id, frozen ?? getAssetFlowRankInfo(item, aiContext));
    }
    return map;
  }, [rankedAssets, committedSnapshot, aiContext]);

  const getFrozenStatus = (item: ScannedAssetState) => {
    const snapStatus = committedSnapshot?.statusById.get(item.asset.id);
    if (snapStatus) return snapStatus;
    return {
      status: item.analysis.status,
      direction: item.analysis.direction,
      matchScore: item.analysis.matchScore,
      lastPrice: item.lastPrice,
    };
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rankedAssets.filter((item) => {
      const snapStatus = committedSnapshot?.statusById.get(item.asset.id);
      const st = snapStatus ? snapStatus.status : item.analysis.status;
      const dir = snapStatus ? snapStatus.direction : item.analysis.direction;

      if (onlyQualified) {
        if (st !== 'MATCH' && st !== 'FORMING') return false;
      }
      if (categoryFilter !== 'ALL' && item.asset.category !== categoryFilter) {
        return false;
      }
      if (marketFilter === 'OTC' && !item.asset.isOtc) {
        return false;
      }
      if (marketFilter === 'REGULAR' && item.asset.isOtc) {
        return false;
      }
      if (directionFilter !== 'BOTH' && dir && dir !== directionFilter) {
        if (st === 'MATCH' || st === 'FORMING') {
          return false;
        }
      }
      if (
        q &&
        !item.asset.name.toLowerCase().includes(q) &&
        !item.asset.symbol.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [rankedAssets, committedSnapshot, onlyQualified, categoryFilter, directionFilter, marketFilter, search]);

  // Separate pure same-color flowing charts (original table) vs 1-2 counter-color pullback charts (new table)
  // Frozen on committedSnapshot so rows NEVER jump between tables mid-minute
  const sameColorRows = useMemo(
    () =>
      filtered.filter((item) => {
        const info = rankInfoByAssetId.get(item.asset.id);
        return !info || info.counterCandles === 0;
      }),
    [filtered, rankInfoByAssetId]
  );

  const mixedColorRows = useMemo(
    () =>
      filtered.filter((item) => {
        const info = rankInfoByAssetId.get(item.asset.id);
        return Boolean(info && info.counterCandles >= 1 && info.counterCandles <= 2);
      }),
    [filtered, rankInfoByAssetId]
  );

  // Special Curated Table 1 rows (spread-only) strictly projected from candle-close specialSnapshot
  const specialRows = useMemo(() => {
    if (!specialSnapshot) return [];
    const byId = new Map(assets.map((a) => [a.asset.id, a]));
    const q = search.trim().toLowerCase();
    const out: Array<{
      item: ScannedAssetState;
      evalResult: NonNullable<ReturnType<SpecialFlowRankSnapshot['evalById']['get']>>;
    }> = [];

    for (const id of specialSnapshot.orderedIds) {
      const item = byId.get(id);
      const evalResult = specialSnapshot.evalById.get(id);
      if (!item || !evalResult || !evalResult.qualified) continue;

      if (categoryFilter !== 'ALL' && item.asset.category !== categoryFilter) continue;
      if (marketFilter === 'OTC' && !item.asset.isOtc) continue;
      if (marketFilter === 'REGULAR' && item.asset.isOtc) continue;
      if (
        directionFilter !== 'BOTH' &&
        evalResult.direction &&
        evalResult.direction !== directionFilter
      ) {
        continue;
      }
      if (
        q &&
        !item.asset.name.toLowerCase().includes(q) &&
        !item.asset.symbol.toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push({ item, evalResult });
    }
    return out;
  }, [
    specialSnapshot,
    assets,
    search,
    categoryFilter,
    marketFilter,
    directionFilter,
  ]);

  // Special Curated Table 2 rows (max body/wick length) strictly projected from candle-close special2Snapshot
  const special2Rows = useMemo(() => {
    if (!special2Snapshot) return [];
    const byId = new Map(assets.map((a) => [a.asset.id, a]));
    const q = search.trim().toLowerCase();
    const out: Array<{
      item: ScannedAssetState;
      evalResult: NonNullable<ReturnType<SpecialLengthRankSnapshot['evalById']['get']>>;
    }> = [];

    for (const id of special2Snapshot.orderedIds) {
      const item = byId.get(id);
      const evalResult = special2Snapshot.evalById.get(id);
      if (!item || !evalResult || !evalResult.qualified) continue;

      if (categoryFilter !== 'ALL' && item.asset.category !== categoryFilter) continue;
      if (marketFilter === 'OTC' && !item.asset.isOtc) continue;
      if (marketFilter === 'REGULAR' && item.asset.isOtc) continue;
      if (
        directionFilter !== 'BOTH' &&
        evalResult.direction &&
        evalResult.direction !== directionFilter
      ) {
        continue;
      }
      if (
        q &&
        !item.asset.name.toLowerCase().includes(q) &&
        !item.asset.symbol.toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push({ item, evalResult });
    }
    return out;
  }, [
    special2Snapshot,
    assets,
    search,
    categoryFilter,
    marketFilter,
    directionFilter,
  ]);

  // Sideways Table rows (color/wick-agnostic big bodies >= 2.50x) strictly projected from candle-close sidewaysSnapshot
  const sidewaysRows = useMemo(() => {
    if (!sidewaysSnapshot) return [];
    const byId = new Map(assets.map((a) => [a.asset.id, a]));
    const q = search.trim().toLowerCase();
    const out: Array<{
      item: ScannedAssetState;
      evalResult: NonNullable<ReturnType<SidewaysRankSnapshot['evalById']['get']>>;
    }> = [];

    for (const id of sidewaysSnapshot.orderedIds) {
      const item = byId.get(id);
      const evalResult = sidewaysSnapshot.evalById.get(id);
      if (!item || !evalResult || !evalResult.qualified) continue;

      if (categoryFilter !== 'ALL' && item.asset.category !== categoryFilter) continue;
      if (marketFilter === 'OTC' && !item.asset.isOtc) continue;
      if (marketFilter === 'REGULAR' && item.asset.isOtc) continue;
      if (
        q &&
        !item.asset.name.toLowerCase().includes(q) &&
        !item.asset.symbol.toLowerCase().includes(q)
      ) {
        continue;
      }
      out.push({ item, evalResult });
    }
    return out;
  }, [sidewaysSnapshot, assets, search, categoryFilter, marketFilter]);

  const specialBarPresetKey = showCustomSpecialRange
    ? 'custom'
    : getSpecialBarPresetKey(activeSpecialConfig);

  const special2BarPresetKey = showCustomSpecial2Range
    ? 'custom'
    : getSpecialBarPresetKey(activeSpecial2Config);

  const sidewaysBarPresetKey = showCustomSidewaysBars
    ? 'custom'
    : getSidewaysBarPresetKey(activeSidewaysConfig);

  const matchCount = useMemo(
    () =>
      rankedAssets.filter((a) => getFrozenStatus(a).status === 'MATCH').length,
    [rankedAssets, committedSnapshot]
  );
  const candidateCount = useMemo(
    () =>
      rankedAssets.filter((a) => {
        const st = getFrozenStatus(a).status;
        return st === 'MATCH' || st === 'FORMING';
      }).length,
    [rankedAssets, committedSnapshot]
  );
  const displayCountdownSec =
    candleSecondsRemaining ?? assets[0]?.secondsRemaining ?? 0;

  const renderAssetRow = (
    item: ScannedAssetState,
    idx: number,
    isMixedTable: boolean
  ) => {
    const slotIdx = selectedAssetIds.indexOf(item.asset.id);
    const isSelected = slotIdx !== -1;
    const frozenStatus = getFrozenStatus(item);
    const st = frozenStatus.status;
    const rankNum = idx + 1;
    const flowInfo =
      rankInfoByAssetId.get(item.asset.id) ?? getAssetFlowRankInfo(item, aiContext);
    const dir = flowInfo.direction ?? frozenStatus.direction;
    const bodyRatioText =
      flowInfo.avgBodyToMedianRatio > 0
        ? `${flowInfo.avgBodyToMedianRatio.toFixed(2)}x`
        : '--';
    const wickPct = Math.round(flowInfo.avgWickRatio * 100);

    return (
      <button
        key={item.asset.id}
        type="button"
        data-testid={`ranked-asset-${item.asset.id}`}
        data-flow-count={flowInfo.flowCount}
        data-counter-candles={flowInfo.counterCandles}
        data-body-ratio={flowInfo.avgBodyToMedianRatio.toFixed(2)}
        data-wick-pct={wickPct}
        onClick={() => onSelectAsset(item.asset.id, item.asset.name)}
        className={`w-full text-left px-3 py-2 transition-colors cursor-pointer grid grid-cols-[minmax(0,1fr)_52px_46px_62px] items-center gap-1.5 ${
          isSelected ? 'bg-[#152036]' : 'hover:bg-[#11192B]'
        }`}
      >
        {/* Col 1: Rank + Name + Flow Status */}
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span
              className={`text-[11px] font-mono-tabular font-bold shrink-0 ${
                st === 'MATCH' && rankNum === 1
                  ? 'text-[#16C784]'
                  : st === 'MATCH' || st === 'FORMING'
                    ? 'text-[#60A5FA]'
                    : 'text-[#64748B]'
              }`}
            >
              #{rankNum}
            </span>
            <span className="text-xs font-semibold text-[#F1F5F9] truncate">
              {item.asset.name}
            </span>
            <span className="text-[10px] text-[#64748B] shrink-0">
              {item.asset.payoutPercent}%{isSelected ? ' · ดู' : ''}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
            {st === 'MATCH' && dir && (
              <span
                className={`inline-flex items-center gap-0.5 font-medium ${
                  dir === 'UP' ? 'text-[#16C784]' : 'text-[#F45B69]'
                }`}
              >
                {dir === 'UP' ? (
                  <ArrowUpRight className="w-3 h-3 shrink-0" />
                ) : (
                  <ArrowDownRight className="w-3 h-3 shrink-0" />
                )}
                ไหล {flowInfo.flowCount} แท่ง ({dir === 'UP' ? 'ขึ้น' : 'ลง'})
              </span>
            )}
            {st === 'FORMING' && dir && (
              <span className="text-amber-400 font-medium">
                รอไหล · {flowInfo.flowCount} แท่ง ({dir === 'UP' ? 'ขึ้น' : 'ลง'})
              </span>
            )}
            {st === 'OVEREXTENDED' && (
              <span className="text-[#CBD5E1]">
                ไหล {flowInfo.flowCount} แท่ง ({dir === 'UP' ? 'ขึ้น' : 'ลง'} · เลย)
              </span>
            )}
            {st === 'NONE' && (
              <span className="text-[#94A3B8] truncate">
                {item.candles.length === 0
                  ? 'กำลังดึงแท่งเทียน...'
                  : flowInfo.flowCount >= 2 && dir
                    ? `ไหล ${flowInfo.flowCount} แท่ง (${dir === 'UP' ? 'ขึ้น' : 'ลง'})`
                    : flowInfo.flowCount === 1 && dir
                      ? `ไหล 1 แท่ง (${dir === 'UP' ? 'ขึ้น' : 'ลง'})`
                      : `รอไหล ${
                          targetMinCandles === targetMaxCandles
                            ? `${targetMinCandles}`
                            : `${targetMinCandles}–${targetMaxCandles}`
                        } แท่ง`}
              </span>
            )}
            {isMixedTable && flowInfo.counterCandles > 0 && (
              <span className="px-1 py-0.2 rounded bg-amber-500/15 border border-amber-500/35 text-[10px] font-medium text-amber-300 whitespace-nowrap">
                ต่างสี {flowInfo.counterCandles} แท่ง
              </span>
            )}
          </div>
        </div>

        {/* Col 2: Body Length (ปริมาณความยาวเนื้อกราฟ) */}
        <div
          className="text-right font-mono-tabular"
          title="ความยาวเนื้อเทียนเฉลี่ยเทียบแท่งปกติใน M15 (1.00x = สมดุล) และ % เนื้อต่อความสูงแท่ง"
        >
          <div className="text-[11px] font-semibold text-[#60A5FA]">
            {bodyRatioText}
          </div>
          <div className="text-[10px] text-[#64748B]">
            {flowInfo.avgBodyRangePct > 0 ? `${flowInfo.avgBodyRangePct}%` : '--'}
          </div>
        </div>

        {/* Col 3: Wick Amount (ปริมาณไส้เทียน) */}
        <div
          className="text-right font-mono-tabular"
          title="สัดส่วนความยาวไส้เทียนเฉลี่ย"
        >
          <div
            className={`text-[11px] font-semibold ${
              wickPct <= 20
                ? 'text-[#16C784]'
                : wickPct <= 30
                  ? 'text-amber-300'
                  : 'text-rose-300'
            }`}
          >
            {item.candles.length > 0 ? `${wickPct}%` : '--'}
          </div>
          <div className="text-[10px] text-[#64748B]">ไส้</div>
        </div>

        {/* Col 4: Match Score / AI Score / Price */}
        <div className="text-right font-mono-tabular">
          <div
            className={`text-[11px] font-bold ${
              st === 'MATCH'
                ? 'text-[#16C784]'
                : st === 'FORMING'
                  ? 'text-amber-300'
                  : 'text-[#E2E8F0]'
            }`}
          >
            {frozenStatus.matchScore}%
          </div>
          {flowInfo.aiBeautyScore !== undefined ? (
            <div className="text-[10px] text-indigo-300">
              AI {flowInfo.aiBeautyScore}%
            </div>
          ) : (
            <div className="text-[10px] text-[#94A3B8] truncate">
              {item.lastPrice > 0
                ? item.lastPrice.toFixed(Math.min(4, item.asset.decimals))
                : '--'}
            </div>
          )}
        </div>
      </button>
    );
  };

  const renderColumnHeader = () => (
    <div className="px-3 py-1.5 bg-[#0A101C] border-b border-[#162033] grid grid-cols-[minmax(0,1fr)_52px_46px_62px] gap-1.5 text-[10px] font-medium text-[#64748B]">
      <span>คู่เงิน / แท่งไหล</span>
      <span className="text-right">เนื้อกราฟ</span>
      <span className="text-right">ไส้เทียน</span>
      <span className="text-right">เกณฑ์/AI</span>
    </div>
  );

  return (
    <aside
      data-testid="ranking-sidebar"
      data-rank-epoch={committedSnapshot?.barEpoch ?? 0}
      className="w-full lg:w-[375px] xl:w-[420px] border-t lg:border-t-0 lg:border-l border-[#1D273B] bg-[#0B111E] flex flex-col shrink-0"
    >
      {/* Scanner Header */}
      <div className="p-3.5 border-b border-[#1D273B] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F8FAFC]">
            ตารางอันดับกราฟไหล ({assets.length} คู่ · M15)
          </h2>
          <span className="text-xs font-mono-tabular text-emerald-400">
            เข้าเกณฑ์ {matchCount} คู่
          </span>
        </div>

        {/* Update After Candle Close Status Bar */}
        <div className="px-2.5 py-1.5 rounded-lg bg-[#0D1422] border border-[#1E293B] flex items-center justify-between gap-2 text-[11px]">
          <span
            data-testid="rank-candle-close-countdown"
            className="text-[#CBD5E1] font-mono-tabular truncate"
          >
            อัปเดตอันดับหลังจบแท่ง · อีก {String(displayCountdownSec).padStart(2, '0')} วิ
          </span>
          <button
            type="button"
            onClick={handleManualReRank}
            aria-label="จัดอันดับตารางกราฟทันที"
            title="จัดอันดับใหม่ทันที"
            className="px-2 py-0.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#60A5FA] inline-flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>รีเฟรช</span>
          </button>
        </div>

        {/* Separated Table Switcher (3x2 grid for 6 clean non-truncating tabs) */}
        <div
          role="tablist"
          aria-label="มุมมองตารางอันดับกราฟ"
          className="grid grid-cols-3 gap-1 p-1 bg-[#0D1422] border border-[#1E293B] rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tableViewMode === 'BOTH'}
            onClick={() => setTableViewMode('BOTH')}
            className={`py-1.5 px-1 text-[10px] sm:text-[10.5px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer inline-flex items-center justify-center gap-1 min-w-0 ${
              tableViewMode === 'BOTH'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            <Layers className="w-3 h-3 shrink-0" />
            <span>แยกตาราง</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tableViewMode === 'SAME_COLOR'}
            onClick={() => setTableViewMode('SAME_COLOR')}
            className={`py-1.5 px-1 text-[10px] sm:text-[10.5px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer min-w-0 ${
              tableViewMode === 'SAME_COLOR'
                ? 'bg-[#1D2A42] text-[#16C784]'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            สีเดียว ({sameColorRows.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tableViewMode === 'MIXED_COLOR'}
            onClick={() => setTableViewMode('MIXED_COLOR')}
            className={`py-1.5 px-1 text-[10px] sm:text-[10.5px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer min-w-0 ${
              tableViewMode === 'MIXED_COLOR'
                ? 'bg-[#1D2A42] text-amber-300'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            ต่างสี ({mixedColorRows.length})
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-special-flow"
            aria-selected={tableViewMode === 'SPECIAL'}
            onClick={() => setTableViewMode('SPECIAL')}
            className={`py-1.5 px-1 text-[10px] sm:text-[10.5px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer min-w-0 ${
              tableViewMode === 'SPECIAL'
                ? 'bg-[#1D2A42] text-sky-300'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            คัดพิเศษ ({specialRows.length})
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-special-flow-2"
            aria-selected={tableViewMode === 'SPECIAL_2'}
            onClick={() => setTableViewMode('SPECIAL_2')}
            className={`py-1.5 px-1 text-[10px] sm:text-[10.5px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer min-w-0 ${
              tableViewMode === 'SPECIAL_2'
                ? 'bg-[#1D2A42] text-violet-300'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            คัดพิเศษ2 ({special2Rows.length})
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-sideways"
            aria-selected={tableViewMode === 'SIDEWAYS'}
            onClick={() => setTableViewMode('SIDEWAYS')}
            className={`py-1.5 px-1 text-[10px] sm:text-[10.5px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer min-w-0 ${
              tableViewMode === 'SIDEWAYS'
                ? 'bg-[#1D2A42] text-rose-300'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            ไซด์เวย์ ({sidewaysRows.length})
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
          <span>
            ไหลมากสุด→น้อยสุด ·{' '}
            <span className="text-[#60A5FA] font-medium">ช่อง #{activeSlotIndex + 1}</span>
          </span>
          <button
            type="button"
            onClick={() => setOnlyQualified((prev) => !prev)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
              onlyQualified
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-[#0D1422] border-[#1E293B] text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            {onlyQualified
              ? `เฉพาะเข้า/รอง (${candidateCount})`
              : `แสดงเฉพาะเข้าเกณฑ์ (${candidateCount})`}
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="ค้นหาคู่เงินหรือสินทรัพย์"
            placeholder="ค้นหา เช่น EUR/JPY, Bitcoin/Gold, USD/CAD"
            className="w-full pl-9 pr-3 py-2 text-xs bg-[#0D1422] border border-[#23304A] rounded-lg text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#3B82F6]"
          />
        </div>

        {/* OTC / Regular Market Filter */}
        <div className="flex items-center p-0.5 bg-[#0D1422] border border-[#1E293B] rounded-lg">
          {([
            { id: 'ALL', label: 'ทุกตลาด (OTC+ปกติ)' },
            { id: 'OTC', label: 'เฉพาะ OTC' },
            { id: 'REGULAR', label: 'ตลาดปกติ' },
          ] as const).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMarketFilter(m.id)}
              className={`flex-1 py-1.5 px-2 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                marketFilter === m.id
                  ? 'bg-[#1D2A42] text-[#F8FAFC]'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Category & Direction Segmented Controls */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center p-0.5 bg-[#0D1422] border border-[#1E293B] rounded-lg">
            {(['ALL', 'BINARY', 'DIGITAL'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => onChangeFilters({ categoryFilter: cat })}
                className={`flex-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                {cat === 'ALL' ? 'ทั้งหมด' : cat === 'BINARY' ? 'Binary' : 'Digital'}
              </button>
            ))}
          </div>

          <div className="flex items-center p-0.5 bg-[#0D1422] border border-[#1E293B] rounded-lg">
            {(['BOTH', 'UP', 'DOWN'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => onChangeFilters({ directionFilter: dir })}
                className={`flex-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  directionFilter === dir
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                {dir === 'BOTH' ? 'ขึ้น/ลง' : dir === 'UP' ? 'ขาขึ้น' : 'ขาลง'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tables Container */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Table 1: Original Same-Color Flowing Table */}
        {(tableViewMode === 'BOTH' || tableViewMode === 'SAME_COLOR') && (
          <section
            data-testid="table-same-color"
            aria-label="ตารางกราฟไหลสีเดียวล้วน"
            className="flex flex-col border-b border-[#1D273B]"
          >
            <div className="px-3 py-2 bg-[#0F172A] border-b border-[#1A2438] flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-[#F8FAFC]">
                  ตารางกราฟไหล (สีเดียวล้วน)
                </div>
                <div className="text-[10px] text-[#94A3B8]">
                  กราฟเดิมเรียงตัวสีเดียว มากสุด→น้อยสุด
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-[11px] font-mono-tabular font-semibold text-emerald-300">
                {sameColorRows.length} คู่
              </span>
            </div>

            {renderColumnHeader()}

            <div
              className={`divide-y divide-[#162033] overflow-y-auto ${
                tableViewMode === 'BOTH' ? 'max-h-[340px]' : 'max-h-[620px]'
              }`}
            >
              {sameColorRows.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#94A3B8]">
                  {onlyQualified
                    ? 'ยังไม่มีกราฟสีเดียวล้วนที่เข้าเงื่อนไขในขณะนี้'
                    : 'ไม่พบคู่สินทรัพย์ในตารางสีเดียว'}
                </div>
              ) : (
                sameColorRows.map((item, idx) => renderAssetRow(item, idx, false))
              )}
            </div>
          </section>
        )}

        {/* Table 2: Separated Mixed-Color Pullback Continuation Table (1-2 counter candles in 5-6 bars) */}
        {(tableViewMode === 'BOTH' || tableViewMode === 'MIXED_COLOR') && (
          <section
            data-testid="table-mixed-color"
            aria-label="ตารางแยกกราฟแท่งต่างสี 1-2 แท่ง"
            className="flex flex-col"
          >
            <div className="px-3 py-2 bg-[#13192C] border-b border-[#252D48] flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-amber-200">
                  ตารางแยกกราฟแท่งต่างสี (พักตัว 1–2 แท่ง)
                </div>
                <div className="text-[10px] text-[#94A3B8]">
                  ชุดไหล 5–6 แท่ง มีแท่งต่างสีพักตัว 1–2 แท่งแล้วไปต่อ
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-[11px] font-mono-tabular font-semibold text-amber-300">
                {mixedColorRows.length} คู่
              </span>
            </div>

            {renderColumnHeader()}

            <div
              className={`divide-y divide-[#162033] overflow-y-auto ${
                tableViewMode === 'BOTH' ? 'max-h-[280px]' : 'max-h-[620px]'
              }`}
            >
              {mixedColorRows.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#94A3B8]">
                  ยังไม่มีกราฟไหล 5–6 แท่งที่มีแท่งพักตัวต่างสี 1–2 แท่งในขณะนี้
                </div>
              ) : (
                mixedColorRows.map((item, idx) => renderAssetRow(item, idx, true))
              )}
            </div>
          </section>
        )}

        {/* Table 3: Special Curated Flow Table 1 (Spread Diff Only) */}
        {(tableViewMode === 'BOTH' || tableViewMode === 'SPECIAL') && (
          <section
            data-testid="table-special-flow"
            aria-label="ตารางคัดพิเศษเทรนด์ไหลสม่ำเสมอที่สุด"
            className="flex flex-col shrink-0 border-t border-[#1D273B]"
          >
            <div className="px-3 py-2 bg-[#101C33] border-b border-[#223354] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-sky-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span>ตารางคัดพิเศษ (เทรนด์ไหลสวยสุด)</span>
                </div>
                <div className="text-[10px] text-[#94A3B8] truncate">
                  เนื้อต่าง ≤{activeSpecialConfig.maxBodyDiffRatio.toFixed(2)}× · ไส้ต่าง ≤
                  {activeSpecialConfig.maxWickDiffRatio.toFixed(2)}× · อัปเดตหลังจบแท่ง
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/35 text-[11px] font-mono-tabular font-semibold text-sky-300 shrink-0">
                {specialRows.length} คู่
              </span>
            </div>

            {/* Special Table 1 Controls: Bar Window + Body/Wick Spread Only (0.00x - 2.00x) */}
            <div className="px-3 py-2 bg-[#0D1422] border-b border-[#1A2438] space-y-1.5 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <label
                    htmlFor="special-flow-bars-select"
                    className="text-[#94A3B8] whitespace-nowrap"
                  >
                    สแกนไหลล่าสุด:
                  </label>
                  <select
                    id="special-flow-bars-select"
                    data-testid="special-flow-bars-select"
                    aria-label="จำนวนแท่งไหลล่าสุดสำหรับตารางคัดพิเศษ"
                    value={specialBarPresetKey}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'custom') {
                        setShowCustomSpecialRange(true);
                        return;
                      }
                      setShowCustomSpecialRange(false);
                      if (v === 'range-2-4') {
                        updateSpecialConfig({ barMode: 'RANGE', minBars: 2, maxBars: 4 });
                      } else if (v === 'range-4-6') {
                        updateSpecialConfig({ barMode: 'RANGE', minBars: 4, maxBars: 6 });
                      } else if (v === 'range-5-6') {
                        updateSpecialConfig({ barMode: 'RANGE', minBars: 5, maxBars: 6 });
                      } else if (v.startsWith('fixed-')) {
                        const n = Number(v.replace('fixed-', ''));
                        updateSpecialConfig({ barMode: 'FIXED', fixedBars: n });
                      }
                    }}
                    className="bg-transparent text-sky-300 font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="range-4-6" className="bg-[#0D1422] text-[#F8FAFC]">
                      4–6 แท่ง (แนะนำ)
                    </option>
                    <option value="range-2-4" className="bg-[#0D1422] text-[#F8FAFC]">
                      2–4 แท่ง
                    </option>
                    <option value="range-5-6" className="bg-[#0D1422] text-[#F8FAFC]">
                      5–6 แท่ง
                    </option>
                    <option value="fixed-4" className="bg-[#0D1422] text-[#F8FAFC]">
                      4 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-5" className="bg-[#0D1422] text-[#F8FAFC]">
                      5 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-6" className="bg-[#0D1422] text-[#F8FAFC]">
                      6 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-7" className="bg-[#0D1422] text-[#F8FAFC]">
                      7 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-8" className="bg-[#0D1422] text-[#F8FAFC]">
                      8 แท่ง (ตายตัว)
                    </option>
                    <option value="custom" className="bg-[#0D1422] text-[#F8FAFC]">
                      กำหนดช่วงเอง...
                    </option>
                  </select>
                </div>

                {specialBarPresetKey === 'custom' && (
                  <div className="flex items-center gap-1 bg-[#0F172A] border border-[#273652] rounded-lg px-2 py-0.5 font-mono-tabular">
                    <input
                      type="number"
                      min={2}
                      max={8}
                      aria-label="จำนวนแท่งไหลต่ำสุดตารางคัดพิเศษ"
                      value={activeSpecialConfig.minBars}
                      onChange={(e) => {
                        const minV = Math.min(8, Math.max(2, Number(e.target.value) || 2));
                        updateSpecialConfig({
                          barMode: 'RANGE',
                          minBars: minV,
                          maxBars: Math.max(minV, activeSpecialConfig.maxBars),
                        });
                      }}
                      className="w-9 bg-[#0B111E] border border-[#1E293B] rounded px-1 py-0.5 text-center text-[#F8FAFC]"
                    />
                    <span className="text-[#64748B]">–</span>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      aria-label="จำนวนแท่งไหลสูงสุดตารางคัดพิเศษ"
                      value={activeSpecialConfig.maxBars}
                      onChange={(e) => {
                        const maxV = Math.min(
                          10,
                          Math.max(
                            activeSpecialConfig.minBars,
                            Number(e.target.value) || activeSpecialConfig.minBars
                          )
                        );
                        updateSpecialConfig({ barMode: 'RANGE', maxBars: maxV });
                      }}
                      className="w-9 bg-[#0B111E] border border-[#1E293B] rounded px-1 py-0.5 text-center text-[#F8FAFC]"
                    />
                  </div>
                )}
              </div>

              {/* 2 Spread Diff Controls Only (0.00x - 2.00x) */}
              <div className="grid grid-cols-2 gap-1.5 font-mono-tabular">
                <label className="flex items-center justify-between gap-1 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <span className="font-sans text-[10px] text-[#94A3B8] whitespace-nowrap">
                    เนื้อต่าง ≤
                  </span>
                  <div className="flex items-center gap-0.5">
                    <RatioNumberInput
                      testId="special-max-body-diff"
                      ariaLabel="เนื้อเทียนต่างกันไม่เกิน"
                      value={activeSpecialConfig.maxBodyDiffRatio}
                      onCommit={(val) => updateSpecialConfig({ maxBodyDiffRatio: val })}
                      className="w-12 bg-[#0B111E] border border-[#23304A] rounded px-1 py-0.5 text-right text-sky-300 font-semibold focus:outline-none focus:border-sky-400"
                    />
                    <span className="text-[10px] text-[#64748B]">×</span>
                  </div>
                </label>

                <label className="flex items-center justify-between gap-1 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <span className="font-sans text-[10px] text-[#94A3B8] whitespace-nowrap">
                    ไส้ต่าง ≤
                  </span>
                  <div className="flex items-center gap-0.5">
                    <RatioNumberInput
                      testId="special-max-wick-diff"
                      ariaLabel="ไส้เทียนต่างกันไม่เกิน"
                      value={activeSpecialConfig.maxWickDiffRatio}
                      onCommit={(val) => updateSpecialConfig({ maxWickDiffRatio: val })}
                      className="w-12 bg-[#0B111E] border border-[#23304A] rounded px-1 py-0.5 text-right text-emerald-300 font-semibold focus:outline-none focus:border-emerald-400"
                    />
                    <span className="text-[10px] text-[#64748B]">×</span>
                  </div>
                </label>
              </div>
            </div>

            {renderColumnHeader()}

            <div
              data-testid="special-pass-list"
              className={`divide-y divide-[#162033] overflow-y-auto ${
                tableViewMode === 'BOTH' ? 'max-h-[260px]' : 'max-h-[540px]'
              }`}
            >
              {specialRows.length === 0 ? (
                <div className="p-5 text-center text-xs text-[#94A3B8]">
                  ยังไม่มีคู่กราฟที่เนื้อต่าง ≤{activeSpecialConfig.maxBodyDiffRatio.toFixed(2)}×
                  และไส้ต่าง ≤{activeSpecialConfig.maxWickDiffRatio.toFixed(2)}× ในแท่งนี้
                </div>
              ) : (
                specialRows.map(({ item, evalResult }, idx) => {
                  const isSelected = selectedAssetIds.includes(item.asset.id);
                  const dir = evalResult.direction;
                  const rankNum = idx + 1;
                  return (
                    <button
                      key={`special-${item.asset.id}`}
                      type="button"
                      data-testid={`special-ranked-asset-${item.asset.id}`}
                      data-flow-count={evalResult.matchedBars}
                      data-body-diff={evalResult.bodyDiffRatio.toFixed(2)}
                      data-wick-diff={evalResult.wickDiffRatio.toFixed(2)}
                      onClick={() => onSelectAsset(item.asset.id, item.asset.name)}
                      className={`w-full text-left px-3 py-2 transition-colors cursor-pointer grid grid-cols-[minmax(0,1fr)_52px_46px_62px] items-center gap-1.5 ${
                        isSelected ? 'bg-[#152036]' : 'hover:bg-[#11192B]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[11px] font-mono-tabular font-bold shrink-0 ${
                              rankNum === 1 ? 'text-sky-300' : 'text-[#60A5FA]'
                            }`}
                          >
                            #{rankNum}
                          </span>
                          <span className="text-xs font-semibold text-[#F1F5F9] truncate">
                            {item.asset.name}
                          </span>
                          <span className="text-[10px] text-[#64748B] shrink-0">
                            {item.asset.payoutPercent}%{isSelected ? ' · ดู' : ''}
                          </span>
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                          {dir && (
                            <span
                              className={`inline-flex items-center gap-0.5 font-medium ${
                                dir === 'UP' ? 'text-[#16C784]' : 'text-[#F45B69]'
                              }`}
                            >
                              {dir === 'UP' ? (
                                <ArrowUpRight className="w-3 h-3 shrink-0" />
                              ) : (
                                <ArrowDownRight className="w-3 h-3 shrink-0" />
                              )}
                              ไหล {evalResult.matchedBars} แท่ง ({dir === 'UP' ? 'ขึ้น' : 'ลง'})
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className="text-right font-mono-tabular"
                        title={`ความต่างเนื้อเทียน ${evalResult.bodyDiffRatio.toFixed(2)}× / เฉลี่ย ${evalResult.avgBodyRatio.toFixed(2)}×`}
                      >
                        <div className="text-[11px] font-semibold text-sky-300">
                          ±{evalResult.bodyDiffRatio.toFixed(2)}×
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          เฉลี่ย {evalResult.avgBodyRatio.toFixed(2)}×
                        </div>
                      </div>

                      <div
                        className="text-right font-mono-tabular"
                        title={`ความต่างไส้เทียน ${evalResult.wickDiffRatio.toFixed(2)}× / เฉลี่ย ${evalResult.avgWickPct}%`}
                      >
                        <div className="text-[11px] font-semibold text-emerald-400">
                          ±{evalResult.wickDiffRatio.toFixed(2)}×
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          {evalResult.avgWickPct}%
                        </div>
                      </div>

                      <div className="text-right font-mono-tabular">
                        <div className="text-[11px] font-bold text-[#16C784]">
                          {evalResult.matchScore}%
                        </div>
                        {evalResult.aiBeautyScore !== undefined ? (
                          <div className="text-[10px] text-indigo-300">
                            AI {evalResult.aiBeautyScore}%
                          </div>
                        ) : (
                          <div className="text-[10px] text-[#94A3B8] truncate">
                            ≤{evalResult.maxBodyRatio.toFixed(2)}×
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {/* Table 4: Special Curated Flow Table 2 (Max Body & Wick Length Limit, Fixed/Range Bar Count) */}
        {(tableViewMode === 'BOTH' || tableViewMode === 'SPECIAL_2') && (
          <section
            data-testid="table-special-flow-2"
            aria-label="ตารางคัดพิเศษ2 ความยาวเนื้อเทียนและไส้เทียนไม่เกินที่กำหนด"
            className="flex flex-col shrink-0 border-t border-[#1D273B]"
          >
            <div className="px-3 py-2 bg-[#16132E] border-b border-[#2D2758] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-violet-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span>ตารางคัดพิเศษ2 (ความยาวเนื้อ/ไส้)</span>
                </div>
                <div className="text-[10px] text-[#94A3B8] truncate">
                  เกณฑ์โปรแกรม: เนื้อ ≤{FIXED_SPECIAL_BODY_LIMIT.toFixed(2)}× · ไส้ ≤
                  {FIXED_SPECIAL_WICK_LIMIT.toFixed(2)}× · อัปเดตหลังจบแท่ง
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/35 text-[11px] font-mono-tabular font-semibold text-violet-300 shrink-0">
                {special2Rows.length} คู่
              </span>
            </div>

            {/* Special Table 2 Controls: Bar Count Selector + Program-Fixed Criteria (1.90x Body / 0.80x Wick) */}
            <div className="px-3 py-2 bg-[#0D1422] border-b border-[#1A2438] space-y-1.5 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <label
                    htmlFor="special2-flow-bars-select"
                    className="text-[#94A3B8] whitespace-nowrap"
                  >
                    สแกนไหลล่าสุด:
                  </label>
                  <select
                    id="special2-flow-bars-select"
                    data-testid="special2-flow-bars-select"
                    aria-label="จำนวนแท่งไหลล่าสุดสำหรับตารางคัดพิเศษ2"
                    value={special2BarPresetKey}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'custom') {
                        setShowCustomSpecial2Range(true);
                        return;
                      }
                      setShowCustomSpecial2Range(false);
                      if (v === 'range-2-4') {
                        updateSpecial2Config({ barMode: 'RANGE', minBars: 2, maxBars: 4 });
                      } else if (v === 'range-4-6') {
                        updateSpecial2Config({ barMode: 'RANGE', minBars: 4, maxBars: 6 });
                      } else if (v === 'range-5-6') {
                        updateSpecial2Config({ barMode: 'RANGE', minBars: 5, maxBars: 6 });
                      } else if (v.startsWith('fixed-')) {
                        const n = Number(v.replace('fixed-', ''));
                        updateSpecial2Config({ barMode: 'FIXED', fixedBars: n });
                      }
                    }}
                    className="bg-transparent text-violet-300 font-semibold focus:outline-none cursor-pointer"
                  >
                    <option value="fixed-3" className="bg-[#0D1422] text-[#F8FAFC]">
                      3 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-4" className="bg-[#0D1422] text-[#F8FAFC]">
                      4 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-5" className="bg-[#0D1422] text-[#F8FAFC]">
                      5 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-6" className="bg-[#0D1422] text-[#F8FAFC]">
                      6 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-7" className="bg-[#0D1422] text-[#F8FAFC]">
                      7 แท่ง (ตายตัว)
                    </option>
                    <option value="fixed-8" className="bg-[#0D1422] text-[#F8FAFC]">
                      8 แท่ง (ตายตัว)
                    </option>
                    <option value="range-4-6" className="bg-[#0D1422] text-[#F8FAFC]">
                      4–6 แท่ง
                    </option>
                    <option value="range-2-4" className="bg-[#0D1422] text-[#F8FAFC]">
                      2–4 แท่ง
                    </option>
                    <option value="range-5-6" className="bg-[#0D1422] text-[#F8FAFC]">
                      5–6 แท่ง
                    </option>
                    <option value="custom" className="bg-[#0D1422] text-[#F8FAFC]">
                      กำหนดช่วงเอง...
                    </option>
                  </select>
                </div>

                {special2BarPresetKey === 'custom' && (
                  <div className="flex items-center gap-1 bg-[#0F172A] border border-[#273652] rounded-lg px-2 py-0.5 font-mono-tabular">
                    <input
                      type="number"
                      min={2}
                      max={8}
                      aria-label="จำนวนแท่งไหลต่ำสุดตารางคัดพิเศษ2"
                      value={activeSpecial2Config.minBars}
                      onChange={(e) => {
                        const minV = Math.min(8, Math.max(2, Number(e.target.value) || 2));
                        updateSpecial2Config({
                          barMode: 'RANGE',
                          minBars: minV,
                          maxBars: Math.max(minV, activeSpecial2Config.maxBars),
                        });
                      }}
                      className="w-9 bg-[#0B111E] border border-[#1E293B] rounded px-1 py-0.5 text-center text-[#F8FAFC]"
                    />
                    <span className="text-[#64748B]">–</span>
                    <input
                      type="number"
                      min={2}
                      max={10}
                      aria-label="จำนวนแท่งไหลสูงสุดตารางคัดพิเศษ2"
                      value={activeSpecial2Config.maxBars}
                      onChange={(e) => {
                        const maxV = Math.min(
                          10,
                          Math.max(
                            activeSpecial2Config.minBars,
                            Number(e.target.value) || activeSpecial2Config.minBars
                          )
                        );
                        updateSpecial2Config({ barMode: 'RANGE', maxBars: maxV });
                      }}
                      className="w-9 bg-[#0B111E] border border-[#1E293B] rounded px-1 py-0.5 text-center text-[#F8FAFC]"
                    />
                  </div>
                )}
              </div>

              {/* Fixed Program Criteria Strip (No User Input) */}
              <div
                data-testid="special2-fixed-criteria"
                className="grid grid-cols-2 gap-1.5 font-mono-tabular text-[10.5px]"
              >
                <div className="flex items-center justify-between gap-1 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <span className="font-sans text-[10px] text-[#94A3B8] whitespace-nowrap">
                    เนื้อไม่เกิน (เฉพาะระบบ)
                  </span>
                  <span className="text-violet-300 font-semibold">
                    {FIXED_SPECIAL_BODY_LIMIT.toFixed(2)}×
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <span className="font-sans text-[10px] text-[#94A3B8] whitespace-nowrap">
                    ไส้ไม่เกิน (เฉพาะระบบ)
                  </span>
                  <span className="text-emerald-300 font-semibold">
                    {FIXED_SPECIAL_WICK_LIMIT.toFixed(2)}×
                  </span>
                </div>
              </div>
            </div>

            {renderColumnHeader()}

            <div
              data-testid="special2-pass-list"
              className={`divide-y divide-[#162033] overflow-y-auto ${
                tableViewMode === 'BOTH' ? 'max-h-[260px]' : 'max-h-[540px]'
              }`}
            >
              {special2Rows.length === 0 ? (
                <div className="p-5 text-center text-xs text-[#94A3B8]">
                  ยังไม่มีคู่กราฟสีเดียวที่ความยาวเนื้อ ≤{FIXED_SPECIAL_BODY_LIMIT.toFixed(2)}×
                  และไส้ ≤{FIXED_SPECIAL_WICK_LIMIT.toFixed(2)}× ในแท่งนี้
                </div>
              ) : (
                special2Rows.map(({ item, evalResult }, idx) => {
                  const isSelected = selectedAssetIds.includes(item.asset.id);
                  const dir = evalResult.direction;
                  const rankNum = idx + 1;
                  return (
                    <button
                      key={`special2-${item.asset.id}`}
                      type="button"
                      data-testid={`special2-ranked-asset-${item.asset.id}`}
                      data-flow-count={evalResult.matchedBars}
                      data-max-body={evalResult.maxBodyRatio.toFixed(2)}
                      data-max-wick={evalResult.maxWickRatio.toFixed(2)}
                      onClick={() => onSelectAsset(item.asset.id, item.asset.name)}
                      className={`w-full text-left px-3 py-2 transition-colors cursor-pointer grid grid-cols-[minmax(0,1fr)_52px_46px_62px] items-center gap-1.5 ${
                        isSelected ? 'bg-[#152036]' : 'hover:bg-[#11192B]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[11px] font-mono-tabular font-bold shrink-0 ${
                              rankNum === 1 ? 'text-violet-300' : 'text-[#60A5FA]'
                            }`}
                          >
                            #{rankNum}
                          </span>
                          <span className="text-xs font-semibold text-[#F1F5F9] truncate">
                            {item.asset.name}
                          </span>
                          <span className="text-[10px] text-[#64748B] shrink-0">
                            {item.asset.payoutPercent}%{isSelected ? ' · ดู' : ''}
                          </span>
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                          {dir && (
                            <span
                              className={`inline-flex items-center gap-0.5 font-medium ${
                                dir === 'UP' ? 'text-[#16C784]' : 'text-[#F45B69]'
                              }`}
                            >
                              {dir === 'UP' ? (
                                <ArrowUpRight className="w-3 h-3 shrink-0" />
                              ) : (
                                <ArrowDownRight className="w-3 h-3 shrink-0" />
                              )}
                              ไหล {evalResult.matchedBars} แท่ง ({dir === 'UP' ? 'ขึ้น' : 'ลง'})
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className="text-right font-mono-tabular"
                        title={`เนื้อเทียนสูงสุด ${evalResult.maxBodyRatio.toFixed(2)}× / เฉลี่ย ${evalResult.avgBodyRatio.toFixed(2)}×`}
                      >
                        <div className="text-[11px] font-semibold text-violet-300">
                          ≤{evalResult.maxBodyRatio.toFixed(2)}×
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          เฉลี่ย {evalResult.avgBodyRatio.toFixed(2)}×
                        </div>
                      </div>

                      <div
                        className="text-right font-mono-tabular"
                        title={`ไส้เทียนสูงสุด ${evalResult.maxWickRatio.toFixed(2)}× / เฉลี่ย ${evalResult.avgWickPct}%`}
                      >
                        <div className="text-[11px] font-semibold text-emerald-400">
                          ≤{evalResult.maxWickRatio.toFixed(2)}×
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          {evalResult.avgWickPct}%
                        </div>
                      </div>

                      <div className="text-right font-mono-tabular">
                        <div className="text-[11px] font-bold text-[#16C784]">
                          {evalResult.matchScore}%
                        </div>
                        {evalResult.aiBeautyScore !== undefined ? (
                          <div className="text-[10px] text-indigo-300">
                            AI {evalResult.aiBeautyScore}%
                          </div>
                        ) : (
                          <div className="text-[10px] text-[#94A3B8] truncate">
                            ไส้ {evalResult.avgWickRatio.toFixed(2)}×
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}

        {/* Table 5: Sideways Table (Big Bodies >= 2.50x across N bars, color-agnostic & wick-agnostic) */}
        {(tableViewMode === 'BOTH' || tableViewMode === 'SIDEWAYS') && (
          <section
            data-testid="table-sideways"
            aria-label="ตารางไซด์เวย์ เนื้อเทียนยาว 2.50 เท่าขึ้นไป"
            className="flex flex-col shrink-0 border-t border-[#1D273B]"
          >
            <div className="px-3 py-2 bg-[#231320] border-b border-[#45203C] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-rose-200 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>ตารางไซด์เวย์ (แท่งใหญ่ ≥2.50×)</span>
                </div>
                <div className="text-[10px] text-[#94A3B8] truncate">
                  ไม่สนสลับสี · ไม่สนไส้เทียน · อัปเดตหลังจบแท่ง
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/35 text-[11px] font-mono-tabular font-semibold text-rose-300 shrink-0">
                {sidewaysRows.length} คู่
              </span>
            </div>

            {/* Sideways Controls: User-Configurable Bar Count (8..15 + custom) + Fixed Criteria (>=2.50x) */}
            <div className="px-3 py-2 bg-[#0D1422] border-b border-[#1A2438] space-y-1.5 text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <label
                    htmlFor="sideways-bars-select"
                    className="text-[#94A3B8] whitespace-nowrap"
                  >
                    สแกนแท่งล่าสุด:
                  </label>
                  <select
                    id="sideways-bars-select"
                    data-testid="sideways-bars-select"
                    aria-label="จำนวนแท่งล่าสุดสำหรับตารางไซด์เวย์"
                    value={sidewaysBarPresetKey}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'custom') {
                        setShowCustomSidewaysBars(true);
                        return;
                      }
                      setShowCustomSidewaysBars(false);
                      if (v.startsWith('fixed-')) {
                        const n = Number(v.replace('fixed-', ''));
                        updateSidewaysConfig({ barMode: 'FIXED', fixedBars: n });
                      }
                    }}
                    className="bg-transparent text-rose-300 font-semibold focus:outline-none cursor-pointer"
                  >
                    {[8, 9, 10, 11, 12, 13, 14, 15].map((n) => (
                      <option
                        key={`sideways-opt-${n}`}
                        value={`fixed-${n}`}
                        className="bg-[#0D1422] text-[#F8FAFC]"
                      >
                        {n} แท่ง (ล่าสุด)
                      </option>
                    ))}
                    <option value="custom" className="bg-[#0D1422] text-[#F8FAFC]">
                      กำหนดเอง...
                    </option>
                  </select>
                </div>

                {sidewaysBarPresetKey === 'custom' && (
                  <div className="flex items-center gap-1 bg-[#0F172A] border border-[#273652] rounded-lg px-2 py-0.5 font-mono-tabular">
                    <input
                      type="number"
                      min={4}
                      max={20}
                      data-testid="sideways-custom-bars-input"
                      aria-label="กำหนดจำนวนแท่งล่าสุดตารางไซด์เวย์"
                      value={activeSidewaysConfig.fixedBars}
                      onChange={(e) => {
                        const n = Math.min(20, Math.max(4, Number(e.target.value) || 8));
                        updateSidewaysConfig({ barMode: 'FIXED', fixedBars: n });
                      }}
                      className="w-11 bg-[#0B111E] border border-[#1E293B] rounded px-1 py-0.5 text-center text-[#F8FAFC]"
                    />
                    <span className="text-[10px] text-[#94A3B8]">แท่ง</span>
                  </div>
                )}
              </div>

              {/* Fixed Sideways Criteria Strip (No User Threshold Input) */}
              <div
                data-testid="sideways-fixed-criteria"
                className="grid grid-cols-2 gap-1.5 font-mono-tabular text-[10.5px]"
              >
                <div className="flex items-center justify-between gap-1 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <span className="font-sans text-[10px] text-[#94A3B8] whitespace-nowrap">
                    เนื้อเทียน (ระบบ)
                  </span>
                  <span className="text-rose-300 font-semibold">
                    ≥ {FIXED_SIDEWAYS_MIN_BODY_RATIO.toFixed(2)}×
                  </span>
                </div>
                <div className="flex items-center justify-between gap-1 bg-[#0F172A] border border-[#1E293B] rounded-lg px-2 py-1">
                  <span className="font-sans text-[10px] text-[#94A3B8] whitespace-nowrap">
                    สลับสี / ไส้เทียน
                  </span>
                  <span className="text-emerald-300 font-semibold">ไม่จำกัด</span>
                </div>
              </div>
            </div>

            <div className="px-3 py-1.5 bg-[#0A101C] border-b border-[#162033] grid grid-cols-[minmax(0,1fr)_56px_64px_54px] gap-1.5 text-[10px] font-medium text-[#64748B]">
              <span>คู่เงิน / จำนวนแท่ง</span>
              <span className="text-right">เนื้อต่ำสุด</span>
              <span className="text-right">เฉลี่ย/สูงสุด</span>
              <span className="text-right">สลับสี</span>
            </div>

            <div
              data-testid="sideways-pass-list"
              className={`divide-y divide-[#162033] overflow-y-auto ${
                tableViewMode === 'BOTH' ? 'max-h-[260px]' : 'max-h-[540px]'
              }`}
            >
              {sidewaysRows.length === 0 ? (
                <div className="p-5 text-center text-xs text-[#94A3B8]">
                  ยังไม่มีคู่กราฟที่มีแท่งเนื้อเทียน ≥{FIXED_SIDEWAYS_MIN_BODY_RATIO.toFixed(2)}×
                  ครบ {activeSidewaysConfig.fixedBars} แท่งล่าสุดในรอบแท่งนี้
                </div>
              ) : (
                sidewaysRows.map(({ item, evalResult }, idx) => {
                  const isSelected = selectedAssetIds.includes(item.asset.id);
                  const rankNum = idx + 1;
                  return (
                    <button
                      key={`sideways-${item.asset.id}`}
                      type="button"
                      data-testid={`sideways-ranked-asset-${item.asset.id}`}
                      data-matched-bars={evalResult.matchedBars}
                      data-min-body={evalResult.minBodyRatio.toFixed(2)}
                      data-alternations={evalResult.colorAlternations}
                      onClick={() => onSelectAsset(item.asset.id, item.asset.name)}
                      className={`w-full text-left px-3 py-2 transition-colors cursor-pointer grid grid-cols-[minmax(0,1fr)_56px_64px_54px] items-center gap-1.5 ${
                        isSelected ? 'bg-[#152036]' : 'hover:bg-[#11192B]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[11px] font-mono-tabular font-bold shrink-0 ${
                              rankNum === 1 ? 'text-rose-300' : 'text-[#60A5FA]'
                            }`}
                          >
                            #{rankNum}
                          </span>
                          <span className="text-xs font-semibold text-[#F1F5F9] truncate">
                            {item.asset.name}
                          </span>
                          <span className="text-[10px] text-[#64748B] shrink-0">
                            {item.asset.payoutPercent}%{isSelected ? ' · ดู' : ''}
                          </span>
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="text-rose-300 font-medium">
                            ไซด์เวย์ {evalResult.matchedBars} แท่ง
                          </span>
                          <span className="text-[10px] text-[#94A3B8]">
                            (เขียว {evalResult.upCount} / แดง {evalResult.downCount})
                          </span>
                        </div>
                      </div>

                      <div
                        className="text-right font-mono-tabular"
                        title={`ความยาวเนื้อเทียนต่ำสุดในชุด ${evalResult.minBodyRatio.toFixed(2)}×`}
                      >
                        <div className="text-[11px] font-semibold text-rose-300">
                          ≥{evalResult.minBodyRatio.toFixed(2)}×
                        </div>
                        <div className="text-[10px] text-[#64748B]">ขั้นต่ำ</div>
                      </div>

                      <div
                        className="text-right font-mono-tabular"
                        title={`เฉลี่ย ${evalResult.avgBodyRatio.toFixed(2)}× / สูงสุด ${evalResult.maxBodyRatio.toFixed(2)}×`}
                      >
                        <div className="text-[11px] font-semibold text-[#E2E8F0]">
                          {evalResult.avgBodyRatio.toFixed(2)}×
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          สูงสุด {evalResult.maxBodyRatio.toFixed(2)}×
                        </div>
                      </div>

                      <div className="text-right font-mono-tabular">
                        <div className="text-[11px] font-semibold text-emerald-300">
                          {evalResult.colorAlternations} สลับ
                        </div>
                        <div className="text-[10px] text-[#64748B]">
                          {item.lastPrice > 0
                            ? item.lastPrice.toFixed(Math.min(3, item.asset.decimals))
                            : '--'}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
};
