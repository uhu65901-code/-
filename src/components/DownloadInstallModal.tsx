import React from 'react';
import { Download, Monitor, Smartphone, Terminal, X } from 'lucide-react';
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
              ติดตั้งเป็นแอปลงเครื่อง (ไม่ต้องเปิดเว็บซ้ำ)
            </h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              สร้างไอคอนแอปบนมือถือ Android และคอมพิวเตอร์ PC เปิดใช้งานเป็นหน้าต่างโปรแกรมได้ทันที
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
                    มือถือ Android (ติดตั้งเป็นแอป)
                  </h3>
                  <p className="text-[11px] text-[#94A3B8]">
                    สร้างไอคอนในเครื่อง เปิดใช้งานเต็มจอเหมือนแอปทั่วไป
                  </p>
                </div>
              </div>

              <ol className="space-y-2 text-xs text-[#CBD5E1] leading-relaxed list-decimal list-inside">
                <li>
                  เปิดหน้านี้ผ่าน <strong className="text-white">Google Chrome</strong> บนมือถือ Android
                </li>
                <li>
                  {isInstalled
                    ? 'ติดตั้งเป็นแอปบนเครื่องนี้เรียบร้อยแล้ว'
                    : isInstallable
                      ? 'กดปุ่มสีเขียวด้านล่างเพื่อติดตั้งแอปลงหน้าจอมือถือทันที'
                      : 'แตะเมนู ⋮ มุมขวาบนของ Chrome → เลือก "ติดตั้งแอป" (Install app) ระบบจะสร้างไอคอนแอปลงหน้าหลักและหน้ารวมแอป'}
                </li>
                <li>
                  ครั้งต่อไปแตะไอคอน <strong className="text-white">FlowTrendIQ</strong> บนมือถือเพื่อใช้งานได้เลย ไม่ต้องพิมพ์เว็บใหม่
                </li>
              </ol>
            </div>

            {isInstallable ? (
              <button
                type="button"
                onClick={install}
                className="w-full py-2.5 px-4 rounded-lg bg-[#16C784] hover:bg-emerald-500 text-[#052E16] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Smartphone className="w-4 h-4" />
                <span>ติดตั้งเป็นแอปลงเครื่องตอนนี้</span>
              </button>
            ) : (
              <div className="p-2.5 rounded-lg bg-[#11192B] border border-[#1E293B] text-[11px] text-[#94A3B8]">
                {isInstalled
                  ? 'กำลังเปิดใช้งานในโหมดแอป Standalone แล้ว'
                  : 'Android Chrome: แตะ ⋮ มุมขวาบน → "ติดตั้งแอป" (จะติดตั้งเป็น WebAPK ลงเครื่องทันที)'}
              </div>
            )}
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
                    ติดตั้งไอคอนโปรแกรมลง Desktop เปิดเป็นหน้าต่างแยก
                  </p>
                </div>
              </div>

              <ul className="space-y-2 text-xs text-[#CBD5E1] leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="text-[#16C784] font-bold">1.</span>
                  <span>
                    <strong className="text-white">แบบเร็วที่สุด (1 คลิก):</strong> กดปุ่มติดตั้งด้านซ้าย หรือไอคอนรูปจอ/ลูกศรในแถบด้านบนขวาของ Chrome/Edge → เลือก <strong className="text-white">ติดตั้ง</strong> เพื่อสร้างไอคอนบนหน้า Desktop ทันที
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#60A5FA] font-bold">2.</span>
                  <span>
                    <strong className="text-white">แบบโหลดลงเครื่อง Windows (.zip):</strong> แตกไฟล์แล้วดับเบิลคลิก{' '}
                    <code className="px-1 py-0.5 rounded bg-[#162033] text-[#F5C451]">
                      Install-FlowTrend-IQ-Windows.bat
                    </code>{' '}
                    เพื่อสร้างไอคอนช็อตคัตลง Desktop และเปิดเป็นหน้าต่างโปรแกรมแยกอิสระ (พร้อมไฟล์ <code className="text-[#F5C451]">electron/main.cjs</code> สำหรับต่อยอดทำ .exe)
                  </span>
                </li>
              </ul>
            </div>

            <a
              href="/api/download/package"
              download="FlowTrend-IQ-Program.zip"
              className="w-full py-2.5 px-4 rounded-lg bg-[#2563EB] hover:bg-[#3B82F6] text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>ดาวน์โหลดชุดติดตั้ง PC + ซอร์สโค้ด (.zip)</span>
            </a>
          </div>
        </div>

        {/* Footer Tip */}
        <div className="px-5 py-3 border-t border-[#1D273B] bg-[#090E1A] flex items-center gap-2 text-[11px] text-[#94A3B8]">
          <Terminal className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
          <span>
            เมื่อติดตั้งด้วยปุ่ม "ติดตั้งแอป" หรือ Install-FlowTrend-IQ-Windows.bat ตัวโปรแกรมจะเปิดเป็นหน้าต่างแอปแยกโดยไม่มีแถบเว็บ (ต้องมีอินเทอร์เน็ตเพื่อเชื่อมข้อมูลราคาสดจาก IQ Option)
          </span>
        </div>
      </div>
    </div>
  );
};
