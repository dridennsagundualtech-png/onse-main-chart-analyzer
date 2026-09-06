/**
 * Den Analyzer — 100% rule-based admin server.
 *
 * Every score, level, marker and trade idea below is derived from OHLC (and
 * tick volume when present) with fixed deterministic rules. No network calls,
 * no model, no image analysis. Same output contract as the AI analysers so the
 * existing checklist / chart / journal UI renders it unchanged.
 */
import {
  CHECKLIST_BY_KEY,
  MAX_SCORE,
  checklistMax,
  gradeFor,
  normalizeChecklist,
  totalScore,
  type AnalysisResult,
  type ChecklistKey,
  type Direction,
  type SetupStage,
} from "./analysis-types";
import type { Candle } from "./market.server";
import { computeStats } from "./market.server";
import {
  DEFAULT_DEN_RULES,
  DEN_COMPONENT_KEYS,
  FIB_EXTENSIONS,
  FIB_RETRACEMENTS,
  normalizeDenRules,
  type DenComponentKey,
  type DenRules,
} from "./den-rules";
import type { ChecklistMarker, MarketAnalysis } from "./market-types";

/**
 * Active rulebook for the current run. runDenAnalysis is fully synchronous, so
 * a module-scope value cannot be interleaved between two requests.
 */
let R: DenRules = DEFAULT_DEN_RULES;

export const DEN_PROVIDER_LABEL = "Den Analyzer (rule-based)";

interface RawItem {
  key: ChecklistKey;
  status: string;
  score: number;
  evidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  missing?: string | null;
}

export interface DenSeries {
  timeframe: string;
  candles: Candle[];
}

export interface DenInput {
  symbol: string;
  series: DenSeries[];
  minRR: number;
  requireVolume: boolean;
  strictMode: boolean;
  /** User-edited rulebook; missing values fall back to the defaults. */
  rules?: unknown;
}

interface Pivot {
  index: number;
  price: number;
  time: string;
}

function digitsFor(price: number): number {
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  return 6;
}

function fmt(price: number, digits: number): string {
  return price.toFixed(digits);
}

function pivots(candles: Candle[], side: "high" | "low", width = R.pivotWidth): Pivot[] {
  const out: Pivot[] = [];
  for (let i = width; i < candles.length - width; i += 1) {
    const price = candles[i]![side];
    const window = candles.slice(i - width, i + width + 1);
    const isPivot =
      side === "high" ? window.every((c) => c.high <= price) : window.every((c) => c.low >= price);
    if (isPivot) out.push({ index: i, price, time: candles[i]!.time });
  }
  return out;
}

function atrOf(candles: Candle[], period = R.atrPeriod): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const window = trs.slice(-period);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

type Bias = "BULLISH" | "BEARISH" | "RANGING" | "UNCONFIRMED";

function structureOf(candles: Candle[]): Bias {
  const highs = pivots(candles, "high").slice(-3);
  const lows = pivots(candles, "low").slice(-3);
  if (highs.length < 2 || lows.length < 2) return "UNCONFIRMED";
  const hh = highs[highs.length - 1]!.price > highs[0]!.price;
  const hl = lows[lows.length - 1]!.price > lows[0]!.price;
  const lh = highs[highs.length - 1]!.price < highs[0]!.price;
  const ll = lows[lows.length - 1]!.price < lows[0]!.price;
  if (hh && hl) return "BULLISH";
  if (lh && ll) return "BEARISH";
  return "RANGING";
}

/** Groups nearby pivots into one level so we report zones, not noise. */
function levels(pv: Pivot[], tolerance: number): { price: number; touches: number; lastTime: string }[] {
  const sorted = [...pv].sort((a, b) => a.price - b.price);
  const groups: { prices: number[]; lastTime: string }[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(item.price - last.prices[last.prices.length - 1]!) <= tolerance) {
      last.prices.push(item.price);
      if (item.time > last.lastTime) last.lastTime = item.time;
    } else {
      groups.push({ prices: [item.price], lastTime: item.time });
    }
  }
  return groups.map((group) => ({
    price: group.prices.reduce((a, b) => a + b, 0) / group.prices.length,
    touches: group.prices.length,
    lastTime: group.lastTime,
  }));
}

interface Sweep {
  side: "high" | "low";
  level: number;
  index: number;
  time: string;
  reclaimed: boolean;
}

/** Price trades through a prior pivot then closes back inside it. */
function findSweep(candles: Candle[], lookback = R.sweepLookback): Sweep | null {
  const start = Math.max(5, candles.length - lookback);
  let best: Sweep | null = null;
  for (let i = start; i < candles.length; i += 1) {
    const c = candles[i]!;
    const priorHighs = pivots(candles.slice(0, i), "high");
    const priorLows = pivots(candles.slice(0, i), "low");
    const ph = priorHighs[priorHighs.length - 1];
    const pl = priorLows[priorLows.length - 1];
    if (ph && c.high > ph.price) {
      best = { side: "high", level: ph.price, index: i, time: c.time, reclaimed: c.close < ph.price };
    }
    if (pl && c.low < pl.price) {
      best = { side: "low", level: pl.price, index: i, time: c.time, reclaimed: c.close > pl.price };
    }
  }
  return best;
}

interface Break {
  side: "up" | "down";
  level: number;
  index: number;
  time: string;
  closedBeyond: boolean;
}

function findBreak(candles: Candle[], lookback = R.breakLookback): Break | null {
  const start = Math.max(5, candles.length - lookback);
  let best: Break | null = null;
  for (let i = start; i < candles.length; i += 1) {
    const c = candles[i]!;
    const ph = pivots(candles.slice(0, i), "high").slice(-1)[0];
    const pl = pivots(candles.slice(0, i), "low").slice(-1)[0];
    if (ph && c.high > ph.price) {
      best = { side: "up", level: ph.price, index: i, time: c.time, closedBeyond: c.close > ph.price };
    }
    if (pl && c.low < pl.price) {
      best = { side: "down", level: pl.price, index: i, time: c.time, closedBeyond: c.close < pl.price };
    }
  }
  return best;
}

interface Displacement {
  index: number;
  side: "up" | "down";
  time: string;
  high: number;
  low: number;
}

function findDisplacement(candles: Candle[], atr: number, lookback = R.displacementLookback): Displacement | null {
  if (atr <= 0) return null;
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - lookback); i -= 1) {
    const c = candles[i]!;
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (body >= atr * R.displacementBodyAtr && range > 0 && body / range >= R.displacementBodyRatio) {
      return {
        index: i,
        side: c.close > c.open ? "up" : "down",
        time: c.time,
        high: c.high,
        low: c.low,
      };
    }
  }
  return null;
}

interface Gap {
  side: "bullish" | "bearish";
  high: number;
  low: number;
  time: string;
  filled: boolean;
}

function findFvg(candles: Candle[], atr: number, lookback = R.fvgLookback): Gap | null {
  const start = Math.max(1, candles.length - lookback);
  let found: Gap | null = null;
  for (let i = start; i < candles.length - 1; i += 1) {
    const a = candles[i - 1]!;
    const c = candles[i + 1]!;
    if (c.low > a.high && c.low - a.high > atr * R.fvgMinAtr) {
      const after = candles.slice(i + 2);
      found = {
        side: "bullish",
        low: a.high,
        high: c.low,
        time: candles[i]!.time,
        filled: after.some((x) => x.low <= a.high),
      };
    }
    if (a.low > c.high && a.low - c.high > atr * R.fvgMinAtr) {
      const after = candles.slice(i + 2);
      found = {
        side: "bearish",
        low: c.high,
        high: a.low,
        time: candles[i]!.time,
        filled: after.some((x) => x.high >= a.low),
      };
    }
  }
  return found;
}

/**
 * The accumulation window: the rulebook lookback minus its most recent third,
 * so the expansion leg itself is not measured as part of the base.
 */
function accumulationWindow(candles: Candle[]): Candle[] {
  const lookback = Math.max(10, Math.round(R.accumulationLookback));
  const skip = Math.max(3, Math.floor(lookback / 3));
  return candles.slice(-lookback, -skip);
}

function rangeCompression(candles: Candle[], atr: number): boolean {
  if (atr <= 0) return false;
  const window = accumulationWindow(candles);
  if (window.length < 8) return false;
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  return high - low <= atr * R.compressionAtr;
}

// ---------- Smart Money Concepts detectors ----------

interface Choch {
  side: "up" | "down";
  level: number;
  time: string;
  closedBeyond: boolean;
}

/** First structural break *against* the prevailing bias. */
function findChoch(candles: Candle[], bias: Bias, lookback = R.chochLookback): Choch | null {
  if (bias !== "BULLISH" && bias !== "BEARISH") return null;
  const against: "up" | "down" = bias === "BULLISH" ? "down" : "up";
  const start = Math.max(5, candles.length - lookback);
  for (let i = start; i < candles.length; i += 1) {
    const c = candles[i]!;
    const prior = candles.slice(0, i);
    if (against === "down") {
      const pl = pivots(prior, "low").slice(-1)[0];
      if (pl && c.low < pl.price) {
        return { side: "down", level: pl.price, time: c.time, closedBeyond: c.close < pl.price };
      }
    } else {
      const ph = pivots(prior, "high").slice(-1)[0];
      if (ph && c.high > ph.price) {
        return { side: "up", level: ph.price, time: c.time, closedBeyond: c.close > ph.price };
      }
    }
  }
  return null;
}

interface OrderBlock {
  side: "bullish" | "bearish";
  high: number;
  low: number;
  time: string;
  index: number;
  mitigated: boolean;
  /** Price traded fully through the block — it now qualifies as a breaker. */
  failed: boolean;
  /** Price returned to the failed block afterwards. */
  retested: boolean;
  distance: number;
}

/**
 * Bullish OB = last bearish candle before a bullish displacement that broke a
 * prior swing high (mirror for bearish). Returns the most recent candidate.
 */
function findOrderBlock(candles: Candle[], atr: number, price: number): OrderBlock | null {
  if (atr <= 0) return null;
  const start = Math.max(3, candles.length - R.obLookback);
  let found: OrderBlock | null = null;
  for (let i = start; i < candles.length; i += 1) {
    const c = candles[i]!;
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (body < atr * R.displacementBodyAtr || range <= 0 || body / range < R.displacementBodyRatio) {
      continue;
    }
    const up = c.close > c.open;
    const prior = candles.slice(0, i);
    const pivot = up ? pivots(prior, "high").slice(-1)[0] : pivots(prior, "low").slice(-1)[0];
    const brokeStructure = pivot ? (up ? c.close > pivot.price : c.close < pivot.price) : false;
    if (!brokeStructure) continue;

    // Walk back to the last opposing candle — the origin of the move.
    let originIndex = -1;
    for (let j = i - 1; j >= Math.max(0, i - 10); j -= 1) {
      const o = candles[j]!;
      const opposing = up ? o.close < o.open : o.close > o.open;
      if (opposing) {
        originIndex = j;
        break;
      }
    }
    if (originIndex < 0) continue;
    const origin = candles[originIndex]!;
    const after = candles.slice(i + 1);
    const mitigated = up
      ? after.some((x) => x.low <= origin.high)
      : after.some((x) => x.high >= origin.low);
    const failed = up
      ? after.some((x) => x.close < origin.low)
      : after.some((x) => x.close > origin.high);
    const failIndex = failed
      ? after.findIndex((x) => (up ? x.close < origin.low : x.close > origin.high))
      : -1;
    const retested =
      failed &&
      after
        .slice(failIndex + 1)
        .some((x) => x.high >= origin.low - atr * R.breakerProximityAtr && x.low <= origin.high + atr * R.breakerProximityAtr);
    const distance =
      price > origin.high ? price - origin.high : price < origin.low ? origin.low - price : 0;
    found = {
      side: up ? "bullish" : "bearish",
      high: origin.high,
      low: origin.low,
      time: origin.time,
      index: originIndex,
      mitigated,
      failed,
      retested,
      distance,
    };
  }
  return found;
}

interface DealingRange {
  high: number;
  low: number;
  range: number;
  /** Direction of the most recent leg inside the range. */
  leg: "up" | "down";
  position: number;
  zone: "DISCOUNT" | "EQUILIBRIUM" | "PREMIUM";
  retracements: { ratio: number; price: number }[];
  extensions: { ratio: number; price: number }[];
}

function dealingRange(candles: Candle[], price: number): DealingRange | null {
  const window = candles.slice(-R.fibSwingWindow);
  if (window.length < 5) return null;
  let highIndex = 0;
  let lowIndex = 0;
  window.forEach((c, i) => {
    if (c.high > window[highIndex]!.high) highIndex = i;
    if (c.low < window[lowIndex]!.low) lowIndex = i;
  });
  const high = window[highIndex]!.high;
  const low = window[lowIndex]!.low;
  const range = high - low;
  if (range <= 0) return null;
  const leg: "up" | "down" = highIndex > lowIndex ? "up" : "down";
  const position = (price - low) / range;
  const band = R.fibEquilibriumBand;
  const zone =
    position > 0.5 + band ? "PREMIUM" : position < 0.5 - band ? "DISCOUNT" : "EQUILIBRIUM";
  const retracements = FIB_RETRACEMENTS.map((ratio) => ({
    ratio,
    price: leg === "up" ? high - range * ratio : low + range * ratio,
  }));
  const extensions = FIB_EXTENSIONS.map((ratio) => ({
    ratio,
    price: leg === "up" ? low + range * ratio : high - range * ratio,
  }));
  return { high, low, range, leg, position, zone, retracements, extensions };
}

export function runDenAnalysis(input: DenInput): MarketAnalysis {
  R = normalizeDenRules(input.rules);
  const series = input.series.filter((set) => set.candles.length >= 12);
  if (!series.length) {
    throw new Error("Den Analyzer needs at least 12 candles on one timeframe.");
  }

  const stats = series.map((set) => computeStats(set.timeframe, set.candles));
  const htf = series[0]!;
  const ltf = series[series.length - 1]!;
  const primary = series.length > 2 ? series[Math.floor(series.length / 2)]! : ltf;
  const candles = primary.candles;
  const last = candles[candles.length - 1]!;
  const price = last.close;
  const d = digitsFor(price);
  const atr = atrOf(candles);
  const dataAsOf =
    series
      .flatMap((set) => set.candles.map((c) => c.time))
      .sort()
      .at(-1) ?? null;

  const items: RawItem[] = [];
  const markers: ChecklistMarker[] = [];
  const reasoning: string[] = [];
  const missing: string[] = [];

  /** Only components switched on in the rulebook are calculated and scored. */
  const on = (key: DenComponentKey) => R.components[key] === true;
  const add = (item: RawItem) => {
    if (on(item.key as DenComponentKey)) items.push(item);
  };

  // ---------- 1. HTF structure ----------
  const htfBias = structureOf(htf.candles);
  const secondBias = series.length > 1 ? structureOf(series[1]!.candles) : htfBias;
  let structureScore = 0;
  let bias: Bias = htfBias;
  if (htfBias === "BULLISH" || htfBias === "BEARISH") {
    structureScore = secondBias === htfBias ? 2 : 1;
  } else if (htfBias === "RANGING") {
    structureScore = 1;
  }
  if (htfBias === "RANGING" && (secondBias === "BULLISH" || secondBias === "BEARISH")) {
    bias = "RANGING";
  }
  add({
    key: "htf_structure",
    status:
      structureScore === 2
        ? `${htfBias === "BULLISH" ? "Bullish" : "Bearish"} HTF trend confirmed`
        : htfBias === "RANGING"
          ? "HTF is ranging, no clean trend"
          : structureScore === 1
            ? "HTF trend present but mixed"
            : "HTF structure unclear",
    score: structureScore,
    evidence: `${htf.timeframe} swings read as ${htfBias}${series.length > 1 ? `, ${series[1]!.timeframe} reads ${secondBias}` : ""}. Based on the last three confirmed swing highs and lows.`,
    confidence: structureScore === 2 ? "HIGH" : structureScore === 1 ? "MEDIUM" : "LOW",
  });
  reasoning.push(
    `Structure: ${htf.timeframe} shows ${htfBias.toLowerCase()} swing sequence, so the bigger-picture bias is ${bias.toLowerCase()}.`,
  );

  /** Entry-timing detectors (sweep, structure break) read the lowest timeframe. */
  const ltfCandles = ltf.candles;
  const biasDirectional = bias === "BULLISH" || bias === "BEARISH";

  // ---------- 2. Support / resistance ----------
  const tol = Math.max(atr * R.levelToleranceAtr, price * R.levelTolerancePct);
  const highLevels = levels(pivots(candles, "high"), tol).sort((a, b) => b.touches - a.touches);
  const lowLevels = levels(pivots(candles, "low"), tol).sort((a, b) => b.touches - a.touches);
  const resistances = highLevels.filter((l) => l.price > price).sort((a, b) => a.price - b.price);
  const supports = lowLevels.filter((l) => l.price < price).sort((a, b) => b.price - a.price);
  const nearestResistance = resistances[0] ?? null;
  const nearestSupport = supports[0] ?? null;
  const flipped = highLevels.find((l) => l.price < price && price - l.price < atr * R.flipZoneAtr) ?? null;
  const atLevel =
    (nearestSupport && Math.abs(price - nearestSupport.price) <= atr * R.atLevelAtr) ||
    (nearestResistance && Math.abs(nearestResistance.price - price) <= atr * R.atLevelAtr) ||
    Boolean(flipped);
  add({
    key: "support_resistance",
    status: flipped
      ? "Broken resistance now acting as support"
      : atLevel
        ? "Price is reacting at a respected level"
        : "Price sits mid-range, no level nearby",
    score: atLevel ? 1 : 0,
    evidence: `Nearest support ${nearestSupport ? fmt(nearestSupport.price, d) : "none"}, nearest resistance ${nearestResistance ? fmt(nearestResistance.price, d) : "none"} on ${primary.timeframe}. ${flipped ? `Old resistance at ${fmt(flipped.price, d)} is now below price and can hold as support.` : "Levels come from repeated pivot reactions."}`,
    confidence: atLevel ? (flipped ? "HIGH" : "MEDIUM") : "LOW",
  });
  if (nearestSupport) {
    markers.push({
      key: "support_resistance",
      label: "Support",
      timeframe: primary.timeframe,
      price_high: Number(nearestSupport.price.toFixed(d)),
      price_low: Number(nearestSupport.price.toFixed(d)),
      time_from: null,
      time_to: null,
      note: "Level where price previously turned up.",
    });
  }
  if (nearestResistance) {
    markers.push({
      key: "support_resistance",
      label: "Resistance",
      timeframe: primary.timeframe,
      price_high: Number(nearestResistance.price.toFixed(d)),
      price_low: Number(nearestResistance.price.toFixed(d)),
      time_from: null,
      time_to: null,
      note: "Level where price previously turned down.",
    });
  }

  // ---------- 3. Liquidity ----------
  const eqTol = Math.max(atr * R.equalLevelToleranceAtr, price * R.equalLevelTolerancePct);
  const equalHighs = levels(pivots(candles, "high"), eqTol).filter(
    (l) => l.touches >= 2 && l.price > price,
  );
  const equalLows = levels(pivots(candles, "low"), eqTol).filter(
    (l) => l.touches >= 2 && l.price < price,
  );
  const poolAbove = equalHighs[0] ?? nearestResistance;
  const poolBelow = equalLows[0] ?? nearestSupport;
  const liquidityScore = poolAbove && poolBelow ? 2 : poolAbove || poolBelow ? 1 : 0;
  add({
    key: "liquidity",
    status:
      liquidityScore === 2
        ? "Liquidity pools on both sides"
        : liquidityScore === 1
          ? "Liquidity visible on one side only"
          : "No obvious liquidity pool",
    score: liquidityScore,
    evidence: `${poolAbove ? `Resting buy-side liquidity around ${fmt(poolAbove.price, d)}${equalHighs[0] ? " (equal highs)" : ""}. ` : ""}${poolBelow ? `Resting sell-side liquidity around ${fmt(poolBelow.price, d)}${equalLows[0] ? " (equal lows)" : ""}.` : ""}`.trim() ||
      "No repeated highs or lows close enough to act as a pool.",
    confidence: liquidityScore === 2 ? "HIGH" : liquidityScore === 1 ? "MEDIUM" : "LOW",
  });
  for (const [pool, label] of [
    [poolAbove, "Liquidity above"],
    [poolBelow, "Liquidity below"],
  ] as const) {
    if (pool) {
      markers.push({
        key: "liquidity",
        label,
        timeframe: primary.timeframe,
        price_high: Number(pool.price.toFixed(d)),
        price_low: Number(pool.price.toFixed(d)),
        time_from: null,
        time_to: null,
        note: "Stops likely rest here.",
      });
    }
  }

  // ---------- 5. Sweep (needed before AMD) ----------
  // Sweeps are an entry-timing signal, so they are read on the lowest
  // timeframe while the higher timeframes only set the bias.
  const sweep = findSweep(ltfCandles);
  const sweepScore = sweep ? (sweep.reclaimed ? 2 : 1) : 0;
  const sweepBias: Bias | null = sweep ? (sweep.side === "low" ? "BULLISH" : "BEARISH") : null;
  const sweepConflict = biasDirectional && sweepBias !== null && sweepBias !== bias;
  add({
    key: "liquidity_sweep",
    status: sweep
      ? sweep.reclaimed
        ? `${sweep.side === "high" ? "High" : "Low"} swept and reclaimed`
        : `${sweep.side === "high" ? "High" : "Low"} taken, no reclaim yet`
      : "No liquidity sweep found",
    score: sweepScore,
    evidence: sweep
      ? `On ${ltf.timeframe} price traded ${sweep.side === "high" ? "above" : "below"} ${fmt(sweep.level, d)} at ${sweep.time.slice(0, 16)} and ${sweep.reclaimed ? "closed back inside the range" : "is still outside it"}.${sweepConflict ? ` This ${sweepBias!.toLowerCase()} sweep disagrees with the ${bias.toLowerCase()} higher-timeframe bias, so treat it as a counter-trend move until structure follows.` : ""}`
      : `No candle in the recent ${ltf.timeframe} window pushed beyond a prior swing point.`,
    confidence: sweepScore === 2 ? "HIGH" : sweepScore === 1 ? "MEDIUM" : "LOW",
  });
  if (sweepConflict) {
    reasoning.push(
      `Timeframe conflict: the ${ltf.timeframe} sweep points ${sweepBias!.toLowerCase()} while the ${htf.timeframe} bias is ${bias.toLowerCase()}.`,
    );
  }
  if (sweep) {
    markers.push({
      key: "liquidity_sweep",
      label: "Sweep",
      timeframe: ltf.timeframe,
      price_high: Number(sweep.level.toFixed(d)),
      price_low: Number(sweep.level.toFixed(d)),
      time_from: sweep.time,
      time_to: sweep.time,
      note: "Prior high/low taken out here.",
    });
  }

  // ---------- 4. AMD ----------
  const displacement = findDisplacement(candles, atr);
  const accumulation = rangeCompression(candles, atr);
  const manipulation = Boolean(sweep);
  // The sweep now comes from the lower timeframe, so compare by candle time
  // rather than by index (the two series index differently).
  const distribution = Boolean(displacement && sweep && displacement.time >= sweep.time);
  const amdScore = accumulation && manipulation && distribution ? 2 : [accumulation, manipulation, distribution].filter(Boolean).length >= 2 ? 1 : 0;
  add({
    key: "amd",
    status:
      amdScore === 2
        ? "Full AMD cycle detected"
        : amdScore === 1
          ? "Partial AMD cycle only"
          : "AMD not confirmed",
    score: amdScore,
    evidence: `Accumulation (tight range): ${accumulation ? "yes" : "no"}. Manipulation (sweep): ${manipulation ? "yes" : "no"}. Distribution (expansion after the sweep): ${distribution ? "yes" : "no"}.`,
    confidence: amdScore === 2 ? "HIGH" : amdScore === 1 ? "MEDIUM" : "LOW",
  });
  if (accumulation) {
    const window = accumulationWindow(candles);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    markers.push({
      key: "amd",
      label: "Accumulation",
      timeframe: primary.timeframe,
      price_high: Number(high.toFixed(d)),
      price_low: Number(low.toFixed(d)),
      time_from: window[0]?.time ?? null,
      time_to: window[window.length - 1]?.time ?? null,
      note: "Sideways build-up before the move.",
    });
  }

  // ---------- 6. MSS / BOS ----------
  // Structure breaks confirm entry timing, so they are read on the lowest
  // timeframe too; the higher timeframes still own the bias.
  const brk = findBreak(ltfCandles);
  const bosScore = brk ? (brk.closedBeyond ? 2 : 1) : 0;
  const shift = Boolean(brk && ((bias === "BULLISH" && brk.side === "down") || (bias === "BEARISH" && brk.side === "up")));
  const breakBias: Bias | null = brk ? (brk.side === "up" ? "BULLISH" : "BEARISH") : null;
  const breakConflict = biasDirectional && breakBias !== null && breakBias !== bias;
  add({
    key: "mss_bos",
    status: brk
      ? brk.closedBeyond
        ? shift
          ? "Market structure shift confirmed"
          : "Break of structure confirmed"
        : "Break attempted, not closed beyond"
      : "No structural break",
    score: bosScore,
    evidence: brk
      ? `On ${ltf.timeframe} price broke ${brk.side === "up" ? "above" : "below"} the swing at ${fmt(brk.level, d)} on ${brk.time.slice(0, 16)} and ${brk.closedBeyond ? "closed beyond it" : "failed to close beyond it"}.${breakConflict ? ` The break runs against the ${bias.toLowerCase()} ${htf.timeframe} bias, which is why it reads as a shift rather than a continuation.` : ""}`
      : `No recent ${ltf.timeframe} candle broke a prior swing high or low.`,
    confidence: bosScore === 2 ? "HIGH" : bosScore === 1 ? "MEDIUM" : "LOW",
  });
  if (breakConflict) {
    reasoning.push(
      `Timeframe conflict: the ${ltf.timeframe} structure break is ${breakBias!.toLowerCase()} against a ${bias.toLowerCase()} ${htf.timeframe} bias.`,
    );
  }
  if (brk) {
    markers.push({
      key: "mss_bos",
      label: shift ? "MSS" : "BOS",
      timeframe: ltf.timeframe,
      price_high: Number(brk.level.toFixed(d)),
      price_low: Number(brk.level.toFixed(d)),
      time_from: brk.time,
      time_to: brk.time,
      note: "Structure level that was broken.",
    });
  }

  // ---------- 7. Displacement ----------
  add({
    key: "displacement",
    status: displacement
      ? `Strong ${displacement.side === "up" ? "bullish" : "bearish"} displacement candle`
      : "No displacement candle",
    score: displacement ? 1 : 0,
    evidence: displacement
      ? `A large-bodied candle at ${displacement.time.slice(0, 16)} moved price quickly ${displacement.side === "up" ? "up" : "down"} (body above 1.3x ATR with a small wick).`
      : "Recent candles are ordinary in size relative to ATR.",
    confidence: displacement ? "HIGH" : "LOW",
  });
  if (displacement) {
    markers.push({
      key: "displacement",
      label: "Displacement",
      timeframe: primary.timeframe,
      price_high: Number(displacement.high.toFixed(d)),
      price_low: Number(displacement.low.toFixed(d)),
      time_from: displacement.time,
      time_to: displacement.time,
      note: "Fast one-directional candle.",
    });
  }

  // ---------- 8. FVG ----------
  const gap = findFvg(candles, atr);
  const fvgUsable = Boolean(gap && !gap.filled);
  add({
    key: "fvg",
    status: gap
      ? gap.filled
        ? "Fair value gap found but already filled"
        : `Unfilled ${gap.side} fair value gap`
      : "No fair value gap",
    score: fvgUsable ? 1 : 0,
    evidence: gap
      ? `Gap between ${fmt(gap.low, d)} and ${fmt(gap.high, d)} left at ${gap.time.slice(0, 16)}; ${gap.filled ? "price already traded back through it" : "price has not returned to it yet, so it can act as an entry zone"}.`
      : "No three-candle imbalance large enough to matter.",
    confidence: fvgUsable ? "HIGH" : gap ? "MEDIUM" : "LOW",
  });
  if (gap) {
    markers.push({
      key: "fvg",
      label: gap.filled ? "FVG (filled)" : "FVG",
      timeframe: primary.timeframe,
      price_high: Number(gap.high.toFixed(d)),
      price_low: Number(gap.low.toFixed(d)),
      time_from: gap.time,
      time_to: null,
      note: "Imbalance left by a fast move.",
    });
  }

  // ---------- CHoCH ----------
  // Entry-timing signal: detect on the lowest timeframe, like the sweep and BOS/MSS.
  const choch = findChoch(ltfCandles, bias);
  const chochBias: Bias | null = choch ? (choch.side === "up" ? "BULLISH" : "BEARISH") : null;
  const chochConflict = biasDirectional && chochBias !== null && chochBias !== bias;
  add({
    key: "choch",
    status: choch
      ? `Change of character ${choch.side === "up" ? "upward" : "downward"} against the ${bias.toLowerCase()} bias`
      : "No change of character against the current trend",
    score: choch ? (choch.closedBeyond ? 2 : 1) : 0,
    evidence: choch
      ? `On ${ltf.timeframe} price broke the last counter-trend swing at ${fmt(choch.level, d)} on ${choch.time.slice(0, 16)}${choch.closedBeyond ? " with a close beyond it" : " on a wick only"}.${chochConflict ? ` This ${chochBias!.toLowerCase()} shift runs against the ${bias.toLowerCase()} higher-timeframe bias, so it hints at a turn rather than confirming the trend.` : ""}`
      : `No ${ltf.timeframe} swing against the bias has been broken: the trend has not been challenged.`,
    confidence: choch ? (choch.closedBeyond ? "HIGH" : "MEDIUM") : "LOW",
  });
  if (chochConflict) {
    reasoning.push(
      `Timeframe conflict: the ${ltf.timeframe} change of character points ${chochBias!.toLowerCase()} against a ${bias.toLowerCase()} ${htf.timeframe} bias.`,
    );
  }
  if (choch) {
    markers.push({
      key: "choch",
      label: "CHoCH",
      timeframe: ltf.timeframe,
      price_high: Number(choch.level.toFixed(d)),
      price_low: Number(choch.level.toFixed(d)),
      time_from: choch.time,
      time_to: null,
      note: "First break against the prevailing trend.",
    });
  }

  // ---------- Order block / breaker block ----------
  const ob = findOrderBlock(candles, atr, price);
  const obFresh = Boolean(ob && !ob.mitigated && !ob.failed);
  const obNear = Boolean(ob && ob.distance <= atr * R.obProximityAtr);
  add({
    key: "order_block",
    status: ob
      ? obFresh && obNear
        ? `Fresh ${ob.side} order block at price`
        : `${ob.side === "bullish" ? "Bullish" : "Bearish"} order block ${ob.failed ? "already broken" : ob.mitigated ? "already mitigated" : "still some distance away"}`
      : "No order block behind the last move",
    score: ob ? (obFresh && obNear ? 2 : ob.failed ? 0 : 1) : 0,
    evidence: ob
      ? `Last opposing candle before the displacement that broke structure sits between ${fmt(ob.low, d)} and ${fmt(ob.high, d)} (${ob.time.slice(0, 16)}); price is ${ob.distance === 0 ? "inside it" : `${fmt(ob.distance, d)} away`}.`
      : "No displacement that broke structure, so no order block can be marked.",
    confidence: ob ? (obFresh && obNear ? "HIGH" : "MEDIUM") : "LOW",
  });
  add({
    key: "breaker_block",
    status:
      ob && ob.failed
        ? ob.retested
          ? `${ob.side === "bullish" ? "Bullish" : "Bearish"} order block failed and was retested — breaker active`
          : "Order block failed but has not been retested yet"
        : "No breaker block",
    score: ob && ob.failed ? (ob.retested ? 2 : 1) : 0,
    evidence:
      ob && ob.failed
        ? `Price closed straight through the ${fmt(ob.low, d)}–${fmt(ob.high, d)} block, flipping it${ob.retested ? " and has since traded back into it" : "; a retest has not happened yet"}.`
        : "No order block has been traded through and reclaimed from the other side.",
    confidence: ob && ob.failed ? (ob.retested ? "HIGH" : "MEDIUM") : "LOW",
  });
  if (ob) {
    markers.push({
      key: ob.failed ? "breaker_block" : "order_block",
      label: ob.failed ? "Breaker block" : `${ob.side === "bullish" ? "Bullish" : "Bearish"} OB`,
      timeframe: primary.timeframe,
      price_high: Number(ob.high.toFixed(d)),
      price_low: Number(ob.low.toFixed(d)),
      time_from: ob.time,
      time_to: null,
      note: ob.failed
        ? "Order block price traded through; now watched from the other side."
        : "Origin of the move that broke structure.",
    });
  }

  // ---------- 9. Volume ----------
  const vols = candles.map((c) => c.volume ?? 0);
  const hasVolume = vols.some((v) => v > 0);
  let volumeScore = 0;
  let volumeStatus = "Volume context unavailable";
  let volumeEvidence = "This symbol has no tick volume stored, so volume is not scored.";
  if (!hasVolume) {
    missing.push("Tick volume is not available for this symbol.");
  } else {
    const base =
      vols.slice(-R.volumeBaseWindow).reduce((a, b) => a + b, 0) /
      Math.min(R.volumeBaseWindow, vols.length);
    const impulseVol = displacement ? (candles[displacement.index]!.volume ?? 0) : 0;
    const pullbackVol = vols.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const expanded = base > 0 && impulseVol > base * R.volumeImpulseMult;
    const contracted = base > 0 && pullbackVol < base * R.volumeQuietMult;
    volumeScore = expanded && contracted ? 1 : 0;
    volumeStatus = volumeScore
      ? "Volume expanded on the move, contracted on the pullback"
      : expanded
        ? "Volume expanded but pullback volume is still high"
        : "Volume does not support the move";
    volumeEvidence = `Average volume ${Math.round(base)}, move volume ${Math.round(impulseVol)}, last three candles average ${Math.round(pullbackVol)}.`;
  }
  add({
    key: "volume",
    status: volumeStatus,
    score: volumeScore,
    evidence: volumeEvidence,
    confidence: hasVolume ? (volumeScore ? "HIGH" : "MEDIUM") : "LOW",
    missing: hasVolume ? null : "Volume data unavailable",
  });

  // ---------- Fibonacci dealing range ----------
  const fib = on("fibonacci") ? dealingRange(candles, price) : null;

  // ---------- Direction ----------
  // Only components that are switched on are allowed to vote.
  const signals: { key: DenComponentKey; bull: boolean; bear: boolean }[] = [
    { key: "htf_structure", bull: bias === "BULLISH", bear: bias === "BEARISH" },
    { key: "liquidity_sweep", bull: sweep?.side === "low", bear: sweep?.side === "high" },
    {
      key: "mss_bos",
      bull: brk?.side === "up" && brk.closedBeyond,
      bear: brk?.side === "down" && brk.closedBeyond,
    },
    { key: "displacement", bull: displacement?.side === "up", bear: displacement?.side === "down" },
    { key: "choch", bull: choch?.side === "up", bear: choch?.side === "down" },
    {
      key: "order_block",
      bull: Boolean(ob && ob.side === "bullish" && !ob.failed),
      bear: Boolean(ob && ob.side === "bearish" && !ob.failed),
    },
    { key: "fibonacci", bull: fib?.zone === "DISCOUNT", bear: fib?.zone === "PREMIUM" },
  ];
  const active = signals.filter((s) => on(s.key));
  const bullSignals = active.filter((s) => s.bull).length;
  const bearSignals = active.filter((s) => s.bear).length;
  const minSignals = Math.max(1, Math.min(R.directionMinSignals, active.length));

  let direction: Direction = "WAIT";
  if (bullSignals >= minSignals && bullSignals > bearSignals) direction = "POTENTIAL LONG";
  else if (bearSignals >= minSignals && bearSignals > bullSignals) direction = "POTENTIAL SHORT";
  else if (bullSignals <= 1 && bearSignals <= 1) direction = "NO TRADE";

  // ---------- Fibonacci premium / discount scoring ----------
  const fibAligned =
    Boolean(fib) &&
    ((direction === "POTENTIAL LONG" && fib!.zone === "DISCOUNT") ||
      (direction === "POTENTIAL SHORT" && fib!.zone === "PREMIUM"));
  const inGoldenPocket =
    Boolean(fib) &&
    (() => {
      const lo = Math.min(fib!.retracements[2]!.price, fib!.retracements[4]!.price);
      const hi = Math.max(fib!.retracements[2]!.price, fib!.retracements[4]!.price);
      return price >= lo && price <= hi;
    })();
  add({
    key: "fibonacci",
    status: fib
      ? `Price is in ${fib.zone.toLowerCase()} of the dealing range${fibAligned ? " — aligned with the direction" : ""}`
      : "Dealing range unavailable",
    score: fib ? (fibAligned ? 2 : inGoldenPocket ? 1 : 0) : 0,
    evidence: fib
      ? `Range ${fmt(fib.low, d)}–${fmt(fib.high, d)} (${fib.leg === "up" ? "up" : "down"} leg); price sits at ${(fib.position * 100).toFixed(1)}% of it. Retracements ${fib.retracements.map((r) => `${r.ratio}=${fmt(r.price, d)}`).join(", ")}. Extensions ${fib.extensions.map((r) => `${r.ratio}=${fmt(r.price, d)}`).join(", ")}.`
      : "Not enough candles to define a swing high and swing low.",
    confidence: fib ? (fibAligned ? "HIGH" : "MEDIUM") : "LOW",
  });
  if (fib) {
    markers.push({
      key: "fibonacci",
      label: `Equilibrium (${fib.zone.toLowerCase()})`,
      timeframe: primary.timeframe,
      price_high: Number(fib.high.toFixed(d)),
      price_low: Number(fib.low.toFixed(d)),
      time_from: null,
      time_to: null,
      note: "Dealing range: below 50% is discount, above is premium.",
    });
  }


  // ---------- 10. Risk / reward ----------
  const swingLow = Math.min(...candles.slice(-R.swingWindow).map((c) => c.low));
  const swingHigh = Math.max(...candles.slice(-R.swingWindow).map((c) => c.high));
  let entry: number | null = null;
  let stop: number | null = null;
  let tp1: number | null = null;
  let tp2: number | null = null;

  // When Fibonacci is active its extension of the dealing range is the second target.
  const fibTarget = fib
    ? fib.leg === "up"
      ? fib.low + fib.range * R.fibTpExtension
      : fib.high - fib.range * R.fibTpExtension
    : null;

  if (direction === "POTENTIAL LONG") {
    entry =
      fib && fib.zone !== "DISCOUNT" && on("fibonacci")
        ? fib.retracements[2]!.price
        : gap && !gap.filled && gap.side === "bullish"
          ? (gap.high + gap.low) / 2
          : price;
    stop = (sweep?.side === "low" ? Math.min(sweep.level, swingLow) : swingLow) - atr * R.stopBufferAtr;
    tp1 = nearestResistance?.price ?? swingHigh;
    tp2 =
      fibTarget !== null && fibTarget > (tp1 ?? swingHigh)
        ? fibTarget
        : Math.max(swingHigh, (tp1 ?? swingHigh) + atr * R.tp2ExtensionAtr);
  } else if (direction === "POTENTIAL SHORT") {
    entry =
      fib && fib.zone !== "PREMIUM" && on("fibonacci")
        ? fib.retracements[2]!.price
        : gap && !gap.filled && gap.side === "bearish"
          ? (gap.high + gap.low) / 2
          : price;
    stop = (sweep?.side === "high" ? Math.max(sweep.level, swingHigh) : swingHigh) + atr * R.stopBufferAtr;
    tp1 = nearestSupport?.price ?? swingLow;
    tp2 =
      fibTarget !== null && fibTarget < (tp1 ?? swingLow)
        ? fibTarget
        : Math.min(swingLow, (tp1 ?? swingLow) - atr * R.tp2ExtensionAtr);
  }

  let rr: number | null = null;
  if (entry !== null && stop !== null && tp1 !== null) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(tp1 - entry);
    rr = risk > 0 ? Number((reward / risk).toFixed(2)) : null;
    if (rr !== null && rr > 50) rr = 50;
  }
  const rrScore = rr === null ? 0 : rr >= input.minRR ? 2 : 1;
  add({
    key: "risk_reward",
    status:
      rr === null
        ? "R:R cannot be measured yet"
        : rr >= input.minRR
          ? `R:R ${rr}:1 meets your minimum`
          : `R:R ${rr}:1 below your ${input.minRR}:1 minimum`,
    score: rrScore,
    evidence:
      rr === null
        ? "No directional setup, so no entry, stop or target can be measured."
        : `Entry ${fmt(entry!, d)}, stop ${fmt(stop!, d)} (beyond the invalidation point), first target ${fmt(tp1!, d)}.`,
    confidence: rr === null ? "LOW" : rr >= input.minRR ? "HIGH" : "MEDIUM",
  });

  // Only the switched-on components appear in the checklist, so every threshold
  // written against the 16-point scale is rescaled to the active maximum.
  const activeSpecs = DEN_COMPONENT_KEYS.filter((key) => on(key)).map(
    (key) => CHECKLIST_BY_KEY[key],
  );
  const checklist = normalizeChecklist(items, activeSpecs);
  const score = totalScore(checklist);
  const maxScore = checklistMax(checklist) || MAX_SCORE;
  const scaled = (value: number) => Math.round((value / MAX_SCORE) * maxScore);

  let stage: SetupStage = "SETUP FORMING";
  if (direction === "NO TRADE") stage = "NO TRADE";
  else if (direction === "POTENTIAL LONG" || direction === "POTENTIAL SHORT") {
    stage = score >= scaled(R.entryStageScore) ? "ENTRY AVAILABLE" : "SETUP CONFIRMED";
  }
  if (input.strictMode && score < scaled(R.strictMinScore) && (direction === "POTENTIAL LONG" || direction === "POTENTIAL SHORT")) {
    direction = "WAIT";
    stage = "SETUP FORMING";
  }
  if (input.requireVolume && volumeScore === 0 && (direction === "POTENTIAL LONG" || direction === "POTENTIAL SHORT")) {
    direction = "WAIT";
    stage = "SETUP FORMING";
    missing.push("You require volume confirmation and volume does not confirm this move.");
  }

  reasoning.push(
    `Liquidity: pools mapped ${poolAbove ? `above at ${fmt(poolAbove.price, d)}` : "above: none"} and ${poolBelow ? `below at ${fmt(poolBelow.price, d)}` : "below: none"}.`,
    sweep
      ? `Sweep: the ${sweep.side === "high" ? "high" : "low"} at ${fmt(sweep.level, d)} was taken${sweep.reclaimed ? " and reclaimed" : " without a reclaim"}.`
      : "Sweep: no prior high or low has been taken recently.",
    brk
      ? `Structure break: ${brk.side === "up" ? "upside" : "downside"} break of ${fmt(brk.level, d)}${brk.closedBeyond ? " with a close beyond" : " without a close beyond"}.`
      : "Structure break: none, so the current leg is unconfirmed.",
    displacement
      ? `Displacement: a decisive ${displacement.side === "up" ? "up" : "down"} candle followed, showing intent.`
      : "Displacement: no decisive expansion candle yet.",
    gap && !gap.filled
      ? `Entry zone: unfilled gap ${fmt(gap.low, d)}–${fmt(gap.high, d)} is the cleanest place to wait for price.`
      : "Entry zone: no unfilled gap, so a level retest is the only reference.",
    rr !== null
      ? `Risk: stop sits beyond the invalidation level, giving about ${rr}:1 to the first target.`
      : "Risk: no measurable trade, so no risk plan is proposed.",
  );

  const summaryDirection =
    direction === "POTENTIAL LONG"
      ? "a possible long"
      : direction === "POTENTIAL SHORT"
        ? "a possible short"
        : direction === "NO TRADE"
          ? "no trade"
          : "waiting";
  const summary = `Rule-based read of ${input.symbol}: ${bias.toLowerCase()} higher-timeframe structure with ${score}/${maxScore} checklist points, pointing to ${summaryDirection}. Every point comes from fixed price rules, not an AI opinion.`;

  const supportList = supports
    .slice(0, 4)
    .map((l) => `${fmt(l.price, d)} — prior low tested ${l.touches} time${l.touches > 1 ? "s" : ""}`);
  const resistanceList = resistances
    .slice(0, 4)
    .map((l) => `${fmt(l.price, d)} — prior high tested ${l.touches} time${l.touches > 1 ? "s" : ""}`);

  const momentumStat = stats.find((s) => s.timeframe === primary.timeframe) ?? stats[0]!;
  const momentum = `On ${primary.timeframe} the EMA20/EMA50 relationship reads ${momentumStat.trend}, ATR(14) is ${momentumStat.atr14 ?? "n/a"} and price sits at ${momentumStat.range_position_pct ?? "n/a"}% of its visible range. Volume is ${hasVolume ? momentumStat.volume_trend.toLowerCase() : "unavailable"}.`;

  // Markers and the S/R level lists only make sense for components that are
  // switched on — the levels are still computed internally because liquidity
  // pools and the R:R plan reuse them as fallbacks.
  const srOn = on("support_resistance");
  const visibleMarkers = markers.filter((m) => on(m.key as DenComponentKey));

  return {
    symbol: input.symbol,
    data_as_of: dataAsOf,
    stats,
    series: series.map((set) => ({ timeframe: set.timeframe, candles: set.candles })),
    support_levels: srOn ? supportList : [],
    resistance_levels: srOn ? resistanceList : [],
    momentum,
    timeframe_reads: series.map((set) => ({
      timeframe: set.timeframe,
      read: `${structureOf(set.candles)} structure; ${computeStats(set.timeframe, set.candles).trend} EMA trend.`,
    })),
    markers: visibleMarkers,
    asset: input.symbol.toUpperCase().slice(0, 24),
    market_type: "unknown",
    timeframes: series.map((set) => set.timeframe),
    primary_timeframe: primary.timeframe,
    sufficient_information: true,
    requested_additional_images: [],
    missing_information: missing,
    htf_bias: bias,
    direction,
    setup_stage: stage,
    checklist,
    score,
    max_score: maxScore,
    grade: gradeFor(score, maxScore),
    visual_evidence:
      score >= scaled(R.evidenceHighScore)
        ? "HIGH"
        : score >= scaled(R.evidenceMediumScore)
          ? "MEDIUM"
          : "LOW",
    summary,
    entry_zone: entry === null ? null : fmt(entry, d),
    stop_loss: stop === null ? null : fmt(stop, d),
    tp1: tp1 === null ? null : fmt(tp1, d),
    tp2: tp2 === null ? null : fmt(tp2, d),
    risk_reward: rr,
    required_confirmation:
      direction === "POTENTIAL LONG" || direction === "POTENTIAL SHORT"
        ? ["Wait for price to reach the entry zone and hold it on the lower timeframe."]
        : ["Wait for a sweep followed by a structure break before acting."],
    invalidation: [
      stop !== null
        ? `A close beyond ${fmt(stop, d)} invalidates the idea.`
        : "A new structure break against the current bias invalidates the read.",
      brk ? `Losing ${fmt(brk.level, d)} again would break the current structure.` : "Structure is unconfirmed.",
    ],
    reasoning,
    provider_used: DEN_PROVIDER_LABEL,
    model_used: "den-analyzer",
  } satisfies MarketAnalysis;
}

/** Plain AnalysisResult view for the screenshot-free data mode. */
export function runDenAnalysisResult(input: DenInput): AnalysisResult {
  return runDenAnalysis(input);
}
