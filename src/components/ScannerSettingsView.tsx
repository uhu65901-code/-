import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from '../lib/types';
import { playTrendAlertChime } from '../utils/soundAlert';

interface ScannerSettingsViewProps {
  config: ScannerConfig;
  onSaveConfig: (next: ScannerConfig) => Promise<void>;
}

export const ScannerSettingsView: React.FC<ScannerSettingsViewProps> = ({
  config,
  onSaveConfig,
}) => {
  const [draft, setDraft] = useState<ScannerConfig>(config);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveConfig(draft);
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setDraft(DEFAULT_SCANNER_CONFIG);
    setSaving(true);
    setSavedNotice(false);
    try {
      await onSaveConfig(DEFAULT_SCANNER_CONFIG);
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 lg:p-6 space-y-6">
      <div className="border-b border-[#1D273B] pb-4">
        <h1 className="text-xl font-bold text-[#F8FAFC]">
          ตั้งค่าเงื่อนไขการสแกนกราฟ 1 นาที
        </h1>
        <p className="mt-1 text-xs text-[#94A3B8]">
          ปรับเกณฑ์จำนวนแท่งเทรนด์ไหล (ค่าเริ่มต้น 5–6 แท่ง) ไส้เทียน ความสม่ำเสมอ และระดับความดัง-ความยาวของเสียงแจ้งเตือน
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border border-[#1D273B] rounded-xl bg-[#0D1422] divide-y divide-[#1A2438]"
      >
        {/* Trend Candle Length (5-6 default) */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="min-candles"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              จำนวนแท่งเริ่มต้นที่แจ้งเตือน (ขั้นต่ำ)
            </label>
            <p className="mt-1 text-xs text-[#94A3B8]">
              ค่าแนะนำคือ 5 แท่ง เพื่อยืนยันเทรนด์ไหลชัดเจนก่อนแจ้งเตือน
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                id="min-candles"
                type="range"
                min={3}
                max={6}
                step={1}
                value={draft.targetMinCandles}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setDraft((prev) => ({
                    ...prev,
                    targetMinCandles: val,
                    targetMaxCandles: Math.max(val, prev.targetMaxCandles),
                  }));
                }}
                className="flex-1 accent-[#3B82F6] cursor-pointer"
              />
              <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
                {draft.targetMinCandles} แท่ง
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="max-candles"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              จำนวนแท่งสูงสุดของเทรนด์ไหล (ไม่เกิน)
            </label>
            <p className="mt-1 text-xs text-[#94A3B8]">
              ค่าแนะนำคือ 6 แท่ง หากไหลเกินจำนวนนี้จะจัดเป็น &quot;เลยระยะ&quot;
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                id="max-candles"
                type="range"
                min={draft.targetMinCandles}
                max={7}
                step={1}
                value={draft.targetMaxCandles}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    targetMaxCandles: Number(e.target.value),
                  }))
                }
                className="flex-1 accent-[#3B82F6] cursor-pointer"
              />
              <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
                {draft.targetMaxCandles} แท่ง
              </span>
            </div>
          </div>
        </div>

        {/* Wick & Uniformity */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label
              htmlFor="max-wick"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              สัดส่วนไส้เทียนสูงสุดที่ยอมรับได้
            </label>
            <p className="mt-1 text-xs text-[#94A3B8]">
              ยิ่งน้อยยิ่งคัดเฉพาะแท่งที่ไม่มีไส้หรือไส้สั้นมาก (ค่ามาตรฐาน 26%)
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                id="max-wick"
                type="range"
                min={10}
                max={45}
                step={2}
                value={Math.round(draft.maxWickRatio * 100)}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    maxWickRatio: Number(e.target.value) / 100,
                  }))
                }
                className="flex-1 accent-[#3B82F6] cursor-pointer"
              />
              <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
                {Math.round(draft.maxWickRatio * 100)}%
              </span>
            </div>
          </div>

          <div>
            <label
              htmlFor="min-uniformity"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              ความสม่ำเสมอของขนาดแท่งเทียนขั้นต่ำ
            </label>
            <p className="mt-1 text-xs text-[#94A3B8]">
              ป้องกันกราฟสวิงหรือแท่งใหญ่เล็กสลับกันรุนแรง (ค่ามาตรฐาน 70%)
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                id="min-uniformity"
                type="range"
                min={50}
                max={92}
                step={2}
                value={draft.minUniformityScore}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    minUniformityScore: Number(e.target.value),
                  }))
                }
                className="flex-1 accent-[#3B82F6] cursor-pointer"
              />
              <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
                {draft.minUniformityScore}%
              </span>
            </div>
          </div>
        </div>

        {/* Counter Color Candles & Short Body Cap */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <span className="block text-sm font-medium text-[#F1F5F9]">
              แท่งเทียนสวนสีระหว่างเทรนด์ไหล
            </span>
            <p className="mt-1 text-xs text-[#94A3B8]">
              เลือกว่าจะรับเฉพาะสีเดียวกันล้วน หรืออนุญาตแท่งสวนขนาดเล็กมากแทรกได้ 1 แท่ง
            </p>
            <div className="mt-3 flex items-center p-1 bg-[#0B111E] border border-[#1E293B] rounded-lg">
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, maxCounterCandles: 0 }))
                }
                className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  draft.maxCounterCandles === 0
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                0 แท่ง (สีเดียวล้วน)
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, maxCounterCandles: 1 }))
                }
                className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  draft.maxCounterCandles === 1
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                แทรกได้ 1 แท่งเล็ก
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="max-body-ratio"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              เพดานความยาวแท่ง (กันแท่งยาวผิดปกติ)
            </label>
            <p className="mt-1 text-xs text-[#94A3B8]">
              คัดกรองให้เป็นแท่งสั้น ไม่เกินกี่เท่าของค่าเฉลี่ย 26 แท่งล่าสุด
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                id="max-body-ratio"
                type="range"
                min={1.4}
                max={3.0}
                step={0.1}
                value={draft.maxBodyToMedianRatio}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    maxBodyToMedianRatio: Number(e.target.value),
                  }))
                }
                className="flex-1 accent-[#3B82F6] cursor-pointer"
              />
              <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
                {draft.maxBodyToMedianRatio.toFixed(1)}x
              </span>
            </div>
          </div>
        </div>

        {/* Loud & Long Sound Settings */}
        <div className="p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <label
                htmlFor="sound-toggle"
                className="text-sm font-medium text-[#F1F5F9] flex items-center gap-2 cursor-pointer"
              >
                <input
                  id="sound-toggle"
                  type="checkbox"
                  checked={draft.soundEnabled}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      soundEnabled: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-[#3B82F6] rounded cursor-pointer"
                />
                เปิดเสียงแจ้งเตือนดังชัดเจนอัตโนมัติเมื่อพบกราฟเข้าเงื่อนไข
              </label>
              <p className="mt-1 text-xs text-[#94A3B8]">
                ส่งเสียงสัญญาณแบบหลายจังหวะทันทีเมื่อพบชุดเทรนด์ไหล 5–6 แท่ง
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                playTrendAlertChime('UP', draft.soundVolume, draft.soundDurationMode)
              }
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#E2E8F0] inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Volume2 className="w-4 h-4 text-[#16C784]" />
              ทดสอบเสียงแจ้งเตือน
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-[#162033]">
            <div>
              <label
                htmlFor="sound-volume"
                className="block text-xs font-medium text-[#CBD5E1]"
              >
                ความดังของเสียงแจ้งเตือน
              </label>
              <div className="mt-2 flex items-center gap-4">
                <input
                  id="sound-volume"
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={Math.round(draft.soundVolume * 100)}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      soundVolume: Number(e.target.value) / 100,
                    }))
                  }
                  className="flex-1 accent-[#3B82F6] cursor-pointer"
                />
                <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
                  {Math.round(draft.soundVolume * 100)}%
                </span>
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-[#CBD5E1]">
                ความยาวของเสียงแจ้งเตือน
              </span>
              <div className="mt-2 flex items-center p-1 bg-[#0B111E] border border-[#1E293B] rounded-lg">
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, soundDurationMode: 'STANDARD' }))
                  }
                  className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    draft.soundDurationMode === 'STANDARD'
                      ? 'bg-[#1D2A42] text-[#F8FAFC]'
                      : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                  }`}
                >
                  2 รอบ (~2.2 วิ)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, soundDurationMode: 'LONG' }))
                  }
                  className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    draft.soundDurationMode === 'LONG'
                      ? 'bg-[#1D2A42] text-[#F8FAFC]'
                      : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                  }`}
                >
                  ยาวพิเศษ 3 รอบ (~3.6 วิ)
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 flex flex-wrap items-center justify-between gap-4 bg-[#0B111E] rounded-b-xl">
          <div className="text-xs text-emerald-400">
            {savedNotice ? 'บันทึกการตั้งค่าเงื่อนไขสแกนเรียบร้อยแล้ว' : ''}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            >
              คืนค่าเริ่มต้น
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-semibold rounded-lg bg-[#2563EB] hover:bg-[#3B82F6] disabled:opacity-60 text-white cursor-pointer"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
