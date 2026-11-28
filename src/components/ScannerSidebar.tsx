import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Layers, RefreshCw, Search } from 'lucide-react';
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
  AiPatternModel,
  AssetCategory,
  PatternFeedbackSample,
  ScannedAssetState,
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
  onChangeFilters: (patch: {
    categoryFilter?: 'ALL' | AssetCategory;
    directionFilter?: 'BOTH' | TrendDirection;
  }) => void;
}

type TableViewMode = 'BOTH' | 'SAME_COLOR' | 'MIXED_COLOR';

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
  onChangeFilters,
}) => {
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'OTC' | 'REGULAR'>('ALL');
  const [onlyQualified, setOnlyQualified] = useState(false);
  const [tableViewMode, setTableViewMode] = useState<TableViewMode>('BOTH');

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
      setCommittedSnapshot(null);
      return;
    }

    const nextSnapshot = buildCommittedRankSnapshot(
      assets,
      aiContextRef.current,
      decision.targetEpoch > 0 ? decision.targetEpoch : undefined
    );
    snapshotRef.current = nextSnapshot;
    setCommittedSnapshot(nextSnapshot);
  }, [assets]);

  const handleManualReRank = () => {
    pendingEpochRef.current = null;
    if (latestAssetsRef.current.length === 0) return;
    const nextSnapshot = buildCommittedRankSnapshot(
      latestAssetsRef.current,
      aiContextRef.current
    );
    snapshotRef.current = nextSnapshot;
    setCommittedSnapshot(nextSnapshot);
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

        {/* Separated Table Switcher */}
        <div
          role="tablist"
          aria-label="มุมมองตารางอันดับกราฟ"
          className="flex items-center p-0.5 bg-[#0D1422] border border-[#1E293B] rounded-lg"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tableViewMode === 'BOTH'}
            onClick={() => setTableViewMode('BOTH')}
            className={`flex-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer inline-flex items-center justify-center gap-1 ${
              tableViewMode === 'BOTH'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            <Layers className="w-3 h-3 shrink-0" />
            <span>แยก 2 ตาราง</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tableViewMode === 'SAME_COLOR'}
            onClick={() => setTableViewMode('SAME_COLOR')}
            className={`flex-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
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
            className={`flex-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              tableViewMode === 'MIXED_COLOR'
                ? 'bg-[#1D2A42] text-amber-300'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            ต่างสี ({mixedColorRows.length})
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
      </div>
    </aside>
  );
};
