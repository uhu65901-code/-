import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  CheckCircle2,
  RotateCcw,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { assessChartFlowForAiTraining } from '../lib/aiPatternLearner';
import { getCandleMetrics } from '../lib/trendDetector';
import { PatternVerdict, ScannedAssetState, TrendDirection } from '../lib/types';

interface CandlestickChartProps {
  assetState: ScannedAssetState;
  slotLabel?: string;
  isActiveSlot?: boolean;
  compact?: boolean;
  scanWindowBars?: number;
  targetMinCandles?: number;
  targetMaxCandles?: number;
  minMatchScore?: number;
  trainedVerdict?: PatternVerdict | null;
  onTrainAiPattern?: (
    assetState: ScannedAssetState,
    verdict: PatternVerdict,
    forcedDirection?: TrendDirection
  ) => { ok: boolean; message?: string } | Promise<{ ok: boolean; message?: string }>;
  onActivateSlot?: () => void;
  onRetryCandles?: (assetId: string) => void;
}

function formatTime(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatNextMinute(unixSec: number): string {
  const d = new Date((unixSec + 60) * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  assetState,
  slotLabel,
  isActiveSlot = false,
  compact = false,
  scanWindowBars = 15,
  targetMinCandles = 4,
  targetMaxCandles = 6,
  minMatchScore = 86,
  trainedVerdict = null,
  onTrainAiPattern,
  onActivateSlot,
  onRetryCandles,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: compact ? 290 : 440 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const m15DefaultBars = Math.min(20, Math.max(15, Math.round(scanWindowBars)));
  // Interactive Zoom locked within M15 clarity range (8..20 bars) & Pan offset (0 = latest)
  const [zoomBars, setZoomBars] = useState<number>(m15DefaultBars);
  const [panOffset, setPanOffset] = useState<number>(0);
  const [aiFeedbackNotice, setAiFeedbackNotice] = useState<{
    type: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const dragStateRef = useRef<{ startX: number; startPan: number } | null>(null);
  const pinchStateRef = useRef<{ startDist: number; startZoom: number } | null>(null);

  const safeDecimals = Number.isFinite(assetState.asset.decimals)
    ? Math.min(8, Math.max(0, Math.round(assetState.asset.decimals)))
    : 5;

  useEffect(() => {
    setPanOffset(0);
    setAiFeedbackNotice(null);
  }, [assetState.asset.id]);

  useEffect(() => {
    setZoomBars(m15DefaultBars);
    setPanOffset(0);
  }, [m15DefaultBars]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        const w = Math.max(260, Math.floor(rect.width));
        const h = Math.max(240, Math.floor(rect.height));
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    };

    measure();
    const rafId = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 10 && entry.contentRect.height > 10) {
          const w = Math.max(260, Math.floor(entry.contentRect.width));
          const h = Math.max(240, Math.floor(entry.contentRect.height));
          setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
        }
      }
    });
    observer.observe(el);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [assetState.asset.id, assetState.candles.length]);

  const totalLen = assetState.candles.length;
  const maxAllowedZoom = Math.min(20, Math.max(8, totalLen));
  const clampedZoom = Math.min(maxAllowedZoom, Math.max(8, zoomBars));
  const maxPan = Math.max(0, totalLen - clampedZoom);
  const clampedPan = Math.min(maxPan, Math.max(0, panOffset));
  const visibleEnd = totalLen - clampedPan;
  const visibleStart = Math.max(0, visibleEnd - clampedZoom);

  const visibleCandles = assetState.candles.slice(visibleStart, visibleEnd);
  const visibleEma = assetState.analysis.emaValues.slice(visibleStart, visibleEnd);
  const matchedSet = new Set(
    assetState.analysis.matchedIndices
      .map((idx) => idx - visibleStart)
      .filter((i) => i >= 0 && i < visibleCandles.length)
  );
  const signalRelIdx =
    assetState.analysis.signalIndex !== null
      ? assetState.analysis.signalIndex - visibleStart
      : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleCandles.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      const e = visibleEma[i];
      if (Number.isFinite(e)) {
        if (e < minPrice) minPrice = e;
        if (e > maxPrice) maxPrice = e;
      }
    }

    const rawRange = Math.max(maxPrice - minPrice, 1e-8);
    minPrice -= rawRange * 0.14;
    maxPrice += rawRange * 0.14;

    const samplePriceLen = Math.max(
      maxPrice.toFixed(safeDecimals).length,
      minPrice.toFixed(safeDecimals).length
    );
    const padLeft = 14;
    const padRight = Math.max(74, Math.min(106, Math.ceil(samplePriceLen * 7.2) + 18));
    const padTop = 24;
    const padBottom = 32;
    const plotW = Math.max(100, size.width - padLeft - padRight);
    const plotH = Math.max(100, size.height - padTop - padBottom);

    // Deep navy background matching the 9 reference screenshots
    ctx.fillStyle = '#0D1422';
    ctx.fillRect(0, 0, size.width, size.height);

    const priceRange = maxPrice - minPrice;

    const priceToY = (p: number) =>
      padTop + ((maxPrice - p) / priceRange) * plotH;

    const slotW = plotW / Math.max(visibleCandles.length + 1.5, 8);
    const candleW = Math.max(6, Math.min(34, slotW * 0.68));
    const idxToX = (i: number) => padLeft + (i + 0.5) * slotW;

    // Subtle dashed horizontal & vertical grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    const gridRows = 4;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let r = 0; r <= gridRows; r++) {
      const y = padTop + (r / gridRows) * plotH;
      const priceVal = maxPrice - (r / gridRows) * priceRange;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(size.width - padRight, y);
      ctx.stroke();

      ctx.fillStyle = '#94A3B8';
      ctx.fillText(
        priceVal.toFixed(safeDecimals),
        size.width - padRight + 8,
        y
      );
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const maxTimeLabels = Math.max(3, Math.floor(plotW / 68));
    const timeStep = Math.max(3, Math.ceil(visibleCandles.length / maxTimeLabels));
    for (let i = 0; i < visibleCandles.length; i += timeStep) {
      const x = idxToX(i);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      ctx.fillStyle = '#94A3B8';
      ctx.fillText(formatTime(visibleCandles[i].time), x, padTop + plotH + 10);
    }
    ctx.setLineDash([]);

    // Vertical shaded column on the signal / latest closed bar (matching reference screenshots)
    const highlightBarIdx =
      signalRelIdx !== null && signalRelIdx >= 0 && signalRelIdx < visibleCandles.length
        ? signalRelIdx
        : visibleCandles.length >= 2 && clampedPan === 0
          ? visibleCandles.length - 2
          : null;

    if (highlightBarIdx !== null) {
      const hx = idxToX(highlightBarIdx);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.fillRect(hx - slotW * 0.55, padTop, slotW * 1.1, plotH);
    }

    // Subtle shaded trend band across matched 5-6 candle window
    if (matchedSet.size >= 3 && assetState.analysis.direction) {
      const indices = Array.from(matchedSet).sort((a, b) => a - b);
      const firstIdx = indices[0];
      const lastIdx = indices[indices.length - 1];
      const x1 = idxToX(firstIdx) - slotW * 0.45;
      const x2 = idxToX(lastIdx) + slotW * 0.45;
      const isUp = assetState.analysis.direction === 'UP';

      ctx.fillStyle = isUp
        ? 'rgba(22, 199, 132, 0.06)'
        : 'rgba(244, 91, 105, 0.06)';
      ctx.fillRect(x1, padTop, x2 - x1, plotH);
    }

    // Draw Candlesticks
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = idxToX(i);
      const isUp = c.close >= c.open;
      const color = isUp ? '#16C784' : '#F45B69';
      const isForming = clampedPan === 0 && i === visibleCandles.length - 1;

      const yHigh = priceToY(c.high);
      const yLow = priceToY(c.low);
      const yOpen = priceToY(c.open);
      const yClose = priceToY(c.close);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(2, Math.abs(yClose - yOpen));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);

      if (isForming) {
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
      }
    }

    // Signature Warm Yellow/Gold EMA Curve (#F5C451) matching all 9 reference screenshots
    if (visibleEma.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#F5C451';
      ctx.lineWidth = 2.1;
      let startedEma = false;
      for (let i = 0; i < visibleEma.length; i++) {
        const val = visibleEma[i];
        if (!Number.isFinite(val)) continue;
        const x = idxToX(i);
        const y = priceToY(val);
        if (!startedEma) {
          ctx.moveTo(x, y);
          startedEma = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      if (startedEma) ctx.stroke();
    }

    // Signal Price Horizontal Line + Triangle Marker (matching screenshots)
    if (
      (assetState.analysis.status === 'MATCH' ||
        assetState.analysis.status === 'FORMING') &&
      assetState.analysis.signalPrice !== null &&
      assetState.analysis.direction
    ) {
      const sigY = priceToY(assetState.analysis.signalPrice);
      const isUp = assetState.analysis.direction === 'UP';
      const sigColor = isUp ? '#16C784' : '#F45B69';

      ctx.strokeStyle = 'rgba(167, 139, 250, 0.65)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(padLeft, sigY);
      ctx.lineTo(size.width - padRight, sigY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label above/below signal line
      const sigLabel = `${isUp ? 'สัญญาณ CALL' : 'สัญญาณ PUT'} ${assetState.analysis.signalPrice.toFixed(
        safeDecimals
      )} · ${assetState.analysis.runLength} แท่ง`;
      ctx.fillStyle = sigColor;
      ctx.font = '600 11px "IBM Plex Sans Thai", "JetBrains Mono", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(sigLabel, padLeft + 10, Math.max(padTop + 14, sigY - 6));

      // Triangle Marker on signal candle
      if (signalRelIdx !== null && signalRelIdx >= 0 && signalRelIdx < visibleCandles.length) {
        const sx = idxToX(signalRelIdx);
        ctx.fillStyle = sigColor;
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (isUp) {
          ctx.moveTo(sx, sigY + 2);
          ctx.lineTo(sx - 6, sigY + 12);
          ctx.lineTo(sx + 6, sigY + 12);
        } else {
          ctx.moveTo(sx, sigY - 2);
          ctx.lineTo(sx - 6, sigY - 12);
          ctx.lineTo(sx + 6, sigY - 12);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Vertical indigo dashed line on active forming 1m bar
    if (clampedPan === 0) {
      const formingX = idxToX(visibleCandles.length - 1);
      ctx.strokeStyle = 'rgba(129, 140, 248, 0.72)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(formingX, padTop);
      ctx.lineTo(formingX, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Current Price horizontal dashed line + solid green/red right-axis badge
    const lastBar = visibleCandles[visibleCandles.length - 1];
    const lastY = priceToY(lastBar.close);
    const lastIsUp = lastBar.close >= lastBar.open;

    ctx.strokeStyle = lastIsUp
      ? 'rgba(22, 199, 132, 0.6)'
      : 'rgba(244, 91, 105, 0.6)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padLeft, lastY);
    ctx.lineTo(size.width - padRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = lastIsUp ? '#16C784' : '#F45B69';
    ctx.fillRect(size.width - padRight + 2, lastY - 11, padRight - 6, 22);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      lastBar.close.toFixed(safeDecimals),
      size.width - padRight + 6,
      lastY
    );

    // Hover crosshair
    if (hoverIndex !== null && visibleCandles[hoverIndex]) {
      const hx = idxToX(hoverIndex);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, padTop);
      ctx.lineTo(hx, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [
    assetState,
    clampedPan,
    hoverIndex,
    matchedSet,
    safeDecimals,
    signalRelIdx,
    size,
    visibleCandles,
    visibleEma,
  ]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current) {
      const dx = e.clientX - dragStateRef.current.startX;
      const barStep = Math.max(8, size.width / clampedZoom);
      const deltaBars = Math.round(dx / barStep);
      setPanOffset(Math.min(maxPan, Math.max(0, dragStateRef.current.startPan + deltaBars)));
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const sampleLen = assetState.lastPrice.toFixed(safeDecimals).length;
    const padLeft = 14;
    const padRight = Math.max(74, Math.min(106, Math.ceil(sampleLen * 7.2) + 18));
    const plotW = Math.max(100, size.width - padLeft - padRight);
    const slotW = plotW / Math.max(visibleCandles.length + 1.5, 8);
    const idx = Math.floor((x - padLeft) / slotW);
    if (idx >= 0 && idx < visibleCandles.length) {
      setHoverIndex(idx);
    } else {
      setHoverIndex(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 2 : -2;
    setZoomBars((prev) => Math.min(20, Math.max(8, prev + delta)));
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStateRef.current = {
        startDist: Math.hypot(dx, dy),
        startZoom: clampedZoom,
      };
      dragStateRef.current = null;
    } else if (e.touches.length === 1) {
      pinchStateRef.current = null;
      dragStateRef.current = {
        startX: e.touches[0].clientX,
        startPan: clampedPan,
      };
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const sampleLen = assetState.lastPrice.toFixed(safeDecimals).length;
      const padLeft = 14;
      const padRight = Math.max(74, Math.min(106, Math.ceil(sampleLen * 7.2) + 18));
      const plotW = Math.max(100, size.width - padLeft - padRight);
      const slotW = plotW / Math.max(visibleCandles.length + 1.5, 8);
      const idx = Math.floor((x - padLeft) / slotW);
      if (idx >= 0 && idx < visibleCandles.length) {
        setHoverIndex(idx);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && pinchStateRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStateRef.current.startDist > 0) {
        const scale = pinchStateRef.current.startDist / Math.max(10, dist);
        const nextZoom = Math.round(pinchStateRef.current.startZoom * scale);
        setZoomBars(Math.min(20, Math.max(8, nextZoom)));
      }
      return;
    }
    if (e.touches.length === 1 && dragStateRef.current) {
      const dx = e.touches[0].clientX - dragStateRef.current.startX;
      const barStep = Math.max(8, size.width / clampedZoom);
      const deltaBars = Math.round(dx / barStep);
      setPanOffset(Math.min(maxPan, Math.max(0, dragStateRef.current.startPan + deltaBars)));
    }
  };

  const handleTouchEnd = () => {
    dragStateRef.current = null;
    pinchStateRef.current = null;
  };

  const inspectedCandle =
    hoverIndex !== null && visibleCandles[hoverIndex]
      ? visibleCandles[hoverIndex]
      : visibleCandles[visibleCandles.length - 2] ?? visibleCandles[0];
  const inspectedMetrics = inspectedCandle ? getCandleMetrics(inspectedCandle) : null;
  const latestClosedTime =
    assetState.candles.length >= 2
      ? assetState.candles[assetState.candles.length - 1].time
      : Math.floor(Date.now() / 1000);

  const isMatch = assetState.analysis.status === 'MATCH';
  const isForming = assetState.analysis.status === 'FORMING';
  const dir = assetState.analysis.direction;

  const flowPreview = useMemo(
    () =>
      assessChartFlowForAiTraining(
        assetState.candles,
        assetState.analysis.emaValues,
        {
          scanWindowBars: m15DefaultBars,
          targetMinCandles,
          targetMaxCandles,
        }
      ),
    [
      assetState.candles,
      assetState.analysis.emaValues,
      m15DefaultBars,
      targetMinCandles,
      targetMaxCandles,
    ]
  );

  const detectedFlowDir: TrendDirection | null =
    assetState.analysis.direction &&
    assetState.analysis.patternFeatures &&
    assetState.analysis.directionalEfficiency >= 0.58
      ? assetState.analysis.direction
      : flowPreview.ok
        ? flowPreview.direction
        : null;

  const handleTrainClick = async (
    verdict: PatternVerdict,
    forcedDirection?: TrendDirection
  ) => {
    if (!onTrainAiPattern) return;
    const res = await onTrainAiPattern(assetState, verdict, forcedDirection);
    if (res.ok) {
      setAiFeedbackNotice({
        type: 'ok',
        text:
          verdict === 'PASS'
            ? 'บันทึกทรงเทรนด์นี้ลงในอุปกรณ์แล้ว'
            : 'บันทึกว่าไม่ผ่านลงในอุปกรณ์แล้ว',
      });
    } else if (res.message) {
      setAiFeedbackNotice({ type: 'warn', text: res.message });
    }
  };

  return (
    <div
      onClick={onActivateSlot}
      className={`rounded-xl border bg-[#0D1422] flex flex-col overflow-hidden transition-colors ${
        isActiveSlot
          ? 'border-[#3B82F6]'
          : 'border-[#1E293B] hover:border-[#334155]'
      }`}
    >
      {/* Chart Top Bar: Asset Name, OHLC (single mode), Zoom Controls */}
      <div className="px-3.5 py-2 border-b border-[#1A2438] bg-[#0F172A] flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-x-2.5 min-w-0">
          {slotLabel && (
            <span className="font-mono-tabular text-[11px] font-semibold text-[#60A5FA] whitespace-nowrap shrink-0">
              {slotLabel}
            </span>
          )}
          <span className="font-bold text-[#F8FAFC] truncate">
            {assetState.asset.name}
          </span>
          <span
            data-testid="m15-window-badge"
            className="px-1.5 py-0.5 rounded bg-[#162033] border border-[#273652] text-[10px] font-mono-tabular font-semibold text-[#60A5FA] whitespace-nowrap shrink-0"
          >
            M15 · {visibleCandles.length} แท่ง
          </span>
          <span className="text-[#94A3B8] whitespace-nowrap shrink-0">
            {assetState.asset.category === 'BINARY' ? 'Binary' : 'Digital'} · {assetState.asset.payoutPercent}%
          </span>
          {!compact && inspectedCandle && inspectedMetrics && (
            <div className="hidden sm:flex items-center gap-2 font-mono-tabular text-[#94A3B8] whitespace-nowrap">
              <span className="text-[#CBD5E1]">{formatTime(inspectedCandle.time)}</span>
              <span>O {inspectedCandle.open.toFixed(safeDecimals)}</span>
              <span>C {inspectedCandle.close.toFixed(safeDecimals)}</span>
              <span
                className={
                  inspectedMetrics.wickRatio <= 0.25
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }
              >
                ไส้ {(inspectedMetrics.wickRatio * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>

        {/* Zoom Controls (M15 <= 20 bars) */}
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`ซูมเข้ากราฟ ${assetState.asset.name}`}
            onClick={() => setZoomBars((prev) => Math.max(8, prev - 2))}
            className="p-2 md:p-1.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            title="ซูมเข้า (ดูแท่งใกล้ขึ้น)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label={`ซูมออกกราฟ ${assetState.asset.name}`}
            onClick={() =>
              setZoomBars((prev) => Math.min(20, prev + 2))
            }
            className="p-2 md:p-1.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            title="ซูมออก (สูงสุด 20 แท่งในกรอบ M15)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label={`รีเซ็ตการซูม ${assetState.asset.name}`}
            onClick={() => {
              setZoomBars(m15DefaultBars);
              setPanOffset(0);
            }}
            className="p-2 md:p-1.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            title={`รีเซ็ตมุมมอง M15 (${m15DefaultBars} แท่ง)`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Split: Chart Canvas + Broker-Style Right Info Column */}
      <div className="flex flex-col md:flex-row min-w-0">
        <div
          ref={containerRef}
          className={`relative flex-1 min-w-0 bg-[#0D1422] select-none overflow-hidden ${
            compact ? 'h-[250px] sm:h-[270px]' : 'h-[320px] sm:h-[360px] lg:h-[440px]'
          }`}
        >
          {visibleCandles.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2.5 px-4 text-center">
              <div className="text-sm font-medium text-[#CBD5E1]">
                กำลังดึงแท่งเทียน 1 นาทีของ {assetState.asset.name}...
              </div>
              <div className="text-xs text-[#64748B]">
                หากคู่นี้ปิดตลาดหรือยังไม่เปิดเทรด 1 นาที กราฟจะไม่มีแท่งเทียนแสดง
              </div>
              {onRetryCandles && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryCandles(assetState.asset.id);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-xs font-medium text-[#60A5FA] cursor-pointer"
                >
                  ดึงแท่งเทียนอีกครั้ง
                </button>
              )}
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              data-testid={`candlestick-canvas-${assetState.asset.id}`}
              data-visible-bars={visibleCandles.length}
              onMouseDown={(e) => {
                dragStateRef.current = { startX: e.clientX, startPan: clampedPan };
              }}
              onMouseUp={() => {
                dragStateRef.current = null;
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => {
                dragStateRef.current = null;
                setHoverIndex(null);
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onWheel={handleWheel}
              className="w-full h-full block cursor-grab active:cursor-grabbing touch-pan-y"
            />
          )}
        </div>

        {/* Right Info Panel matching user's reference screenshots */}
        <div
          className={`${
            compact ? 'md:w-[175px]' : 'md:w-[210px]'
          } border-t md:border-t-0 md:border-l border-[#1A2438] bg-[#0B111E] p-3 sm:p-3.5 flex flex-row md:flex-col justify-between gap-2.5 sm:gap-3 shrink-0 min-w-0`}
        >
          <div className="space-y-2 min-w-0 flex-1 md:flex-none">
            <div>
              <div className="text-sm font-bold text-[#F8FAFC] truncate">
                {assetState.asset.name}
              </div>
              <div className="text-xs text-[#94A3B8] truncate">
                {assetState.asset.symbol} · 1 นาที
              </div>
            </div>

            <div className="p-2 sm:p-2.5 rounded-lg bg-[#141D2F] border border-[#1E293B]">
              <div className="text-[11px] text-[#94A3B8]">หมดอายุ</div>
              <div className="text-base sm:text-lg font-bold font-mono-tabular text-[#F8FAFC]">
                {formatNextMinute(latestClosedTime)}
              </div>
              <div className="text-[11px] font-mono-tabular text-amber-300 mt-0.5">
                จบแท่งใน {String(assetState.secondsRemaining).padStart(2, '0')} วิ
              </div>
            </div>

            <div className="hidden md:block text-xs space-y-1 text-[#94A3B8]">
              <div className="flex justify-between">
                <span>เข้าเงื่อนไข</span>
                <span
                  className={`font-mono-tabular font-semibold ${
                    assetState.analysis.matchScore >= minMatchScore
                      ? 'text-[#16C784]'
                      : 'text-[#E2E8F0]'
                  }`}
                >
                  {assetState.analysis.matchScore}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>ชุดเทรนด์</span>
                <span className="font-mono-tabular text-[#E2E8F0]">
                  {assetState.analysis.runLength} แท่ง
                </span>
              </div>
              <div className="flex justify-between">
                <span>ไส้เฉลี่ย</span>
                <span className="font-mono-tabular text-emerald-400">
                  {(assetState.analysis.avgWickRatio * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>สม่ำเสมอ</span>
                <span className="font-mono-tabular text-[#E2E8F0]">
                  {assetState.analysis.uniformityScore}/100
                </span>
              </div>
              {assetState.analysis.aiSimilarityScore !== undefined && (
                <div className="flex justify-between">
                  <span>ความคล้าย AI</span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      assetState.analysis.aiSimilarityScore >= 75
                        ? 'text-indigo-300'
                        : 'text-[#94A3B8]'
                    }`}
                  >
                    {assetState.analysis.aiSimilarityScore}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Reference CALL/PUT Indicator Card + AI Pattern Training Buttons */}
          <div className="flex flex-col gap-2 flex-1 min-w-0 sm:flex-none sm:min-w-[140px] md:w-full">
            <div
              className={`p-2.5 sm:p-3 rounded-lg flex flex-col items-center justify-center text-center w-full ${
                isMatch && dir === 'UP'
                  ? 'bg-[#16C784] text-[#052E16]'
                  : isMatch && dir === 'DOWN'
                    ? 'bg-[#F45B69] text-white'
                    : isForming && dir === 'UP'
                      ? 'bg-emerald-950/70 border border-emerald-500/40 text-emerald-300'
                      : isForming && dir === 'DOWN'
                        ? 'bg-rose-950/70 border border-rose-500/40 text-rose-300'
                        : 'bg-[#141D2F] border border-[#1E293B] text-[#94A3B8]'
              }`}
            >
              {isMatch && dir === 'UP' && (
                <>
                  <div className="text-sm font-bold flex items-center gap-1">
                    <ArrowUp className="w-4 h-4 shrink-0" />
                    <span>CALL (ซื้อ)</span>
                  </div>
                  <div className="text-[11px] font-medium mt-0.5">
                    เข้า {assetState.analysis.matchScore}% · {assetState.analysis.runLength} แท่ง
                  </div>
                </>
              )}
              {isMatch && dir === 'DOWN' && (
                <>
                  <div className="text-sm font-bold flex items-center gap-1">
                    <ArrowDown className="w-4 h-4 shrink-0" />
                    <span>PUT (ขาย)</span>
                  </div>
                  <div className="text-[11px] font-medium mt-0.5">
                    เข้า {assetState.analysis.matchScore}% · {assetState.analysis.runLength} แท่ง
                  </div>
                </>
              )}
              {isForming && (
                <>
                  <div className="text-xs font-semibold">
                    ก่อตัว {assetState.analysis.runLength} แท่ง ({assetState.analysis.matchScore}%)
                  </div>
                  <div className="text-[11px] mt-0.5">
                    รอครบ{' '}
                    {targetMinCandles === targetMaxCandles
                      ? `${targetMinCandles}`
                      : `${targetMinCandles}–${targetMaxCandles}`}{' '}
                    แท่ง
                  </div>
                </>
              )}
              {!isMatch && !isForming && (
                <>
                  <div className="text-xs font-medium">รอสัญญาณ</div>
                  <div className="text-[11px] mt-0.5">
                    {assetState.analysis.reasons[0]?.includes('ไซด์เวย์')
                      ? 'กราฟไซด์เวย์'
                      : `คัดเฉพาะ ≥ ${minMatchScore}% (${assetState.analysis.matchScore}%)`}
                  </div>
                </>
              )}
            </div>

            {onTrainAiPattern && assetState.candles.length >= 8 && (
              <div
                className="p-2 rounded-lg bg-[#101829] border border-[#1E293B] space-y-1.5 w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span className="inline-flex items-center gap-1 font-semibold text-indigo-300">
                    <Brain className="w-3 h-3 shrink-0" />
                    <span>สอน AI (เฉพาะขึ้น/ลง)</span>
                  </span>
                  {detectedFlowDir ? (
                    <span
                      className={`font-semibold ${
                        detectedFlowDir === 'UP'
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {detectedFlowDir === 'UP' ? 'เทรนด์ขึ้น' : 'เทรนด์ลง'}
                    </span>
                  ) : (
                    <span className="text-amber-300">ไซด์เวย์</span>
                  )}
                </div>

                {detectedFlowDir ? (
                  <div className="flex items-center gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => handleTrainClick('PASS', detectedFlowDir)}
                      aria-label={`ผ่าน (${detectedFlowDir === 'UP' ? 'ขึ้น' : 'ลง'}) · สอน AI ${assetState.asset.name}`}
                      className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1 border transition-colors cursor-pointer whitespace-nowrap ${
                        trainedVerdict === 'PASS'
                          ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                          : 'bg-[#14231F] hover:bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      }`}
                      title="สอน AI ว่ากราฟไหลเป็นเทรนด์แบบนี้คือผ่านเงื่อนไข (เก็บในอุปกรณ์)"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {trainedVerdict === 'PASS'
                          ? 'ผ่านแล้ว'
                          : `ผ่าน (${detectedFlowDir === 'UP' ? 'ขึ้น' : 'ลง'})`}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTrainClick('REJECT', detectedFlowDir)}
                      aria-label={`ไม่ผ่าน ทรงกราฟ ${assetState.asset.name}`}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-medium inline-flex items-center justify-center gap-1 border transition-colors cursor-pointer whitespace-nowrap ${
                        trainedVerdict === 'REJECT'
                          ? 'bg-rose-500/25 border-rose-400 text-rose-200'
                          : 'bg-[#141D2F] hover:bg-rose-500/15 border-[#273652] text-[#94A3B8] hover:text-rose-300'
                      }`}
                      title="บอก AI ว่าทรงแบบนี้ยังไม่ผ่าน"
                    >
                      <XCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>ไม่ผ่าน</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-[10px] leading-snug text-[#94A3B8]">
                      กราฟนี้ยังไม่เป็นเทรนด์ไหลขึ้น/ลงชัดเจน (AI ไม่รับสอนกราฟไซด์เวย์)
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => handleTrainClick('PASS', 'UP')}
                        aria-label={`สอนเทรนด์ขึ้น · ${assetState.asset.name}`}
                        className="py-1 px-1.5 rounded bg-[#141D2F] hover:bg-emerald-500/15 border border-[#273652] text-[10px] font-medium text-emerald-300 cursor-pointer whitespace-nowrap"
                      >
                        สอนเทรนด์ขึ้น
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTrainClick('PASS', 'DOWN')}
                        aria-label={`สอนเทรนด์ลง · ${assetState.asset.name}`}
                        className="py-1 px-1.5 rounded bg-[#141D2F] hover:bg-rose-500/15 border border-[#273652] text-[10px] font-medium text-rose-300 cursor-pointer whitespace-nowrap"
                      >
                        สอนเทรนด์ลง
                      </button>
                    </div>
                  </div>
                )}

                {aiFeedbackNotice && (
                  <div
                    className={`text-[10px] leading-snug px-1.5 py-1 rounded ${
                      aiFeedbackNotice.type === 'ok'
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    {aiFeedbackNotice.text}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
