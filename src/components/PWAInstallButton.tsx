import React, { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface PWAInstallButtonProps {
  compact?: boolean;
  onOpenInstallGuide?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  onOpenInstallGuide,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="px-3 py-1.5 rounded-lg bg-[#16C784] hover:bg-emerald-500 text-[#052E16] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{compact ? 'ติดตั้งแอปลงเครื่อง' : 'ติดตั้งเป็นแอปลงเครื่อง (Android / PC)'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="px-3 py-1.5 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#E2E8F0] text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#60A5FA]" />
          <span>ติดตั้งบน iPhone</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-sm rounded-xl border border-[#23304A] bg-[#0D1422] p-5 text-[#E6ECF5] shadow-xl">
              <h3 className="text-base font-semibold text-[#F8FAFC]">
                ติดตั้ง FlowTrend IQ บน iOS / iPadOS
              </h3>
              <p className="mt-2.5 text-xs leading-relaxed text-[#94A3B8]">
                1. แตะปุ่ม <strong className="text-[#E2E8F0]">Share (แชร์)</strong> ที่แถบเครื่องมือ Safari
                <br />
                2. เลื่อนลงแล้วแตะ <strong className="text-[#E2E8F0]">Add to Home Screen (เพิ่มไปยังหน้าจอโฮม)</strong>
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-lg bg-[#2563EB] hover:bg-[#3B82F6] py-2 text-xs font-semibold text-white cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if (onOpenInstallGuide) {
    return (
      <button
        type="button"
        onClick={onOpenInstallGuide}
        className="px-3 py-1.5 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-xs font-medium text-[#60A5FA] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{compact ? 'ติดตั้ง / ดาวน์โหลด' : 'ติดตั้งมือถือ & PC'}</span>
      </button>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
    >
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      <span>ออฟไลน์ — กำลังใช้ข้อมูลแคชล่าสุด รอการเชื่อมต่อใหม่</span>
    </div>
  );
};
