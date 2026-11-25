import React, { useEffect, useState } from 'react';

export type ActiveTab = 'scanner' | 'alerts' | 'settings';

interface HeaderBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  unacknowledgedCount: number;
  onLogout: () => void;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  onSelectTab,
  unacknowledgedCount,
  onLogout,
}) => {
  const [clockText, setClockText] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockText(formatClock(new Date()));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="border-b border-[#1D273B] bg-[#0B111E] px-4 lg:px-6 shrink-0">
      <div className="min-h-14 flex flex-wrap md:flex-nowrap items-center justify-between gap-x-4 md:gap-8 py-2 md:py-0">
        {/* Zone 1: Brand Wordmark + Live Clock */}
        <div className="flex items-center gap-4 shrink-0">
          <a
            href="#scanner"
            onClick={(e) => {
              e.preventDefault();
              onSelectTab('scanner');
            }}
            className="text-base md:text-lg font-bold tracking-tight text-[#60A5FA] whitespace-nowrap shrink-0"
          >
            โปรแกรมช่วยหากราฟ FlowTrend
          </a>
          <span className="hidden sm:inline-block font-mono-tabular text-base font-bold text-[#F8FAFC]">
            {clockText}
          </span>
        </div>

        {/* Zone 2: Single-line navigation tabs */}
        <nav
          aria-label="เมนูหลัก"
          className="order-3 md:order-2 w-full md:w-auto flex items-center justify-between md:justify-center gap-4 md:gap-6 border-t md:border-t-0 border-[#1A2438] mt-2 md:mt-0 pt-1 md:pt-0"
        >
          <button
            type="button"
            onClick={() => onSelectTab('scanner')}
            className={`py-2 md:py-4 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'scanner'
                ? 'border-[#3B82F6] text-[#F8FAFC]'
                : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            ตัวสแกนสด 1 นาที
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('alerts')}
            className={`py-2 md:py-4 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'alerts'
                ? 'border-[#3B82F6] text-[#F8FAFC]'
                : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            ประวัติแจ้งเตือน
            {unacknowledgedCount > 0 ? ` (${unacknowledgedCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('settings')}
            className={`py-2 md:py-4 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'settings'
                ? 'border-[#3B82F6] text-[#F8FAFC]'
                : 'border-transparent text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            ตั้งค่าเงื่อนไข
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="order-2 md:order-3 flex items-center shrink-0">
          <button
            type="button"
            onClick={onLogout}
            className="px-3.5 md:px-4 py-1.5 text-xs font-medium text-[#E2E8F0] bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </header>
  );
};
