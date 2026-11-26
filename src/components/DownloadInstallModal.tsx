import React from 'react';
import { CheckCircle2, Download, Monitor, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface DownloadInstallModalProps {
  open: boolean;
  onClose: () => void;
}

export const DownloadInstallModal: React.FC<DownloadInstallModalProps> = ({
  open,
  onClose,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-[#23304A] bg-[#0D1422] text-[#E6ECF5] shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1D273B] bg-[#0B111E] flex items-center justify-between gap-4">
          <div>
            <h2 id="download-modal-title" className="text-base font-bold text-[#F8FAFC]">
              ดาวน์โหลด &amp; ติดตั้งแอป (PC และ Android)
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              โปรแกรมสำเร็จรูปพร้อมใช้งาน (ไม่มีซอร์สโค้ด) ทำงานอิสระในเครื่อง ไม่ต้องพึ่ง AI Studio
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างดาวน์โหลด"
            className="p-1.5 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Android Card */}
          <div className="rounded-xl border border-[#1E293B] bg-[#0B111E] p-4 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/15 text-[#16C784]">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">
                    มือถือ Android
                  </h3>
                  <p className="text-[11px] text-[#94A3B8]">
                    ติดตั้งไอคอนลงหน้าจอ เปิดใช้งานเต็มจอทันที
                  </p>
                </div>
              </div>

              <ol className="space-y-2 text-xs text-[#CBD5E1] leading-relaxed list-decimal list-inside">
                <li>
                  <strong className="text-white">วิธีที่ 1 (แนะนำ):</strong>{' '}
                  {isInstalled
                    ? 'ติดตั้งไอคอนแอป FlowTrendIQ ลงบนเครื่องเรียบร้อยแล้ว'
                    : isInstallable
                      ? 'กดปุ่มสีเขียวด้านล่างเพื่อสร้างไอคอน FlowTrendIQ ลงหน้าจอมือถือทันที'
                      : 'เปิดผ่าน Chrome บน Android แล้วแตะ ⋮ มุมขวาบน → เลือก "ติดตั้งแอป" เพื่อสร้างไอคอนลงหน้าจอ'}
                </li>
                <li>
                  <strong className="text-white">วิธีที่ 2 (ไฟล์แอปพกพา):</strong> โหลดไฟล์{' '}
                  <span className="text-[#F5C451] font-medium">FlowTrend-IQ-App.html</span>{' '}
                  เก็บไว้ในเครื่อง แล้วแตะเปิดใช้งานได้ทันทีโดยไม่ต้องพึ่งเซิร์ฟเวอร์ AI Studio
                </li>
              </ol>
            </div>

            <div className="space-y-2">
              {isInstallable ? (
                <button
                  type="button"
                  onClick={install}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#16C784] hover:bg-emerald-500 text-[#052E16] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>ติดตั้งไอคอนแอปลงมือถือทันที</span>
                </button>
              ) : isInstalled ? (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>กำลังเปิดใช้งานในโหมดแอปอิสระแล้ว</span>
                </div>
              ) : null}

              <a
                href="/api/download/android-app"
                download="FlowTrend-IQ-App.html"
                className="w-full py-2.5 px-4 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#E2E8F0] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4 text-[#16C784]" />
                <span>ดาวน์โหลดไฟล์แอปพกพา Android</span>
              </a>
            </div>
          </div>

          {/* PC Card */}
          <div className="rounded-xl border border-[#1E293B] bg-[#0B111E] p-4 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-500/15 text-[#60A5FA]">
                  <Monitor className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#F8FAFC]">
                    เครื่อง PC (Windows / Mac)
                  </h3>
                  <p className="text-[11px] text-[#94A3B8]">
                    ตัวติดตั้งสำเร็จรูป คลิกไอคอน Desktop ใช้งานได้เลย
                  </p>
                </div>
              </div>

              <ol className="space-y-2 text-xs text-[#CBD5E1] leading-relaxed list-decimal list-inside">
                <li>
                  กดดาวน์โหลดชุดติดตั้ง PC ด้านล่าง แล้วแตกไฟล์ ZIP
                </li>
                <li>
                  ดับเบิลคลิกไฟล์{' '}
                  <code className="px-1 py-0.5 rounded bg-[#162033] text-[#F5C451]">
                    Install-FlowTrend-IQ.bat
                  </code>{' '}
                  (สำหรับ Windows) หรือ{' '}
                  <code className="px-1 py-0.5 rounded bg-[#162033] text-[#F5C451]">
                    Install-FlowTrend-IQ-Mac.command
                  </code>{' '}
                  (สำหรับ Mac) เพียงครั้งเดียว
                </li>
                <li>
                  ระบบจะสร้างไอคอน <strong className="text-white">FlowTrend IQ</strong> บนหน้าจอ Desktop — คลิกที่ไอคอนเพื่อเปิดใช้งานได้ทันทีโดยไม่ต้องพึ่ง AI Studio
                </li>
              </ol>
            </div>

            <a
              href="/api/download/package"
              download="FlowTrend-IQ-PC-Setup.zip"
              className="w-full py-2.5 px-4 rounded-lg bg-[#2563EB] hover:bg-[#3B82F6] text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>ดาวน์โหลดตัวติดตั้ง PC (.zip)</span>
            </a>
          </div>
        </div>

        {/* Footer Tip */}
        <div className="px-5 py-3 border-t border-[#1D273B] bg-[#090E1A] flex items-center gap-2 text-[11px] text-[#94A3B8]">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#16C784] shrink-0" />
          <span>
            ทั้งชุดติดตั้ง PC และแอปมือถือถูกคอมไพล์พร้อมใช้งานในเครื่องแล้ว ไม่ต้องแนบซอร์สโค้ด ไม่ต้องพึ่งเซิร์ฟเวอร์ AI Studio
          </span>
        </div>
      </div>
    </div>
  );
};
