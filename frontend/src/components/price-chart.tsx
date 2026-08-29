"use client";

/**
 * Oracle price chart — TradingView's lightweight-charts on Somnia's own feed.
 *
 * The library is TradingView's open-source engine, NOT their embed widget. The
 * widget would render Binance's book: identical to look at, and meaningless
 * here, because the number that settles an Event Contract is the one Somnia's
 * oracle wrote on-chain. Every candle below came from that oracle.
 *
 * Styled to the house rules rather than the library defaults: no rounded
 * corners, no drop shadow, one accent, hairline structural borders, tabular
 * mono on both axes. The default lightweight-charts look is a light-mode grid
 * with rounded crosshair labels and would read as a bolted-on widget.
 */

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { Candle, LivePrice, Timeframe } from "@sdk/venue/prices";
import { cx } from "./ui";

const ACCENT = "#4d7cfe";
const UP = "#00ff88";
const DOWN = "#ff3b3b";
const LINE = "#222222";
const INK3 = "#888888";
const BASE = "#050505";

export function PriceChart({
  candles,
  live,
  asset,
  timeframe,
  strike,
  height = 320,
  onTimeframe,
}: {
  candles: Candle[];
  live: LivePrice | null;
  asset: string;
  timeframe: Timeframe;
  /** Draws the bound Event Contract's strike as a horizontal reference. */
  strike?: number | null;
  height?: number;
  onTimeframe?: (t: Timeframe) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || candles.length === 0) return;

    const chart = createChart(host, {
      width: host.clientWidth,
      height,
      layout: {
        background: { color: BASE },
        textColor: INK3,
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: LINE, style: 1 },
        horzLines: { color: LINE, style: 1 },
      },
      rightPriceScale: { borderColor: LINE, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: LINE, timeVisible: true, secondsVisible: false },
      crosshair: {
        // Sharp 1px crosshair, no rounded label pills.
        mode: 0,
        vertLine: { color: ACCENT, width: 1, style: 2, labelBackgroundColor: "#16233f" },
        horzLine: { color: ACCENT, width: 1, style: 2, labelBackgroundColor: "#16233f" },
      },
      handleScale: { axisPressedMouseMove: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      // Hollow-up / filled-down reads better at this density than two solids.
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      priceLineColor: ACCENT,
      priceLineStyle: 2,
    });

    series.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    // The bound contract's strike: the level that decides YES vs NO.
    if (strike != null && Number.isFinite(strike)) {
      series.createPriceLine({
        price: strike,
        color: ACCENT,
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: "STRIKE",
      });
    }

    chart.timeScale().fitContent();

    const move = chart.subscribeCrosshairMove((p) => {
      if (!p.time) return setHover(null);
      const t = Number(p.time);
      setHover(candles.find((c) => c.time === t) ?? null);
    });

    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0) chart.applyOptions({ width: host.clientWidth });
    });
    ro.observe(host);

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      ro.disconnect();
      void move;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [candles, height, strike]);

  const last = candles.at(-1);
  const first = candles[0];
  const change = last && first ? last.close / first.open - 1 : 0;
  const shown = hover ?? last;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-label-xs uppercase text-ink-3">
            {asset} oracle
          </span>
          <span className="num text-[17px] text-ink">
            {live
              ? live.price.toLocaleString("en-US", { minimumFractionDigits: 2 })
              : shown
                ? shown.close.toLocaleString("en-US", { minimumFractionDigits: 2 })
                : "—"}
          </span>
          <span
            className={cx("num text-[12px]", change >= 0 ? "text-up" : "text-down")}
          >
            {change >= 0 ? "+" : ""}
            {(change * 100).toFixed(2)}%
          </span>
        </div>

        {onTimeframe ? (
          <div className="flex items-stretch border border-line h-7">
            {(["1m", "1h", "1d"] as Timeframe[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onTimeframe(t)}
                aria-pressed={t === timeframe}
                className={cx(
                  "px-2.5 text-[11px] uppercase tracking-[0.05em] transition-colors",
                  t === timeframe
                    ? "bg-[#16233f] text-accent"
                    : "text-ink-3 hover:text-ink hover:bg-surface-2",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {candles.length === 0 ? (
        <div
          style={{ height }}
          className="flex items-center justify-center border border-line bg-base text-[12px] text-ink-3"
        >
          Oracle returned no candles for this window.
        </div>
      ) : (
        <div ref={hostRef} className="w-full border border-line" style={{ height }} />
      )}

      {/* Readout outside the canvas so it can never be clipped by the plot. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2 h-5">
        <span className="text-[11px] text-ink-4">
          {candles.length} candles · Somnia EMA oracle
          {live?.blockNumber ? (
            <>
              {" · block "}
              <span className="num text-ink-3">
                {live.blockNumber.toLocaleString("en-US")}
              </span>
            </>
          ) : null}
        </span>
        {shown ? (
          <span className="num text-[11px] text-ink-3">
            O {shown.open.toFixed(2)} · H {shown.high.toFixed(2)} · L{" "}
            {shown.low.toFixed(2)} · C {shown.close.toFixed(2)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
