import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  Download,
  HardDrive,
  RotateCcw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { parseImportedAiSamples } from '../lib/aiPatternLearner';
import {
  AiPatternModel,
  MAX_AI_TRAINING_SAMPLES,
  PatternFeedbackSample,
  ScannerConfig,
  TrendDirection,
} from '../lib/types';

interface AiPatternPanelProps {
  config: ScannerConfig;
  aiSamples: PatternFeedbackSample[];
  aiModel: AiPatternModel;
  onUpdateAiConfig: (patch: Partial<ScannerConfig>) => void;
  onRemoveSample: (sampleId: string) => void;
  onResetSamples: () => void;
  onImportSamples?: (samples: PatternFeedbackSample[]) => void;
  onInspectAsset?: (assetId: string, assetName?: string) => void;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const AiPatternPanel: React.FC<AiPatternPanelProps> = ({
  config,
  aiSamples,
  aiModel,
  onUpdateAiConfig,
  onRemoveSample,
  onResetSamples,
  onImportSamples,
  onInspectAsset,
}) => {
  const [dirFilter, setDirFilter] = useState<'ALL' | TrendDirection>('ALL');
  const [showAllSamples, setShowAllSamples] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const orderedSamples = useMemo(
    () =>
      [...aiSamples]
        .reverse()
        .filter((s) => (dirFilter === 'ALL' ? true : s.direction === dirFilter)),
    [aiSamples, dirFilter]
  );

  const visibleSamples = useMemo(
    () => (showAllSamples ? orderedSamples : orderedSamples.slice(0, 100)),
    [orderedSamples, showAllSamples]
  );

  const upPassCount = useMemo(
    () => aiSamples.filter((s) => s.verdict === 'PASS' && s.direction === 'UP').length,
    [aiSamples]
  );
  const downPassCount = useMemo(
    () =>
      aiSamples.filter((s) => s.verdict === 'PASS' && s.direction === 'DOWN').length,
    [aiSamples]
  );

  const totalCount = aiModel.passCount + aiModel.rejectCount;

  const handleExportJson = () => {
    const payload = {
      app: 'FlowTrend-IQ',
      version: 1,
      exportedAt: new Date().toISOString(),
      samples: aiSamples,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flowtrend-ai-patterns-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupNotice(`ส่งออกข้อมูล AI ${aiSamples.length} ตัวอย่างเรียบร้อย`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImportSamples) return;
    try {
      const text = await file.text();
      const imported = parseImportedAiSamples(text);
      if (imported.length === 0) {
        setBackupNotice('ไม่พบข้อมูลเทรนด์ขึ้น/ลงที่ใช้งานได้ในไฟล์นี้');
        return;
      }
      onImportSamples(imported);
      setBackupNotice(`นำเข้าข้อมูล AI สำเร็จ ${imported.length} ตัวอย่าง และบันทึกลงอุปกรณ์แล้ว`);
    } catch (err) {
      setBackupNotice(
        err instanceof Error ? err.message : 'ไม่สามารถอ่านไฟล์สำรองข้อมูล AI ได้'
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* AI Overview & Controls Card */}
      <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1A2438] pb-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 shrink-0">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#F8FAFC]">
                AI เรียนรู้ทรงกราฟไหลเทรนด์ขึ้น / เทรนด์ลง กรอบ M15 (เก็บในอุปกรณ์ของคุณ)
              </h2>
              <p className="mt-1 text-xs text-[#94A3B8]">
                พิมพ์ชื่อหากราฟที่ต้องการในหน้าตัวสแกนแล้วกดปุ่ม &quot;ผ่าน&quot; เพื่อสอน AI ว่ากราฟไหลเป็นเทรนด์สีเดียวกันสม่ำเสมอในกรอบ M15 (15–20 แท่ง) คือผ่านเงื่อนไข เก็บข้อมูลตัวอย่างได้สูงสุด {MAX_AI_TRAINING_SAMPLES.toLocaleString()} ตัวอย่าง (มากกว่า 500 ตัวอย่าง)
              </p>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap self-start sm:self-center ${
              totalCount > 0 && config.aiLearningEnabled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-[#162033] border-[#273652] text-[#94A3B8]'
            }`}
          >
            {totalCount > 0 && config.aiLearningEnabled
              ? `AI พร้อมคัดกรอง · ผ่าน ${aiModel.passCount} / ไม่ผ่าน ${aiModel.rejectCount}`
              : 'รอการสอนจากปุ่ม "ผ่าน"'}
          </span>
        </div>

        {/* Device Persistence Status Banner */}
        <div className="p-3 rounded-lg bg-[#0B111E] border border-[#1E293B] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#CBD5E1]">
            <HardDrive className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              จัดเก็บถาวรในอุปกรณ์นี้แล้ว{' '}
              <span
                data-testid="ai-sample-capacity"
                className="font-mono-tabular font-semibold text-[#F8FAFC]"
              >
                {aiSamples.length.toLocaleString()}/{MAX_AI_TRAINING_SAMPLES.toLocaleString()}
              </span>{' '}
              ตัวอย่าง (ขาขึ้น {upPassCount} ทรง · ขาลง {downPassCount} ทรง)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {aiSamples.length > 0 && (
              <button
                type="button"
                onClick={handleExportJson}
                className="px-2.5 py-1 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>สำรองข้อมูล AI</span>
              </button>
            )}
            {onImportSamples && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>นำเข้าข้อมูล AI</span>
                </button>
              </>
            )}
          </div>
        </div>

        {backupNotice && (
          <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
            {backupNotice}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label
              htmlFor="ai-learning-toggle"
              className="text-sm font-medium text-[#F1F5F9] flex items-center gap-2 cursor-pointer"
            >
              <input
                id="ai-learning-toggle"
                type="checkbox"
                checked={config.aiLearningEnabled}
                onChange={(e) =>
                  onUpdateAiConfig({ aiLearningEnabled: e.target.checked })
                }
                className="w-4 h-4 accent-[#16C784] rounded cursor-pointer"
              />
              เปิดให้ AI เรียนรู้และคัดกรองทรงกราฟอัตโนมัติ
            </label>
            <p className="text-xs text-[#94A3B8]">
              เมื่อเปิดใช้งาน ระบบจะคำนวณความคล้ายกับทรงเทรนด์ขึ้น/ลงที่กด &quot;ผ่าน&quot; เพื่อช่วยดันคะแนนให้ทรงสวยที่คล้ายกัน
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <label
                htmlFor="ai-influence-slider"
                className="font-medium text-[#F1F5F9]"
              >
                น้ำหนักการปรับคะแนนของ AI
              </label>
              <span className="font-mono-tabular font-semibold text-indigo-300">
                {config.aiInfluencePercent}%
              </span>
            </div>
            <input
              id="ai-influence-slider"
              type="range"
              min={0}
              max={60}
              step={5}
              value={config.aiInfluencePercent}
              onChange={(e) =>
                onUpdateAiConfig({
                  aiInfluencePercent: Number(e.target.value),
                })
              }
              className="w-full accent-indigo-400 cursor-pointer"
            />
            <p className="text-xs text-[#94A3B8]">
              ค่าแนะนำ 35% (ปรับได้ตั้งแต่ 0% ถึง 60%) ยิ่งสูง AI ยิ่งมีน้ำหนักในการคัดกรองทรงคล้ายกันมากขึ้น
            </p>
          </div>
        </div>

        {/* Learned Profile Metrics */}
        {aiModel.preferredSummary ? (
          <div className="pt-4 border-t border-[#1A2438] space-y-3">
            <div className="text-xs font-semibold text-[#CBD5E1]">
              สเปกทรงกราฟที่ AI จดจำได้จากตัวอย่าง &quot;ผ่าน&quot; ({aiModel.passCount} ทรง)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-[#0B111E] border border-[#1E293B]">
                <div className="text-[11px] text-[#94A3B8]">ความยาวเทรนด์เฉลี่ย</div>
                <div className="mt-1 text-base font-bold font-mono-tabular text-[#F8FAFC]">
                  {aiModel.preferredSummary.idealRunLength} แท่ง
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0B111E] border border-[#1E293B]">
                <div className="text-[11px] text-[#94A3B8]">สัดส่วนไส้เทียนที่ชอบ</div>
                <div className="mt-1 text-base font-bold font-mono-tabular text-emerald-400">
                  ~{aiModel.preferredSummary.idealWickPercent}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0B111E] border border-[#1E293B]">
                <div className="text-[11px] text-[#94A3B8]">ความสม่ำเสมอที่ชอบ</div>
                <div className="mt-1 text-base font-bold font-mono-tabular text-[#60A5FA]">
                  {aiModel.preferredSummary.idealUniformity}/100
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0B111E] border border-[#1E293B]">
                <div className="text-[11px] text-[#94A3B8]">ขนาดเนื้อเทียนเทียบเฉลี่ย</div>
                <div className="mt-1 text-base font-bold font-mono-tabular text-amber-300">
                  {aiModel.preferredSummary.idealBodyRatio}x
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-[#0B111E] border border-[#1E293B] text-xs text-[#94A3B8]">
            ยังไม่มีตัวอย่างทรงกราฟที่สอนไว้ — คุณสามารถพิมพ์ชื่อหากราฟที่หน้าตัวสแกนแล้วกดปุ่ม <span className="text-emerald-300 font-semibold">&quot;ผ่าน (สอน AI)&quot;</span> เพื่อบันทึกเข้าความจำบนอุปกรณ์นี้ได้ทันที
          </div>
        )}
      </div>

      {/* Trained Samples History */}
      <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1A2438] flex flex-wrap items-center justify-between gap-2 bg-[#0F172A]/60">
          <div>
            <h3 className="text-sm font-semibold text-[#F8FAFC]">
              ประวัติตัวอย่างทรงกราฟที่เก็บบนอุปกรณ์ ({orderedSamples.length})
            </h3>
            <p className="text-xs text-[#94A3B8]">
              ข้อมูลทั้งหมดถูกบันทึกไว้ในเครื่องของคุณเพื่อพัฒนาการคัดกรองให้แม่นขึ้นเรื่อยๆ
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center p-0.5 bg-[#0B111E] border border-[#1E293B] rounded-lg text-xs">
              {(['ALL', 'UP', 'DOWN'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirFilter(d)}
                  className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                    dirFilter === d
                      ? 'bg-[#1D2A42] text-white'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {d === 'ALL' ? 'ทั้งหมด' : d === 'UP' ? 'ขาขึ้น' : 'ขาลง'}
                </button>
              ))}
            </div>

            {aiSamples.length > 0 && (
              <button
                type="button"
                onClick={onResetSamples}
                className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-xs font-medium text-rose-300 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ล้างความจำ AI</span>
              </button>
            )}
          </div>
        </div>

        {orderedSamples.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#64748B]">
            ยังไม่มีข้อมูลตัวอย่างที่บันทึกไว้
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1A2438] text-[#94A3B8]">
                  <th className="py-2.5 px-4">เวลา</th>
                  <th className="py-2.5 px-4">ผลการสอน</th>
                  <th className="py-2.5 px-4">สินทรัพย์</th>
                  <th className="py-2.5 px-4">ทิศทาง</th>
                  <th className="py-2.5 px-4 text-right">ความยาว</th>
                  <th className="py-2.5 px-4 text-right">ไส้เฉลี่ย</th>
                  <th className="py-2.5 px-4 text-right">สม่ำเสมอ</th>
                  <th className="py-2.5 px-4 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#162033]">
                {visibleSamples.map((sample) => (
                  <tr key={sample.id} className="hover:bg-[#11192B]">
                    <td className="py-2.5 px-4 font-mono-tabular text-[#94A3B8] whitespace-nowrap">
                      {formatDateTime(sample.createdAt)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {sample.verdict === 'PASS' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          ผ่าน
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-300 font-semibold">
                          <XCircle className="w-3 h-3" />
                          ไม่ผ่าน
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-[#F1F5F9] whitespace-nowrap">
                      {onInspectAsset ? (
                        <button
                          type="button"
                          onClick={() => onInspectAsset(sample.assetId, sample.assetName)}
                          className="text-left hover:text-[#60A5FA] underline decoration-[#334155] underline-offset-2 cursor-pointer"
                        >
                          {sample.assetName}
                        </button>
                      ) : (
                        sample.assetName
                      )}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          sample.direction === 'UP'
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {sample.direction === 'UP' ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                        {sample.direction === 'UP' ? 'CALL (ขาขึ้น)' : 'PUT (ขาลง)'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-[#E2E8F0] whitespace-nowrap">
                      {sample.runLength} แท่ง
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-emerald-400 whitespace-nowrap">
                      {(sample.avgWickRatio * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular text-[#E2E8F0] whitespace-nowrap">
                      {sample.uniformityScore}/100
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onRemoveSample(sample.id)}
                        aria-label={`ลบตัวอย่าง ${sample.assetName}`}
                        className="p-1.5 rounded hover:bg-[#1E2B44] text-[#94A3B8] hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {orderedSamples.length > 100 && (
              <div className="px-4 py-3 border-t border-[#162033] bg-[#0B111E] flex items-center justify-between text-xs text-[#94A3B8]">
                <span>
                  แสดงอยู่ {visibleSamples.length.toLocaleString()} จาก{' '}
                  {orderedSamples.length.toLocaleString()} ตัวอย่าง
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllSamples((prev) => !prev)}
                  className="px-3 py-1 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] font-medium cursor-pointer"
                >
                  {showAllSamples
                    ? 'ย่อเหลือ 100 รายการล่าสุด'
                    : `แสดงทั้งหมด (${orderedSamples.length.toLocaleString()})`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
