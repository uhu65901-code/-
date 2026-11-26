import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Brain, CheckCircle2, Eye, XCircle } from 'lucide-react';
import { deduplicateAlertsByAsset } from '../lib/performanceStats';
import { PatternVerdict, TradeOutcome, TrendAlert, TrendDirection } from '../lib/types';

interface AlertsHistoryViewProps {
  alerts: TrendAlert[];
  onInspectAsset: (assetId: string, assetName?: string) => void;
  onMarkDecision: (
    alertId: string,
    decision: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED',
    tradeOutcome?: TradeOutcome
  ) => void;
  onTrainAiFromAlert?: (alert: TrendAlert, verdict: PatternVerdict) => void;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const AlertsHistoryView: React.FC<AlertsHistoryViewProps> = ({
  alerts,
  onInspectAsset,
  onMarkDecision,
  onTrainAiFromAlert,
}) => {
  const [dirFilter, setDirFilter] = useState<'ALL' | TrendDirection>('ALL');

  const deduplicatedAlerts = useMemo(
    () => deduplicateAlertsByAsset(alerts),
    [alerts]
  );

  const visibleAlerts = useMemo(
    () =>
      deduplicatedAlerts.filter((a) =>
        dirFilter === 'ALL' ? true : a.direction === dirFilter
      ),
    [deduplicatedAlerts, dirFilter]
  );

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#232B3E] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F8FAFC]">
            ประวัติคู่สินทรัพย์เข้าเงื่อนไข (ไม่ซ้ำ · สีเดียวไหลสวย)
          </h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            บันทึกเฉพาะคู่สินทรัพย์ที่เรียงตัวสีเดียวกัน สม่ำเสมอ มีไส้ได้เล็กน้อย และไม่เก็บชื่อซ้ำ พร้อมปุ่ม &quot;AI ผ่าน&quot; เพื่อสอน AI ให้คัดทรงคล้ายกันแม่นขึ้นเรื่อยๆ
          </p>
        </div>

        <div className="flex items-center p-0.5 bg-[#131722] border border-[#232B3E] rounded-lg self-start">
          {(['ALL', 'UP', 'DOWN'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirFilter(d)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                dirFilter === d
                  ? 'bg-[#1F273B] text-[#F8FAFC]'
                  : 'text-[#94A3B8] hover:text-[#E2E8F0]'
              }`}
            >
              {d === 'ALL'
                ? `ทุกทิศทาง (${deduplicatedAlerts.length})`
                : d === 'UP'
                  ? 'ขาขึ้น'
                  : 'ขาลง'}
            </button>
          ))}
        </div>
      </div>

      {visibleAlerts.length === 0 ? (
        <div className="p-12 text-center border border-[#232B3E] rounded-xl bg-[#131722]">
          <p className="text-sm font-medium text-[#CBD5E1]">
            ยังไม่มีสัญญาณแจ้งเตือนในเงื่อนไขที่เลือก
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            ระบบกำลังสแกนแท่งเทียน 1 นาทีแบบเรียลไทม์ เมื่อพบกราฟสีเดียวกันเรียงตัวสม่ำเสมอไม่ไซด์เวย์จะปรากฏที่นี่ทันที
          </p>
        </div>
      ) : (
        <div className="border border-[#232B3E] rounded-xl bg-[#131722] overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#232B3E] text-xs font-medium text-[#94A3B8]">
                <th className="py-3 px-4">เวลาอัปเดต</th>
                <th className="py-3 px-4">คู่สินทรัพย์</th>
                <th className="py-3 px-4">ทิศทาง</th>
                <th className="py-3 px-4 text-right">ความเข้าเงื่อนไข</th>
                <th className="py-3 px-4 text-right">ความยาว</th>
                <th className="py-3 px-4 text-right">ไส้เฉลี่ย</th>
                <th className="py-3 px-4 text-right">ราคาขณะเตือน</th>
                <th className="py-3 px-4 text-right">ดูกราฟ &amp; บันทึกผลเทรด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1D2436] text-xs">
              {visibleAlerts.map((alert) => {
                const isUp = alert.direction === 'UP';
                const score = alert.matchScore ?? alert.uniformityScore;
                return (
                  <tr key={alert.id} className="hover:bg-[#161C2B] transition-colors">
                    <td className="py-3 px-4 font-mono-tabular text-[#CBD5E1] whitespace-nowrap">
                      {formatDateTime(alert.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#F1F5F9]">
                        {alert.assetName}
                      </div>
                      <div className="text-[11px] text-[#64748B]">
                        {alert.category === 'BINARY' ? 'Binary' : 'Digital'} · {alert.payoutPercent}%
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          isUp ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {isUp ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                        {isUp ? 'ขาขึ้น (CALL)' : 'ขาลง (PUT)'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono-tabular font-semibold text-[#16C784]">
                        {score}%
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-[#E2E8F0] whitespace-nowrap">
                      {alert.runLength} แท่ง
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-emerald-400 whitespace-nowrap">
                      {(alert.avgWickRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-[#CBD5E1] whitespace-nowrap">
                      {alert.priceAtAlert}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onInspectAsset(alert.assetId, alert.assetName)}
                          className="px-2.5 py-1.5 rounded bg-[#1E2538] hover:bg-[#27314A] text-[#E2E8F0] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>ดูกราฟ</span>
                        </button>

                        {onTrainAiFromAlert && (
                          <>
                            <button
                              type="button"
                              onClick={() => onTrainAiFromAlert(alert, 'PASS')}
                              aria-label={`AI ผ่าน ${alert.assetName}`}
                              className={`px-2 py-1.5 rounded inline-flex items-center gap-1 border whitespace-nowrap cursor-pointer transition-colors ${
                                alert.aiVerdict === 'PASS'
                                  ? 'bg-indigo-500/25 border-indigo-400 text-indigo-200 font-semibold'
                                  : 'bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/35 text-indigo-300'
                              }`}
                            >
                              <Brain className="w-3.5 h-3.5" />
                              <span>
                                {alert.aiVerdict === 'PASS'
                                  ? 'ผ่าน (AI จำแล้ว)'
                                  : 'AI ผ่าน'}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onTrainAiFromAlert(alert, 'REJECT')}
                              aria-label={`AI ไม่ผ่าน ${alert.assetName}`}
                              className={`px-2 py-1.5 rounded inline-flex items-center gap-1 border whitespace-nowrap cursor-pointer transition-colors ${
                                alert.aiVerdict === 'REJECT'
                                  ? 'bg-rose-500/25 border-rose-400 text-rose-200 font-semibold'
                                  : 'bg-[#162033] hover:bg-rose-500/15 border-[#273652] text-[#94A3B8]'
                              }`}
                            >
                              <span>ไม่ผ่าน</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            onMarkDecision(alert.id, 'TRADED_MANUAL', 'WIN')
                          }
                          aria-label={`บันทึกผลชนะ ${alert.assetName}`}
                          className={`px-2 py-1.5 rounded inline-flex items-center gap-1 border whitespace-nowrap cursor-pointer transition-colors ${
                            alert.tradeOutcome === 'WIN'
                              ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200 font-semibold'
                              : 'bg-emerald-600/10 hover:bg-emerald-600/20 border-emerald-500/30 text-emerald-300'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {alert.tradeOutcome === 'WIN'
                              ? `ชนะ +${alert.payoutPercent}%`
                              : 'ชนะ (WIN)'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            onMarkDecision(alert.id, 'TRADED_MANUAL', 'LOSS')
                          }
                          aria-label={`บันทึกผลแพ้ ${alert.assetName}`}
                          className={`px-2 py-1.5 rounded inline-flex items-center gap-1 border whitespace-nowrap cursor-pointer transition-colors ${
                            alert.tradeOutcome === 'LOSS'
                              ? 'bg-rose-500/25 border-rose-400 text-rose-200 font-semibold'
                              : 'bg-rose-600/10 hover:bg-rose-600/20 border-rose-500/30 text-rose-300'
                          }`}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>
                            {alert.tradeOutcome === 'LOSS' ? 'แพ้แล้ว' : 'แพ้ (LOSS)'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onMarkDecision(alert.id, 'SKIPPED')}
                          aria-label={`ข้ามคู่ ${alert.assetName}`}
                          className={`px-2 py-1.5 rounded border whitespace-nowrap cursor-pointer transition-colors ${
                            alert.decisionNote === 'SKIPPED'
                              ? 'bg-[#273652] border-[#475569] text-[#F8FAFC]'
                              : 'bg-[#162033] hover:bg-[#1E2B44] border-[#273652] text-[#94A3B8]'
                          }`}
                        >
                          {alert.decisionNote === 'SKIPPED' ? 'ข้ามแล้ว' : 'ข้าม'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

