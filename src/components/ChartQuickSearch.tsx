import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Search, Sparkles, X } from 'lucide-react';
import { ScannedAssetState } from '../lib/types';

interface ChartQuickSearchProps {
  assets: ScannedAssetState[];
  activeAssetId?: string;
  onSelectAsset: (assetId: string, assetName?: string) => void;
}

function normalizeQuery(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9ก-ฮ]/g, '');
}

export const ChartQuickSearch: React.FC<ChartQuickSearchProps> = ({
  assets,
  activeAssetId,
  onSelectAsset,
}) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const matches = useMemo(() => {
    const raw = query.trim().toLowerCase();
    const normQ = normalizeQuery(query);
    if (!raw) return [];

    const scored: Array<{ item: ScannedAssetState; relevance: number }> = [];
    for (const item of assets) {
      const nameLower = item.asset.name.toLowerCase();
      const symbolLower = item.asset.symbol.toLowerCase();
      const nameNorm = normalizeQuery(item.asset.name);
      const symbolNorm = normalizeQuery(item.asset.symbol);

      let relevance = -1;
      if (nameLower === raw || symbolLower === raw || nameNorm === normQ) {
        relevance = 100;
      } else if (
        nameLower.startsWith(raw) ||
        symbolLower.startsWith(raw) ||
        (normQ.length >= 2 && nameNorm.startsWith(normQ))
      ) {
        relevance = 80;
      } else if (
        nameLower.includes(raw) ||
        symbolLower.includes(raw) ||
        (normQ.length >= 2 && (nameNorm.includes(normQ) || symbolNorm.includes(normQ)))
      ) {
        relevance = 60;
      }

      if (relevance > 0) {
        scored.push({
          item,
          relevance: relevance + item.analysis.matchScore * 0.1,
        });
      }
    }

    return scored
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10)
      .map((s) => s.item);
  }, [assets, query]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  const handleChoose = (item: ScannedAssetState) => {
    onSelectAsset(item.asset.id, item.asset.name);
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (matches.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightIndex((prev) => (prev + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHighlightIndex((prev) => (prev - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = matches[highlightIndex] ?? matches[0];
      if (target) {
        handleChoose(target);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[#60A5FA] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            aria-label="พิมพ์ชื่อหากราฟเพื่อเปิดดูและสอน AI"
            placeholder="พิมพ์ชื่อหากราฟเพื่อเปิดดู & สอน AI (เช่น EUR/USD, USD/JPY, Bitcoin, Apple)..."
            className="w-full pl-9 pr-9 py-1.5 sm:py-2 text-xs sm:text-sm bg-[#090E1A] border border-[#23304A] focus:border-[#3B82F6] rounded-lg text-[#F8FAFC] placeholder-[#64748B] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setOpen(false);
              }}
              aria-label="ล้างคำค้นหากราฟ"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[#1E293B] text-[#94A3B8] hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {matches.length > 0 && (
          <button
            type="button"
            onClick={() => handleChoose(matches[0])}
            className="px-3 py-1.5 sm:py-2 rounded-lg bg-[#2563EB] hover:bg-[#3B82F6] text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            เปิดกราฟนี้
          </button>
        )}
      </div>

      {open && query.trim().length > 0 && (
        <div
          role="listbox"
          aria-label="ผลการค้นหากราฟ"
          className="absolute left-0 right-0 top-full mt-1.5 z-40 rounded-xl border border-[#273652] bg-[#0B111E] shadow-2xl overflow-hidden max-h-[320px] overflow-y-auto divide-y divide-[#162033]"
        >
          {matches.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[#94A3B8]">
              ไม่พบกราฟชื่อ &quot;{query}&quot; ในรายการสินทรัพย์ตอนนี้
            </div>
          ) : (
            matches.map((item, idx) => {
              const isHighlighted = idx === highlightIndex;
              const isCurrent = item.asset.id === activeAssetId;
              const dir = item.analysis.direction;
              const st = item.analysis.status;

              return (
                <button
                  key={item.asset.id}
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  onClick={() => handleChoose(item)}
                  className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isHighlighted
                      ? 'bg-[#16233B]'
                      : 'hover:bg-[#11192B]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-semibold text-[#F8FAFC] truncate">
                        {item.asset.name}
                      </span>
                      <span className="text-[11px] text-[#94A3B8] shrink-0">
                        {item.asset.category === 'BINARY' ? 'Binary' : 'Digital'} · {item.asset.payoutPercent}%
                      </span>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded bg-[#2563EB]/20 text-[10px] text-[#60A5FA] font-medium">
                          กำลังดู
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#94A3B8]">
                      {dir ? (
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            dir === 'UP' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {dir === 'UP' ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          {dir === 'UP' ? 'ไหลขาขึ้น (CALL)' : 'ไหลขาลง (PUT)'}
                        </span>
                      ) : (
                        <span>ยังไม่มีเทรนด์ไหลชัดเจน</span>
                      )}
                      {st === 'MATCH' && (
                        <span className="inline-flex items-center gap-1 text-emerald-300 font-medium">
                          <Sparkles className="w-3 h-3" />
                          เข้าเกณฑ์
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right font-mono-tabular shrink-0">
                    <div
                      className={`text-xs font-bold ${
                        st === 'MATCH'
                          ? 'text-[#16C784]'
                          : st === 'FORMING'
                            ? 'text-amber-300'
                            : 'text-[#CBD5E1]'
                      }`}
                    >
                      {item.analysis.matchScore}%
                    </div>
                    <div className="text-[11px] text-[#64748B]">
                      กดเพื่อเปิด &amp; สอน AI
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
