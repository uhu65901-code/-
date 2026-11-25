import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Search } from 'lucide-react';
import { AssetCategory, ScannedAssetState, TrendDirection } from '../lib/types';

interface ScannerSidebarProps {
  assets: ScannedAssetState[];
  selectedAssetIds: string[];
  activeSlotIndex: number;
  onSelectAsset: (assetId: string) => void;
  categoryFilter: 'ALL' | AssetCategory;
  directionFilter: 'BOTH' | TrendDirection;
  onChangeFilters: (patch: {
    categoryFilter?: 'ALL' | AssetCategory;
    directionFilter?: 'BOTH' | TrendDirection;
  }) => void;
}

export const ScannerSidebar: React.FC<ScannerSidebarProps> = ({
  assets,
  selectedAssetIds,
  activeSlotIndex,
  onSelectAsset,
  categoryFilter,
  directionFilter,
  onChangeFilters,
}) => {
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'OTC' | 'REGULAR'>('ALL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((item) => {
      if (categoryFilter !== 'ALL' && item.asset.category !== categoryFilter) {
        return false;
      }
      if (marketFilter === 'OTC' && !item.asset.isOtc) {
        return false;
      }
      if (marketFilter === 'REGULAR' && item.asset.isOtc) {
        return false;
      }
      if (
        directionFilter !== 'BOTH' &&
        item.analysis.direction &&
        item.analysis.direction !== directionFilter
      ) {
        if (item.analysis.status === 'MATCH' || item.analysis.status === 'FORMING') {
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
  }, [assets, categoryFilter, directionFilter, marketFilter, search]);

  const matchCount = assets.filter((a) => a.analysis.status === 'MATCH').length;

  return (
    <aside className="w-full lg:w-[350px] xl:w-[380px] border-t lg:border-t-0 lg:border-l border-[#1D273B] bg-[#0B111E] flex flex-col shrink-0">
      {/* Scanner Filter Header */}
      <div className="p-3.5 border-b border-[#1D273B] space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#F8FAFC]">
            สแกนทั้งหมด ({assets.length} คู่ · 1m)
          </h2>
          <span className="text-xs font-mono-tabular text-emerald-400">
            พบสัญญาณ {matchCount} คู่
          </span>
        </div>

        <div className="text-[11px] text-[#94A3B8]">
          คลิกเลือกคู่เงินเพื่อนำไปแสดงใน <span className="text-[#60A5FA] font-medium">กราฟช่อง #{activeSlotIndex + 1}</span>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="ค้นหาคู่เงินหรือสินทรัพย์"
            placeholder="ค้นหา เช่น SATSUSD-OTC, NZDCAD, Bitcoin/Gold"
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

      {/* Asset List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#162033] max-h-[680px]">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#94A3B8]">
            ไม่พบคู่สินทรัพย์ที่ตรงกับตัวกรอง
          </div>
        ) : (
          filtered.map((item) => {
            const slotIdx = selectedAssetIds.indexOf(item.asset.id);
            const isSelected = slotIdx !== -1;
            const st = item.analysis.status;
            const dir = item.analysis.direction;

            return (
              <button
                key={item.asset.id}
                type="button"
                onClick={() => onSelectAsset(item.asset.id)}
                className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer flex items-center justify-between gap-2.5 ${
                  isSelected
                    ? 'bg-[#152036]'
                    : 'hover:bg-[#11192B]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#F1F5F9] truncate">
                      {item.asset.name}
                    </span>
                    <span className="text-[11px] text-[#64748B] shrink-0">
                      {item.asset.category === 'BINARY' ? 'Binary' : 'Digital'} · {item.asset.payoutPercent}%
                      {isSelected ? ` · ช่อง #${slotIdx + 1}` : ''}
                    </span>
                  </div>

                  <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                    {st === 'MATCH' && dir && (
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          dir === 'UP' ? 'text-[#16C784]' : 'text-[#F45B69]'
                        }`}
                      >
                        {dir === 'UP' ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                        เข้าเงื่อนไข {item.analysis.runLength} แท่ง ({dir === 'UP' ? 'CALL' : 'PUT'})
                      </span>
                    )}
                    {st === 'FORMING' && dir && (
                      <span className="text-amber-400 font-medium">
                        กำลังก่อตัว {item.analysis.runLength} แท่ง ({dir === 'UP' ? 'ขึ้น' : 'ลง'})
                      </span>
                    )}
                    {st === 'OVEREXTENDED' && (
                      <span className="text-[#94A3B8]">
                        เลยระยะ ({item.analysis.runLength} แท่งแล้ว)
                      </span>
                    )}
                    {st === 'NONE' && (
                      <span className="text-[#64748B] truncate">
                        รอเทรนด์ไหล 5–6 แท่ง
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0 font-mono-tabular">
                  <div className="text-xs font-semibold text-[#E2E8F0]">
                    {item.lastPrice.toFixed(item.asset.decimals)}
                  </div>
                  {st === 'MATCH' || st === 'FORMING' ? (
                    <div className="mt-0.5 text-[11px] text-[#94A3B8]">
                      ไส้ {(item.analysis.avgWickRatio * 100).toFixed(0)}% · {item.analysis.uniformityScore}%
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[11px] text-[#64748B]">1m</div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
};
