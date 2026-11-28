import React, { useEffect, useState } from 'react';
import { BarChart3, Brain, SlidersHorizontal } from 'lucide-react';
import {
  AiPatternModel,
  DEFAULT_SCANNER_CONFIG,
  DecisionRecord,
  PatternFeedbackSample,
  ScannerConfig,
  TradeOutcome,
  TrendAlert,
} from '../lib/types';
import { AiPatternPanel } from './AiPatternPanel';
import { PerformanceAnalyticsPanel } from './PerformanceAnalyticsPanel';

interface ScannerSettingsViewProps {
  config: ScannerConfig;
  alerts: TrendAlert[];
  decisionRecords: DecisionRecord[];
  aiSamples: PatternFeedbackSample[];
  aiModel: AiPatternModel;
  onSaveConfig: (next: ScannerConfig) => Promise<void>;
  onRecordOutcome: (
    alertId: string,
    decision: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED',
    tradeOutcome?: TradeOutcome
  ) => void;
  onRemoveAiSample: (sampleId: string) => void;
  onResetAiSamples: () => void;
  onImportAiSamples?: (samples: PatternFeedbackSample[]) => void;
  onInspectAsset?: (assetId: string, assetName?: string) => void;
}

const LOOKBACK_PRESETS = [
  { id: '4-6', label: '4–6 แท่งล่าสุด (แนะนำ)', min: 4, max: 6 },
  { id: '4', label: '4 แท่งล่าสุด', min: 4, max: 4 },
  { id: '5', label: '5 แท่งล่าสุด', min: 5, max: 6 },
  { id: '6', label: '6 แท่งล่าสุด', min: 6, max: 6 },
  { id: '3', label: '3 แท่งล่าสุด (ไว)', min: 3, max: 5 },
] as const;

export const ScannerSettingsView: React.FC<ScannerSettingsViewProps> = ({
  config,
  alerts,
  decisionRecords,
  aiSamples,
  aiModel,
  onSaveConfig,
  onRecordOutcome,
  onRemoveAiSample,
  onResetAiSamples,
  onImportAiSamples,
  onInspectAsset,
}) => {
  const [subTab, setSubTab] = useState<'criteria' | 'ai' | 'analytics'>('criteria');
  const [draft, setDraft] = useState<ScannerConfig>(config);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

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
    <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#1D273B] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F8FAFC]">
            ตั้งค่าเกณฑ์สแกน, สอน AI แท่งไหล &amp;{' '}
            <span className="whitespace-nowrap">Win Rate</span>
          </h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            อัปเดตตารางอันดับหลังจบแท่ง 1 นาที แยกตารางกราฟสีเดียวล้วนและกราฟพักตัวต่างสี 1–2 แท่ง พร้อมสอน AI จาก 4–6 แท่งล่าสุดด้วยตัวเอง
          </p>
        </div>

        <div
          role="tablist"
          aria-label="มุมมองหน้าตั้งค่า"
          className="flex flex-wrap items-center p-1 bg-[#0B111E] border border-[#1E293B] rounded-lg self-start shrink-0 gap-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'criteria'}
            onClick={() => setSubTab('criteria')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'criteria'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>ตั้งค่าเกณฑ์สแกน ({draft.minMatchScore}%+)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'ai'}
            onClick={() => setSubTab('ai')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'ai'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span>AI เรียนรู้ทรงกราฟ ({aiSamples.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'analytics'}
            onClick={() => setSubTab('analytics')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'analytics'
                ? 'bg-[#2563EB] text-white'
                : 'text-[#94A3B8] hover:text-[#E2E8F0]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>สรุปผลเทรด Win Rate &amp; กำไร</span>
          </button>
        </div>
      </div>

      {subTab === 'ai' ? (
        <AiPatternPanel
          config={config}
          aiSamples={aiSamples}
          aiModel={aiModel}
          onUpdateAiConfig={(patch) => {
            const next = { ...config, ...patch };
            setDraft(next);
            onSaveConfig(next);
          }}
          onRemoveSample={onRemoveAiSample}
          onResetSamples={onResetAiSamples}
          onImportSamples={onImportAiSamples}
          onInspectAsset={onInspectAsset}
        />
      ) : subTab === 'analytics' ? (
        <PerformanceAnalyticsPanel
          alerts={alerts}
          decisionRecords={decisionRecords}
          config={config}
          onRecordOutcome={onRecordOutcome}
        />
      ) : (
      <form
        onSubmit={handleSubmit}
        className="border border-[#1D273B] rounded-xl bg-[#0D1422] divide-y divide-[#1A2438]"
      >
        {/* Minimum Match Score >= 86% Balanced Anti-Sideways Gate */}
        <div className="p-5 space-y-3 bg-[#0F172A]/60 rounded-t-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label
                htmlFor="min-match-score"
                className="block text-sm font-semibold text-[#F8FAFC]"
              >
                ความเข้าเงื่อนไขขั้นต่ำในตารางจัดอันดับ (สีเดียว · สม่ำเสมอ · พักตัว 1–2 แท่ง)
              </label>
              <p className="mt-1 text-xs text-[#94A3B8]">
                ระบบจะจัดอันดับกราฟเข้าเกณฑ์เมื่อเรียงตัวสวยและสม่ำเสมอตามที่กำหนด (ค่าแนะนำ 86%)
              </p>
            </div>
            <span className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-sm font-bold font-mono-tabular text-[#16C784] self-start">
              ≥ {draft.minMatchScore}%
            </span>
          </div>
          <div className="flex items-center gap-4">
            <input
              id="min-match-score"
              type="range"
              min={75}
              max={98}
              step={1}
              value={draft.minMatchScore}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  minMatchScore: Number(e.target.value),
                }))
              }
              className="flex-1 accent-[#16C784] cursor-pointer"
            />
            <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
              {draft.minMatchScore}%
            </span>
          </div>
        </div>
        {/* M15 Window (15-20 candles max) */}
        <div className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label
                htmlFor="scan-window-bars"
                className="block text-sm font-semibold text-[#F8FAFC]"
              >
                กรอบเวลาสแกนและแสดงผล M15 (ไม่เกิน 20 แท่ง)
              </label>
              <p className="mt-1 text-xs text-[#94A3B8]">
                โฟกัสเฉพาะแท่งเทียน 15–20 แท่งล่าสุดในกรอบ M15 เพื่อให้เห็นการเรียงตัวของเทรนด์สีเดียวกันและสม่ำเสมอชัดเจนที่สุด
              </p>
            </div>
            <span className="px-3 py-1 rounded-lg bg-blue-500/15 border border-blue-500/40 text-xs font-bold font-mono-tabular text-[#60A5FA] self-start">
              M15 · {draft.scanWindowBars} แท่ง
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { bars: 15, label: 'M15 (15 แท่ง · แนะนำ)' },
              { bars: 18, label: '18 แท่ง' },
              { bars: 20, label: '20 แท่ง (สูงสุด)' },
            ].map((opt) => (
              <button
                key={opt.bars}
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, scanWindowBars: opt.bars }))
                }
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  draft.scanWindowBars === opt.bars
                    ? 'bg-[#2563EB] border-[#3B82F6] text-white'
                    : 'bg-[#0B111E] border-[#1E293B] text-[#CBD5E1] hover:border-[#334155]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <input
              id="scan-window-bars"
              type="range"
              min={15}
              max={20}
              step={1}
              value={draft.scanWindowBars}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  scanWindowBars: Number(e.target.value),
                }))
              }
              className="flex-1 accent-[#3B82F6] cursor-pointer"
            />
            <span className="w-16 text-right text-sm font-mono-tabular text-[#F8FAFC]">
              {draft.scanWindowBars} แท่ง
            </span>
          </div>
        </div>

        {/* Candle-Close Ranking Table Schedule Info */}
        <div className="p-5 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[#F8FAFC]">
                รอบอัปเดตตารางอันดับกราฟไหล: หลังจบแท่ง 1 นาที
              </div>
              <p className="mt-1 text-xs text-[#94A3B8]">
                ตำแหน่งอันดับในตารางจะถูกล็อกนิ่งตลอด 1 นาทีและรีเฟรชอัตโนมัติหลังจบแท่ง พร้อมแสดงปริมาณความยาวเนื้อกราฟและปริมาณไส้เทียนแยกชัดเจนระหว่างตารางสีเดียวล้วนและตารางแท่งต่างสี 1–2 แท่ง
              </p>
            </div>
            <span className="px-3 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/40 text-xs font-bold text-indigo-300 self-start whitespace-nowrap">
              อัปเดตหลังจบแท่ง
            </span>
          </div>
        </div>

        {/* Trend Candle Length (Selectable lookback 4-6 default) */}
        <div className="p-5 space-y-5">
          <div>
            <span className="block text-sm font-medium text-[#F1F5F9]">
              เลือกค่าเปรียบเทียบแท่งเทียนย้อนหลังล่าสุด
            </span>
            <p className="mt-1 text-xs text-[#94A3B8]">
              กำหนดว่าจะเปรียบเทียบแท่งเทียนล่าสุดกี่แท่ง (หรือปรับขั้นต่ำ-สูงสุดแบบละเอียดด้านล่าง)
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {LOOKBACK_PRESETS.map((preset) => {
                const isSelected =
                  draft.targetMinCandles === preset.min &&
                  draft.targetMaxCandles === preset.max;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        targetMinCandles: preset.min,
                        targetMaxCandles: preset.max,
                      }))
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#2563EB] border-[#3B82F6] text-white'
                        : 'bg-[#0B111E] border-[#1E293B] text-[#CBD5E1] hover:border-[#334155]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-[#162033]">
            <div>
              <label
                htmlFor="min-candles"
                className="block text-sm font-medium text-[#F1F5F9]"
              >
                เปรียบเทียบย้อนหลังขั้นต่ำ (กี่แท่งล่าสุด)
              </label>
              <p className="mt-1 text-xs text-[#94A3B8]">
                ค่าแนะนำคือ 4 แท่ง เพื่อจับเทรนด์ไหลเร็วและมีเวลาตัดสินใจมากขึ้น
              </p>
              <div className="mt-3 flex items-center gap-4">
                <input
                  id="min-candles"
                  type="range"
                  min={3}
                  max={8}
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
                  max={10}
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
              อนุญาตให้มีไส้ได้เล็กน้อยตามธรรมชาติของตลาด (ค่าแนะนำ 25%)
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
              คัดกราฟที่ขนาดแท่งสม่ำเสมอกันชัดเจน ไม่สวิงรุนแรง (ค่าแนะนำ 76%)
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
              แท่งเทียนต่างสีในกราฟไหล 5–6 แท่ง (พักตัวแล้วไปต่อ)
            </span>
            <p className="mt-1 text-xs text-[#94A3B8]">
              อนุญาตให้มีแท่งต่างสีแทรกพักตัวได้ 1–2 แท่งในชุด 5–6 แท่ง โดยระบบจะแยกแสดงในตารางแท่งต่างสีต่างหาก
            </p>
            <div className="mt-3 flex items-center p-1 bg-[#0B111E] border border-[#1E293B] rounded-lg gap-1">
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, maxCounterCandles: 0 }))
                }
                className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  draft.maxCounterCandles === 0
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                0 แท่ง (สีเดียว)
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, maxCounterCandles: 1 }))
                }
                className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  draft.maxCounterCandles === 1
                    ? 'bg-[#1D2A42] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                ได้ 1 แท่ง
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, maxCounterCandles: 2 }))
                }
                className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  draft.maxCounterCandles >= 2
                    ? 'bg-[#2563EB] text-white'
                    : 'text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                1–2 แท่ง (แนะนำ)
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="max-body-ratio"
              className="block text-sm font-medium text-[#F1F5F9]"
            >
              เพดานความยาวแท่งเล็ก (กันแท่งสวิงใหญ่ผิดปกติ)
            </label>
            <p className="mt-1 text-xs text-[#94A3B8]">
              คัดกรองให้ขนาดแท่งสม่ำเสมอกันชัดเจน ไม่เกินกี่เท่าของค่าเฉลี่ยกรอบ M15 ({draft.scanWindowBars} แท่งล่าสุด · แนะนำ 1.65x)
            </p>
            <div className="mt-3 flex items-center gap-4">
              <input
                id="max-body-ratio"
                type="range"
                min={1.2}
                max={2.6}
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
      )}
    </div>
  );
};
