/**
 * Den Analyzer walk-forward backtest (server only).
 *
 * Correctness rule: at every simulated step the engine is handed a snapshot
 * that contains ONLY candles whose time is <= the current step candle's time,
 * on EVERY timeframe. No future candle is ever visible to the analysis. The
 * future is only used afterwards, to resolve the outcome of a recorded setup.
 *
 * This file does not modify the live analyser — it reuses runDenAnalysis.
 */
import { CHECKLIST_BY_KEY } from "./analysis-types";
import { runDenAnalysis, type DenSeries } from "./den-analyzer.server";
import { DEN_COMPONENT_KEYS } from "./den-rules";
import type { Candle } from "./market.server";

export interface BacktestInput {
  symbol: string;
  /** Same shape as DenInput.series — highest timeframe first. */
  series: DenSeries[];
  /** The timeframe whose candle closes advance the simulation clock. */
  stepTimeframe: string;
  minRR: number;
  requireVolume: boolean;
  strictMode: boolean;
  rules?: unknown;
  /** Bars skipped before the first simulated analysis. */
  warmup?: number;
  /** How many future step candles a setup may take to resolve. */
  maxLookout?: number;
}

export type BacktestOutcome = "TP1" | "TP2" | "STOP" | "UNRESOLVED";

export interface BacktestSetup {
  time: string;
  direction: "POTENTIAL LONG" | "POTENTIAL SHORT";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number | null;
  score: number;
  grade: string;
  riskReward: number | null;
  /** Checklist components that actually scored at that moment. */
  components: { key: string; score: number }[];
  outcome: BacktestOutcome;
  /** Realized R: -1 on a stop, reward/risk on a target, null when unresolved. */
  realizedR: number | null;
  resolvedAt: string | null;
  barsToResolve: number | null;
}

export interface BacktestBucket {
  label: string;
  setups: number;
  resolved: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
}

export interface BacktestResult {
  symbol: string;
  stepTimeframe: string;
  timeframes: string[];
  steps: number;
  from: string | null;
  to: string | null;
  totalSetups: number;
  resolved: number;
  unresolved: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number;
  byDirection: BacktestBucket[];
  byScore: BacktestBucket[];
  setups: BacktestSetup[];
}

function priceOf(value: string | null): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bucket(label: string, list: BacktestSetup[]): BacktestBucket {
  const resolved = list.filter((s) => s.outcome !== "UNRESOLVED");
  const wins = resolved.filter((s) => s.outcome !== "STOP").length;
  const rs = resolved.map((s) => s.realizedR ?? 0);
  return {
    label,
    setups: list.length,
    resolved: resolved.length,
    wins,
    winRate: resolved.length ? (wins / resolved.length) * 100 : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
  };
}

function scoreBucketLabel(score: number): string {
  if (score >= 12) return "12+";
  if (score >= 9) return "9–11";
  if (score >= 6) return "6–8";
  if (score >= 3) return "3–5";
  return "0–2";
}

/** Walk forward on the step timeframe and decide what happened first. */
function resolveOutcome(
  future: Candle[],
  setup: { direction: string; entry: number; stop: number; tp1: number; tp2: number | null },
  maxLookout: number,
): { outcome: BacktestOutcome; realizedR: number | null; resolvedAt: string | null; bars: number | null } {
  const long = setup.direction === "POTENTIAL LONG";
  const risk = Math.abs(setup.entry - setup.stop);
  if (risk <= 0) return { outcome: "UNRESOLVED", realizedR: null, resolvedAt: null, bars: null };

  let best: BacktestOutcome | null = null;
  let bestTime: string | null = null;
  let bars: number | null = null;

  for (let i = 0; i < Math.min(future.length, maxLookout); i += 1) {
    const c = future[i]!;
    const hitStop = long ? c.low <= setup.stop : c.high >= setup.stop;
    const hitTp1 = long ? c.high >= setup.tp1 : c.low <= setup.tp1;
    const hitTp2 =
      setup.tp2 === null ? false : long ? c.high >= setup.tp2 : c.low <= setup.tp2;

    // Same candle touching both: assume the stop was reached first (conservative).
    if (hitStop && !best) {
      return { outcome: "STOP", realizedR: -1, resolvedAt: c.time, bars: i + 1 };
    }
    if (hitTp2) {
      const reward = Math.abs(setup.tp2! - setup.entry);
      return { outcome: "TP2", realizedR: reward / risk, resolvedAt: c.time, bars: i + 1 };
    }
    if (hitTp1 && !best) {
      best = "TP1";
      bestTime = c.time;
      bars = i + 1;
    }
  }

  if (best === "TP1") {
    const reward = Math.abs(setup.tp1 - setup.entry);
    return { outcome: "TP1", realizedR: reward / risk, resolvedAt: bestTime, bars };
  }
  return { outcome: "UNRESOLVED", realizedR: null, resolvedAt: null, bars: null };
}

export function runDenBacktest(input: BacktestInput): BacktestResult {
  const series = input.series.filter((set) => set.candles.length >= 12);
  if (!series.length) throw new Error("Not enough candles to backtest.");

  const step =
    series.find((set) => set.timeframe === input.stepTimeframe) ?? series[series.length - 1]!;
  const stepCandles = step.candles;
  const warmup = Math.max(20, Math.min(500, Math.round(input.warmup ?? 60)));
  const maxLookout = Math.max(10, Math.min(1000, Math.round(input.maxLookout ?? 200)));

  if (stepCandles.length <= warmup + 10) {
    throw new Error(
      `Need more than ${warmup + 10} candles on ${step.timeframe} to run a walk-forward backtest.`,
    );
  }

  /** Pointer per timeframe so the snapshot slice is O(1) amortised. */
  const cursors = series.map(() => 0);
  const setups: BacktestSetup[] = [];
  let steps = 0;
  let openUntil: { long: number; short: number } = { long: -1, short: -1 };

  for (let i = warmup; i < stepCandles.length - 1; i += 1) {
    const now = stepCandles[i]!.time;
    steps += 1;

    const snapshot: DenSeries[] = series.map((set, idx) => {
      let cursor = cursors[idx]!;
      while (cursor < set.candles.length && set.candles[cursor]!.time <= now) cursor += 1;
      cursors[idx] = cursor;
      return { timeframe: set.timeframe, candles: set.candles.slice(0, cursor) };
    });

    if (snapshot.some((set) => set.candles.length < 12) ) {
      // Not every timeframe has history at this point in time yet.
      if (!snapshot.some((set) => set.candles.length >= 12)) continue;
    }

    let result;
    try {
      result = runDenAnalysis({
        symbol: input.symbol,
        series: snapshot.filter((set) => set.candles.length >= 12),
        minRR: input.minRR,
        requireVolume: input.requireVolume,
        strictMode: input.strictMode,
        rules: input.rules,
      });
    } catch {
      continue;
    }

    if (result.direction !== "POTENTIAL LONG" && result.direction !== "POTENTIAL SHORT") continue;
    const entry = priceOf(result.entry_zone);
    const stop = priceOf(result.stop_loss);
    const tp1 = priceOf(result.tp1);
    if (entry === null || stop === null || tp1 === null) continue;

    const side = result.direction === "POTENTIAL LONG" ? "long" : "short";
    if (i <= openUntil[side]) continue; // don't stack identical overlapping signals

    const future = stepCandles.slice(i + 1);
    const outcome = resolveOutcome(
      future,
      { direction: result.direction, entry, stop, tp1, tp2: priceOf(result.tp2) },
      maxLookout,
    );
    openUntil = { ...openUntil, [side]: i + (outcome.bars ?? Math.min(maxLookout, future.length)) };

    setups.push({
      time: now,
      direction: result.direction,
      entry,
      stop,
      tp1,
      tp2: priceOf(result.tp2),
      score: result.score,
      grade: result.grade,
      riskReward: result.risk_reward,
      components: result.checklist
        .filter((item) => item.score > 0)
        .map((item) => ({ key: item.key, score: item.score })),
      outcome: outcome.outcome,
      realizedR: outcome.realizedR,
      resolvedAt: outcome.resolvedAt,
      barsToResolve: outcome.bars,
    });
  }

  const resolved = setups.filter((s) => s.outcome !== "UNRESOLVED");
  const wins = resolved.filter((s) => s.outcome !== "STOP");
  const rs = resolved.map((s) => s.realizedR ?? 0);
  const scoreLabels = ["12+", "9–11", "6–8", "3–5", "0–2"];

  return {
    symbol: input.symbol,
    stepTimeframe: step.timeframe,
    timeframes: series.map((set) => set.timeframe),
    steps,
    from: stepCandles[warmup]?.time ?? null,
    to: stepCandles[stepCandles.length - 1]?.time ?? null,
    totalSetups: setups.length,
    resolved: resolved.length,
    unresolved: setups.length - resolved.length,
    wins: wins.length,
    losses: resolved.length - wins.length,
    winRate: resolved.length ? (wins.length / resolved.length) * 100 : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    totalR: Number(rs.reduce((a, b) => a + b, 0).toFixed(2)),
    byDirection: [
      bucket("Long", setups.filter((s) => s.direction === "POTENTIAL LONG")),
      bucket("Short", setups.filter((s) => s.direction === "POTENTIAL SHORT")),
    ],
    byScore: scoreLabels
      .map((label) => bucket(label, setups.filter((s) => scoreBucketLabel(s.score) === label)))
      .filter((row) => row.setups > 0),
    setups: setups.sort((a, b) => (a.time < b.time ? 1 : -1)),
  };
}
