import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2, TrendingUp, XCircle } from 'lucide-react';
import { computePerformanceStats, deduplicateAlertsByAsset } from '../lib/performanceStats';
import { DecisionRecord, ScannerConfig, TradeOutcome, TrendAlert } from '../lib/types';

interface PerformanceAnalyticsPanelProps {
  alerts: TrendAlert[];
  decisionRecords: DecisionRecord[];
  config: ScannerConfig;
  onRecordOutcome: (
    alertId: string,
    decision: 'WATCHED' | 'TRADED_MANUAL' | 'SKIPPED',
    tradeOutcome?: TradeOutcome
  ) => void;
}

const STAKE_PRESETS = [50, 100, 300, 500, 1000] as const;

export const PerformanceAnalyticsPanel: React.FC<PerformanceAnalyticsPanelProps> = ({
  alerts,
  decisionRecords,
  config,
  onRecordOutcome,
}) => {
  const [stake, setStake] = useState<number>(100);

  const summary = useMemo(
    () => computePerformanceStats(decisionRecords, alerts, stake),
    [decisionRecords, alerts, stake]
  );

  const uniqueRecentAlerts = useMemo(
    () => deduplicateAlertsByAsset(alerts).slice(0, 12),
    [alerts]
  );

  const combinedComparisonData = useMemo(() => {
    return [
      ...summary.directionBreakdown.map((d) => ({
        name: d.name,
        winRate: d.winRate,
        total: d.wins + d.losses,
        wins: d.wins,
        losses: d.losses,
        color: d.name.includes('CALL') ? '#16C784' : '#F45B69',
      })),
      ...summary.scoreBandBreakdown.map((s) => ({
        name: `เกณฑ์ ${s.band}`,
        winRate: s.winRate,
        total: s.wins + s.losses,
        wins: s.wins,
        losses: s.losses,
        color: s.band === '95–100%' ? '#3B82F6' : '#F5C451',
      })),
    ];
  }, [summary]);

  const hasChartPoints = summary.equitySeries.length > 0;

  return (
    <div className="space-y-5" data-testid="performance-analytics-panel">
      {/* Top Controls & Current Threshold Summary */}
      <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[#F8FAFC] flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#3B82F6]" />
            <span>ประเมินความแม่นยำ Win Rate และกำไรสุทธิตามเกณฑ์ที่เลือก</span>
          </h2>
          <p className="mt-1 text-xs text-[#94A3B8]">
            เกณฑ์ปัจจุบัน: คะแนนเข้าเงื่อนไข ≥ {config.minMatchScore}% · เทียบย้อนหลัง{' '}
            {config.targetMinCandles === config.targetMaxCandles
              ? `${config.targetMinCandles} แท่ง`
              : `${config.targetMinCandles}–${config.targetMaxCandles} แท่ง`}{' '}
            · ไส้เทียน ≤ {Math.round(config.maxWickRatio * 100)}%
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="stake-amount-input" className="text-xs text-[#94A3B8]">
            เงินต่อไม้:
          </label>
          <input
            id="stake-amount-input"
            type="number"
            min={1}
            max={1000000}
            value={stake}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) setStake(v);
            }}
            className="w-24 px-2.5 py-1.5 text-xs font-mono-tabular bg-[#0B111E] border border-[#23304A] rounded-lg text-[#F8FAFC] focus:outline-none focus:border-[#3B82F6]"
          />
          <div className="flex items-center gap-1">
            {STAKE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setStake(preset)}
                className={`px-2 py-1 text-[11px] font-mono-tabular rounded border transition-colors cursor-pointer ${
                  stake === preset
                    ? 'bg-[#2563EB] border-[#3B82F6] text-white'
                    : 'bg-[#0B111E] border-[#1E293B] text-[#94A3B8] hover:text-[#E2E8F0]'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-4">
          <div className="text-xs text-[#94A3B8]">Win Rate รวม</div>
          <div
            data-testid="kpi-win-rate"
            className={`mt-1 text-2xl font-bold font-mono-tabular ${
              summary.winRate >= 60
                ? 'text-[#16C784]'
                : summary.tradedCount > 0 && summary.winRate < 50
                  ? 'text-[#F45B69]'
                  : 'text-[#F8FAFC]'
            }`}
          >
            {summary.winRate.toFixed(1)}%
          </div>
          <div className="mt-1 text-[11px] text-[#64748B]">
            ชนะ {summary.wins} · แพ้ {summary.losses}
            {summary.draws > 0 ? ` · เสมอ ${summary.draws}` : ''}
          </div>
        </div>

        <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-4">
          <div className="text-xs text-[#94A3B8]">กำไร/ขาดทุนสุทธิจำลอง</div>
          <div
            data-testid="kpi-net-profit"
            className={`mt-1 text-2xl font-bold font-mono-tabular ${
              summary.netProfit > 0
                ? 'text-[#16C784]'
                : summary.netProfit < 0
                  ? 'text-[#F45B69]'
                  : 'text-[#F8FAFC]'
            }`}
          >
            {summary.netProfit >= 0 ? '+' : ''}
            {summary.netProfit.toLocaleString('en-US', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="mt-1 text-[11px] text-[#64748B]">
            ROI {summary.roiPercent >= 0 ? '+' : ''}
            {summary.roiPercent.toFixed(1)}% จาก {summary.tradedCount} ไม้
          </div>
        </div>

        <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-4">
          <div className="text-xs text-[#94A3B8]">บันทึกการตัดสินใจทั้งหมด</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#F8FAFC]">
            {summary.totalDecisions}
          </div>
          <div className="mt-1 text-[11px] text-[#64748B]">
            กดเทรด {summary.tradedCount} · ข้าม {summary.skippedCount}
          </div>
        </div>

        <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-4">
          <div className="text-xs text-[#94A3B8]">ความเข้มเกณฑ์คัดกรอง</div>
          <div className="mt-1 text-2xl font-bold font-mono-tabular text-[#60A5FA]">
            ≥ {config.minMatchScore}%
          </div>
          <div className="mt-1 text-[11px] text-[#64748B]">
            คู่รอเลือกในประวัติ {summary.totalAlerts} คู่ (ไม่ซ้ำ)
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Equity Curve & Running Win Rate (Recharts AreaChart) */}
        <div className="lg:col-span-2 border border-[#1D273B] rounded-xl bg-[#0D1422] p-4 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-[#F8FAFC] flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-[#16C784]" />
                <span>กราฟกำไรสะสม (Profit Curve) ตามลำดับการตัดสินใจ</span>
              </h3>
              <p className="text-[11px] text-[#94A3B8]">
                คำนวณจาก % Payout จริงของแต่ละคู่สินทรัพย์และผล ชนะ/แพ้ ที่คุณบันทึกไว้
              </p>
            </div>
          </div>

          <div className="h-[250px] w-full min-w-0" data-testid="profit-chart-container">
            {hasChartPoints ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={summary.equitySeries}
                  margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#16C784" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#16C784" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis
                    dataKey="index"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickFormatter={(v) => `#${v}`}
                    stroke="#23304A"
                  />
                  <YAxis
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    stroke="#23304A"
                    width={52}
                  />
                  <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0B111E',
                      borderColor: '#273652',
                      borderRadius: '0.5rem',
                      fontSize: '12px',
                      color: '#F8FAFC',
                    }}
                    formatter={(value: unknown, name: unknown) => {
                      const num = Number(value ?? 0);
                      if (name === 'cumulativeProfit') {
                        return [
                          `${num >= 0 ? '+' : ''}${num.toFixed(2)}`,
                          'กำไรสะสม',
                        ];
                      }
                      return [`${num.toFixed(1)}%`, 'Win Rate สะสม'];
                    }}
                    labelFormatter={(_, payload) => {
                      const pt = payload?.[0]?.payload;
                      if (!pt) return '';
                      return `ไม้ที่ #${pt.index} · ${pt.assetName} (${
                        pt.outcome === 'WIN' ? 'ชนะ' : pt.outcome === 'LOSS' ? 'แพ้' : 'เสมอ'
                      })`;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeProfit"
                    stroke="#16C784"
                    strokeWidth={2.2}
                    fill="url(#profitGradient)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full rounded-lg border border-dashed border-[#23304A] bg-[#0B111E] flex flex-col items-center justify-center p-6 text-center">
                <p className="text-xs font-medium text-[#CBD5E1]">
                  ยังไม่มีผลเทรดที่บันทึกเป็น ชนะ (WIN) หรือ แพ้ (LOSS)
                </p>
                <p className="mt-1 text-[11px] text-[#64748B]">
                  กดปุ่ม &quot;ชนะ (WIN)&quot; หรือ &quot;แพ้ (LOSS)&quot; ด้านล่างหรือในแท็บประวัติแจ้งเตือนเพื่อสร้างกราฟทันที
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Win Rate by Direction & Match Score Band (Recharts BarChart) */}
        <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] p-4 flex flex-col">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">
              เทียบ Win Rate ตามทิศทาง &amp; ช่วงคะแนน
            </h3>
            <p className="text-[11px] text-[#94A3B8]">
              ดูว่า CALL/PUT และช่วงคะแนน 90–94% กับ 95–100% แบบใดแม่นกว่า
            </p>
          </div>

          <div className="h-[250px] w-full min-w-0" data-testid="winrate-bar-container">
            {hasChartPoints ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={combinedComparisonData}
                  margin={{ top: 8, right: 20, left: 6, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    tickFormatter={(v) => `${v}%`}
                    stroke="#23304A"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={96}
                    tick={{ fill: '#CBD5E1', fontSize: 11 }}
                    stroke="#23304A"
                  />
                  <ReferenceLine x={60} stroke="#334155" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0B111E',
                      borderColor: '#273652',
                      borderRadius: '0.5rem',
                      fontSize: '12px',
                      color: '#F8FAFC',
                    }}
                    formatter={(value: unknown, _name: unknown, item) => {
                      const p = item?.payload;
                      return [
                        `${Number(value ?? 0).toFixed(1)}% (ชนะ ${p?.wins ?? 0} / แพ้ ${
                          p?.losses ?? 0
                        })`,
                        'Win Rate',
                      ];
                    }}
                  />
                  <Bar dataKey="winRate" barSize={22} radius={[0, 6, 6, 0]} isAnimationActive={false}>
                    {combinedComparisonData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full rounded-lg border border-dashed border-[#23304A] bg-[#0B111E] flex items-center justify-center p-6 text-center">
                <p className="text-[11px] text-[#64748B]">
                  กราฟแท่งเปรียบเทียบ Win Rate จะแสดงอัตโนมัติเมื่อมีการบันทึกผลเทรดอย่างน้อย 1 ไม้
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Decision Outcome Logger */}
      <div className="border border-[#1D273B] rounded-xl bg-[#0D1422] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1A2438] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#F8FAFC]">
              บันทึกผลการเทรดล่าสุดเพื่ออัปเดตกราฟ Win Rate
            </h3>
            <p className="text-[11px] text-[#94A3B8]">
              เลือกบันทึก ชนะ / แพ้ / ข้าม สำหรับคู่ที่เข้าเกณฑ์ล่าสุด (ไม่มีชื่อซ้ำกัน)
            </p>
          </div>
        </div>

        {uniqueRecentAlerts.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#64748B]">
            ยังไม่มีสัญญาณที่เข้าเกณฑ์ {config.minMatchScore}%+ ในขณะนี้
          </div>
        ) : (
          <div className="divide-y divide-[#162033]">
            {uniqueRecentAlerts.map((alert) => {
              const isUp = alert.direction === 'UP';
              const score = alert.matchScore ?? alert.uniformityScore;
              return (
                <div
                  key={alert.id}
                  className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-[#11192B]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-semibold text-[#F8FAFC] truncate">
                      {alert.assetName}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 font-medium ${
                        isUp ? 'text-[#16C784]' : 'text-[#F45B69]'
                      }`}
                    >
                      {isUp ? (
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5" />
                      )}
                      {isUp ? 'CALL' : 'PUT'}
                    </span>
                    <span className="font-mono-tabular px-2 py-0.5 rounded bg-[#162033] text-[#60A5FA]">
                      {score}%
                    </span>
                    <span className="text-[#64748B] font-mono-tabular">
                      Payout {alert.payoutPercent}%
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onRecordOutcome(alert.id, 'TRADED_MANUAL', 'WIN')
                      }
                      className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 border cursor-pointer transition-colors ${
                        alert.tradeOutcome === 'WIN'
                          ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                          : 'bg-emerald-600/10 hover:bg-emerald-600/20 border-emerald-500/30 text-emerald-300'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>ชนะ (WIN)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onRecordOutcome(alert.id, 'TRADED_MANUAL', 'LOSS')
                      }
                      className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1 border cursor-pointer transition-colors ${
                        alert.tradeOutcome === 'LOSS'
                          ? 'bg-rose-500/25 border-rose-400 text-rose-200'
                          : 'bg-rose-600/10 hover:bg-rose-600/20 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>แพ้ (LOSS)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRecordOutcome(alert.id, 'SKIPPED')}
                      className={`px-2.5 py-1 rounded text-xs font-medium border cursor-pointer transition-colors ${
                        alert.decisionNote === 'SKIPPED'
                          ? 'bg-[#273652] border-[#475569] text-[#F8FAFC]'
                          : 'bg-[#162033] hover:bg-[#1E2B44] border-[#273652] text-[#94A3B8]'
                      }`}
                    >
                      ข้าม
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
