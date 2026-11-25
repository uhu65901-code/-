import React, { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, Eye } from 'lucide-react';
import { TrendAlert, TrendDirection } from '../lib/types';

interface AlertsHistoryViewProps {
  alerts: TrendAlert[];
  onInspectAsset: (assetId: string) => void;
  onMarkDecision: (
    alertId: string,
    decision: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED'
  ) => void;
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
}) => {
  const [dirFilter, setDirFilter] = useState<'ALL' | TrendDirection>('ALL');

  const visibleAlerts = alerts.filter((a) =>
    dirFilter === 'ALL' ? true : a.direction === dirFilter
  );

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#232B3E] pb-4">
        <div>
          <h1 className="text-xl font-bold text-[#F8FAFC]">
            ประวัติสัญญาณแจ้งเตือนเรียลไทม์
          </h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            บันทึกคู่สินทรัพย์ 1 นาทีที่เข้าเกณฑ์เทรนด์ไหล เพื่อให้คุณตรวจสอบและตัดสินใจกดออเดอร์ด้วยตัวเองบน IQ Option
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
              {d === 'ALL' ? 'ทุกทิศทาง' : d === 'UP' ? 'ขาขึ้น' : 'ขาลง'}
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
            ระบบกำลังสแกนแท่งเทียน 1 นาทีแบบเรียลไทม์ เมื่อพบกราฟไหล 4–5 แท่งจะปรากฏที่นี่ทันที
          </p>
        </div>
      ) : (
        <div className="border border-[#232B3E] rounded-xl bg-[#131722] overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#232B3E] text-xs font-medium text-[#94A3B8]">
                <th className="py-3 px-4">เวลาแจ้งเตือน</th>
                <th className="py-3 px-4">คู่สินทรัพย์</th>
                <th className="py-3 px-4">ทิศทาง</th>
                <th className="py-3 px-4 text-right">ความยาว</th>
                <th className="py-3 px-4 text-right">ไส้เฉลี่ย</th>
                <th className="py-3 px-4 text-right">สม่ำเสมอ</th>
                <th className="py-3 px-4 text-right">ราคาขณะเตือน</th>
                <th className="py-3 px-4 text-right">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1D2436] text-xs">
              {visibleAlerts.map((alert) => {
                const isUp = alert.direction === 'UP';
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
                        {isUp ? 'ขาขึ้น (ซื้อ)' : 'ขาลง (ขาย)'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-[#E2E8F0]">
                      {alert.runLength} แท่ง
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-emerald-400">
                      {(alert.avgWickRatio * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-[#E2E8F0]">
                      {alert.uniformityScore}/100
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-[#CBD5E1]">
                      {alert.priceAtAlert}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onInspectAsset(alert.assetId)}
                          className="px-2.5 py-1.5 rounded bg-[#1E2538] hover:bg-[#27314A] text-[#E2E8F0] inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          ดูกราฟ
                        </button>
                        {alert.decisionNote === 'TRADED_MANUAL' ? (
                          <span className="text-emerald-400 font-medium inline-flex items-center gap-1 whitespace-nowrap">
                            <Check className="w-3.5 h-3.5" />
                            บันทึกแล้ว
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              onMarkDecision(alert.id, 'TRADED_MANUAL')
                            }
                            className="px-2.5 py-1.5 rounded bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-emerald-300 whitespace-nowrap cursor-pointer"
                          >
                            กดเทรดเองแล้ว
                          </button>
                        )}
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
