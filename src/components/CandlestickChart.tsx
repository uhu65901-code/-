import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { getCandleMetrics } from '../lib/trendDetector';
import { ScannedAssetState } from '../lib/types';

interface CandlestickChartProps {
  assetState: ScannedAssetState;
  slotLabel?: string;
  isActiveSlot?: boolean;
  compact?: boolean;
  onActivateSlot?: () => void;
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
  onActivateSlot,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: compact ? 290 : 440 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Interactive Zoom (number of visible bars: 12..60) & Pan offset (0 = latest)
  const [zoomBars, setZoomBars] = useState<number>(compact ? 24 : 30);
  const [panOffset, setPanOffset] = useState<number>(0);
  const dragStateRef = useRef<{ startX: number; startPan: number } | null>(null);
  const pinchStateRef = useRef<{ startDist: number; startZoom: number } | null>(null);

  useEffect(() => {
    setPanOffset(0);
  }, [assetState.asset.id]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(260, Math.floor(entry.contentRect.width));
        const h = Math.max(240, Math.floor(entry.contentRect.height));
        setSize({ width: w, height: h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totalLen = assetState.candles.length;
  const clampedZoom = Math.min(Math.max(12, zoomBars), Math.max(12, totalLen));
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
      maxPrice.toFixed(assetState.asset.decimals).length,
      minPrice.toFixed(assetState.asset.decimals).length
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

    const slotW = plotW / Math.max(visibleCandles.length + 2, 10);
    const candleW = Math.max(4, Math.min(24, slotW * 0.64));
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
        priceVal.toFixed(assetState.asset.decimals),
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
      for (let i = 0; i < visibleEma.length; i++) {
        const x = idxToX(i);
        const y = priceToY(visibleEma[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
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
        assetState.asset.decimals
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
      lastBar.close.toFixed(assetState.asset.decimals),
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
    const sampleLen = assetState.lastPrice.toFixed(assetState.asset.decimals).length;
    const padLeft = 14;
    const padRight = Math.max(74, Math.min(106, Math.ceil(sampleLen * 7.2) + 18));
    const plotW = Math.max(100, size.width - padLeft - padRight);
    const slotW = plotW / Math.max(visibleCandles.length + 2, 10);
    const idx = Math.floor((x - padLeft) / slotW);
    if (idx >= 0 && idx < visibleCandles.length) {
      setHoverIndex(idx);
    } else {
      setHoverIndex(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 4 : -4;
    setZoomBars((prev) => Math.min(Math.max(12, prev + delta), Math.max(12, totalLen)));
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
      const sampleLen = assetState.lastPrice.toFixed(assetState.asset.decimals).length;
      const padLeft = 14;
      const padRight = Math.max(74, Math.min(106, Math.ceil(sampleLen * 7.2) + 18));
      const plotW = Math.max(100, size.width - padLeft - padRight);
      const slotW = plotW / Math.max(visibleCandles.length + 2, 10);
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
        setZoomBars(Math.min(Math.max(12, nextZoom), Math.max(12, totalLen)));
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
          <span className="text-[#94A3B8] whitespace-nowrap shrink-0">
            {assetState.asset.category === 'BINARY' ? 'Binary' : 'Digital'} · {assetState.asset.payoutPercent}%
          </span>
          {!compact && inspectedCandle && inspectedMetrics && (
            <div className="hidden sm:flex items-center gap-2 font-mono-tabular text-[#94A3B8] whitespace-nowrap">
              <span className="text-[#CBD5E1]">{formatTime(inspectedCandle.time)}</span>
              <span>O {inspectedCandle.open.toFixed(assetState.asset.decimals)}</span>
              <span>C {inspectedCandle.close.toFixed(assetState.asset.decimals)}</span>
              <span
                className={
                  inspectedMetrics.wickRatio <= 0.26
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                }
              >
                ไส้ {(inspectedMetrics.wickRatio * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>

        {/* Zoom Controls */}
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`ซูมเข้ากราฟ ${assetState.asset.name}`}
            onClick={() => setZoomBars((prev) => Math.max(12, prev - 5))}
            className="p-2 md:p-1.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            title="ซูมเข้า (ดูแท่งใกล้ขึ้น)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label={`ซูมออกกราฟ ${assetState.asset.name}`}
            onClick={() =>
              setZoomBars((prev) => Math.min(Math.max(12, totalLen), prev + 5))
            }
            className="p-2 md:p-1.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            title="ซูมออก (ดูแท่งกว้างขึ้น)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label={`รีเซ็ตการซูม ${assetState.asset.name}`}
            onClick={() => {
              setZoomBars(compact ? 24 : 30);
              setPanOffset(0);
            }}
            className="p-2 md:p-1.5 rounded bg-[#162033] hover:bg-[#1E2B44] border border-[#273652] text-[#CBD5E1] cursor-pointer"
            title="รีเซ็ตมุมมอง"
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
          <canvas
            ref={canvasRef}
            data-testid={`candlestick-canvas-${assetState.asset.id}`}
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
        </div>

        {/* Right Info Panel matching user's 9 attached screenshots */}
        <div
          className={`${
            compact ? 'md:w-[175px]' : 'md:w-[210px]'
          } border-t md:border-t-0 md:border-l border-[#1A2438] bg-[#0B111E] p-3.5 flex flex-row md:flex-col justify-between gap-3 shrink-0`}
        >
          <div className="space-y-2.5">
            <div>
              <div className="text-sm font-bold text-[#F8FAFC] truncate">
                {assetState.asset.name}
              </div>
              <div className="text-xs text-[#94A3B8]">
                {assetState.asset.symbol} · 1 นาที
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#141D2F] border border-[#1E293B]">
              <div className="text-[11px] text-[#94A3B8]">หมดอายุ</div>
              <div className="text-lg font-bold font-mono-tabular text-[#F8FAFC]">
                {formatNextMinute(latestClosedTime)}
              </div>
              <div className="text-[11px] font-mono-tabular text-amber-300 mt-0.5">
                จบแท่งใน {String(assetState.secondsRemaining).padStart(2, '0')} วิ
              </div>
            </div>

            <div className="hidden md:block text-xs space-y-1 text-[#94A3B8]">
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
            </div>
          </div>

          {/* Reference CALL/PUT Indicator Card (Manual decision only, matching screenshot bottom-right block) */}
          <div
            className={`p-3 rounded-lg flex flex-col items-center justify-center text-center shrink-0 min-w-[130px] ${
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
                  <ArrowUp className="w-4 h-4" />
                  <span>CALL (ซื้อ)</span>
                </div>
                <div className="text-[11px] font-medium mt-0.5">
                  เข้าเกณฑ์ {assetState.analysis.runLength} แท่ง · กดเอง
                </div>
              </>
            )}
            {isMatch && dir === 'DOWN' && (
              <>
                <div className="text-sm font-bold flex items-center gap-1">
                  <ArrowDown className="w-4 h-4" />
                  <span>PUT (ขาย)</span>
                </div>
                <div className="text-[11px] font-medium mt-0.5">
                  เข้าเกณฑ์ {assetState.analysis.runLength} แท่ง · กดเอง
                </div>
              </>
            )}
            {isForming && (
              <>
                <div className="text-xs font-semibold">
                  ก่อตัว {assetState.analysis.runLength} แท่ง
                </div>
                <div className="text-[11px] mt-0.5">รอครบ 5–6 แท่ง</div>
              </>
            )}
            {!isMatch && !isForming && (
              <>
                <div className="text-xs font-medium">รอสัญญาณ</div>
                <div className="text-[11px] mt-0.5">ยังไม่เข้า 5–6 แท่ง</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
