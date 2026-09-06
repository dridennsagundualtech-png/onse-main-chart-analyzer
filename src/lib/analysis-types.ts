/**
 * ChartPilot analysis contract.
 *
 * ONE scoring system, used by the AI layer, the UI, the database and the
 * statistics engine. Maximum total = 16. Scores are always clamped, so an
 * impossible score such as "16/10" can never be produced or displayed.
 */

export type ChecklistKey =
  | "htf_structure"
  | "support_resistance"
  | "liquidity"
  | "amd"
  | "liquidity_sweep"
  | "mss_bos"
  | "displacement"
  | "fvg"
  | "volume"
  | "risk_reward"
  // Smart Money Concepts components — scored by the Den Analyzer only.
  | "choch"
  | "order_block"
  | "breaker_block"
  | "fibonacci";

export interface ChecklistSpec {
  key: ChecklistKey;
  label: string;
  max: number;
  /** Plain-English explanation shown in a tooltip. */
  help: string;
  /** Rule the AI must follow to award points. */
  rule: string;
}

export const CHECKLIST_SPEC: ChecklistSpec[] = [
  {
    key: "htf_structure",
    label: "HTF Structure",
    max: 2,
    help: "HTF = higher timeframe. The bigger-picture trend read from meaningful swing highs and lows — not from the colour of the last candle.",
    rule: "2 = clear bullish or bearish sequence of swings visible on the highest uploaded timeframe. 1 = structure visible but mixed/ranging. 0 = unclear or not visible.",
  },
  {
    key: "support_resistance",
    label: "Support / Resistance",
    max: 1,
    help: "Zones (not exact prices) where price has repeatedly reacted: prior swings, breakout retests, range boundaries.",
    rule: "1 = the potential entry sits at a visible, previously respected zone. 0 = no meaningful level visible or entry is mid-range.",
  },
  {
    key: "liquidity",
    label: "Liquidity",
    max: 2,
    help: "Areas where resting orders/stops likely sit: previous highs and lows, equal highs/lows, range extremes. Location is inferred, never known.",
    rule: "2 = obvious liquidity both behind the entry and at the target. 1 = only one side visible. 0 = not identifiable from the screenshots.",
  },
  {
    key: "amd",
    label: "AMD Model",
    max: 2,
    help: "Accumulation → Manipulation → Distribution: a range, then a false break that takes liquidity, then a directional expansion.",
    rule: "2 = all three phases visible in sequence. 1 = partial (e.g. accumulation + manipulation only). 0 = not confirmed. Never force AMD onto a chart.",
  },
  {
    key: "liquidity_sweep",
    label: "Liquidity Sweep",
    max: 2,
    help: "Price trades through a prior high/low, then rejects or reclaims it. A wick alone is not a sweep.",
    rule: "2 = sweep plus visible rejection/reclaim. 1 = possible sweep, confirmation unclear. 0 = no sweep visible.",
  },
  {
    key: "mss_bos",
    label: "MSS / BOS",
    max: 2,
    help: "BOS = break of structure (trend continues). MSS = market structure shift (trend character changes).",
    rule: "2 = a named swing level was clearly broken and closed beyond. 1 = break in progress / unconfirmed. 0 = no structural break.",
  },
  {
    key: "displacement",
    label: "Displacement",
    max: 1,
    help: "A decisive, large-bodied move that is clearly bigger than surrounding candles and breaks structure.",
    rule: "1 = decisive expansion with follow-through. 0 = ordinary or unclear candles.",
  },
  {
    key: "fvg",
    label: "FVG / Imbalance",
    max: 1,
    help: "Fair Value Gap: an inefficiency left by a fast move that price often revisits.",
    rule: "1 = a clear unfilled or partially filled gap usable as an entry zone. 0 = none visible or candle detail insufficient.",
  },
  {
    key: "volume",
    label: "Volume",
    max: 1,
    help: "Relative volume: expansion on the break, contraction in the range. Never assume green volume means buyers won.",
    rule: "1 = volume visible AND supports the read. 0 = volume not visible, or visible but not supportive. If not visible, status must be 'Volume context unavailable'.",
  },
  {
    key: "risk_reward",
    label: "Risk / Reward",
    max: 2,
    help: "R:R compares potential reward with defined risk. It does NOT predict how often a trade wins.",
    rule: "2 = measurable R:R at or above the user's minimum. 1 = measurable but below minimum. 0 = cannot be measured from the screenshots.",
  },
];

export const MAX_SCORE = CHECKLIST_SPEC.reduce((sum, item) => sum + item.max, 0); // 16

/**
 * Extra Smart Money Concepts components. Only the rule-based Den Analyzer
 * scores these, so the AI checklist and its 16-point maximum stay unchanged.
 */
export const SMC_CHECKLIST_SPEC: ChecklistSpec[] = [
  {
    key: "choch",
    label: "Change of Character",
    max: 2,
    help: "CHoCH — the first structural break against the prevailing trend, the earliest hint the trend may be turning.",
    rule: "2 = a counter-trend swing was broken with a close beyond. 1 = counter-trend break wicked only. 0 = no counter-trend break.",
  },
  {
    key: "order_block",
    label: "Order Block",
    max: 2,
    help: "The last opposing candle before a strong displacement that broke structure — where institutional orders likely sit.",
    rule: "2 = fresh (unmitigated) order block and price is near it. 1 = order block exists but is mitigated or far away. 0 = none.",
  },
  {
    key: "breaker_block",
    label: "Breaker Block",
    max: 1,
    help: "An order block that failed — price broke through it and later returned to retest it from the other side.",
    rule: "1 = a failed order block has been retested or price is at it. 0 = no breaker.",
  },
  {
    key: "fibonacci",
    label: "Fibonacci & Premium/Discount",
    max: 1,
    help: "The dealing range from the recent swing high to swing low. Below 50% is discount (favours longs), above 50% is premium (favours shorts).",
    rule: "1 = price sits on the favourable side of equilibrium for the proposed direction (or in a key retracement zone). 0 = price is on the wrong side of 50%.",
  },
];

/** Every component the app knows about, AI-scored plus SMC extras. */
export const ALL_CHECKLIST_SPEC: ChecklistSpec[] = [...CHECKLIST_SPEC, ...SMC_CHECKLIST_SPEC];

export const CHECKLIST_BY_KEY: Record<ChecklistKey, ChecklistSpec> = Object.fromEntries(
  ALL_CHECKLIST_SPEC.map((item) => [item.key, item]),
) as Record<ChecklistKey, ChecklistSpec>;

export type Direction =
  | "POTENTIAL LONG"
  | "POTENTIAL SHORT"
  | "WAIT"
  | "NO TRADE"
  | "INSUFFICIENT DATA";

export type SetupStage =
  | "SETUP FORMING"
  | "SETUP CONFIRMED"
  | "ENTRY AVAILABLE"
  | "ENTRY MISSED"
  | "SETUP INVALIDATED"
  | "NO TRADE";

export type Outcome = "OPEN" | "WIN" | "LOSS" | "BREAKEVEN" | "INVALIDATED" | "MISSED" | "NO TRADE";

export const OUTCOMES: Outcome[] = [
  "OPEN",
  "WIN",
  "LOSS",
  "BREAKEVEN",
  "INVALIDATED",
  "MISSED",
  "NO TRADE",
];

export type Grade = "A" | "B" | "C" | "D";

export interface ChecklistItem {
  key: ChecklistKey;
  status: string;
  score: number;
  max: number;
  evidence: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  missing?: string | null;
}

export interface AnalysisResult {
  asset: string;
  market_type: string;
  timeframes: string[];
  primary_timeframe: string | null;
  sufficient_information: boolean;
  requested_additional_images: string[];
  missing_information: string[];
  htf_bias: string;
  direction: Direction;
  setup_stage: SetupStage;
  checklist: ChecklistItem[];
  score: number;
  max_score: number;
  grade: Grade;
  visual_evidence: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  entry_zone: string | null;
  stop_loss: string | null;
  tp1: string | null;
  tp2: string | null;
  risk_reward: number | null;
  required_confirmation: string[];
  invalidation: string[];
  reasoning: string[];
  /** Which provider/model actually served this analysis (data-mode only). */
  provider_used?: string | null;
  model_used?: string | null;
  /**
   * Live market price fetched via Firecrawl at analysis time. Only set when
   * FIRECRAWL_API_KEY is configured server-side and the asset is known —
   * absent otherwise, so nothing else in the app needs to change.
   */
  live_price?: { price: number; as_of: string; source: string } | null;
  /** Honest, non-predictive note comparing entry_zone to live_price. */
  price_drift_note?: string | null;
}

/**
 * Grade bands. The grade describes setup quality — never a probability.
 * Bands are proportional so a modular checklist with fewer active components
 * grades on the same scale as the full 16-point one.
 */
export function gradeFor(score: number, max: number = MAX_SCORE): Grade {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 13 / MAX_SCORE) return "A";
  if (ratio >= 10 / MAX_SCORE) return "B";
  if (ratio >= 7 / MAX_SCORE) return "C";
  return "D";
}

export const GRADE_LABEL: Record<Grade, string> = {
  A: "A — Strong setup",
  B: "B — Good setup",
  C: "C — Weak / mixed",
  D: "D — Poor / insufficient",
};

function clampInt(value: unknown, max: number): number {
  const n = typeof value === "number" ? Math.round(value) : Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), max);
}

/**
 * Rebuilds the checklist from the spec so that:
 * - every component exists exactly once,
 * - no component can exceed its maximum,
 * - the total is derived, never taken from the model.
 */
export function normalizeChecklist(
  raw: unknown,
  specs: ChecklistSpec[] = CHECKLIST_SPEC,
): ChecklistItem[] {
  const list = Array.isArray(raw) ? raw : [];
  return specs.map((spec) => {
    const found = list.find(
      (item) => item && typeof item === "object" && (item as { key?: string }).key === spec.key,
    ) as Partial<ChecklistItem> | undefined;

    const confidence =
      found?.confidence === "HIGH" || found?.confidence === "MEDIUM" ? found.confidence : "LOW";

    return {
      key: spec.key,
      max: spec.max,
      score: clampInt(found?.score, spec.max),
      status: (found?.status ?? "Not visible").toString().slice(0, 160),
      evidence: (found?.evidence ?? "No observable evidence in the uploaded screenshots.")
        .toString()
        .slice(0, 600),
      confidence,
      missing: found?.missing ? String(found.missing).slice(0, 300) : null,
    };
  });
}

export function checklistMax(checklist: ChecklistItem[]): number {
  return checklist.reduce((sum, item) => sum + item.max, 0);
}

export function totalScore(checklist: ChecklistItem[]): number {
  return Math.min(
    checklist.reduce((sum, item) => sum + clampInt(item.score, item.max), 0),
    checklistMax(checklist),
  );
}

/** Sample-size language. Never present a rate without this context. */
export type SampleTier = "insufficient" | "early" | "developing" | "meaningful";

export function sampleTier(n: number): SampleTier {
  if (n < 20) return "insufficient";
  if (n < 50) return "early";
  if (n < 100) return "developing";
  return "meaningful";
}

export const SAMPLE_TIER_LABEL: Record<SampleTier, string> = {
  insufficient: "Insufficient evidence",
  early: "Early sample — highly uncertain",
  developing: "Developing evidence",
  meaningful: "More meaningful historical sample",
};

export const GLOSSARY: Record<string, string> = {
  HTF: "Higher timeframe — the bigger-picture chart (1D/4H) used for directional context.",
  MTF: "Middle timeframe (usually 1H) — bridges bias and entry.",
  LTF: "Lower timeframe (15M/5M) — used only for entry confirmation.",
  Liquidity:
    "Areas where resting orders and stops likely sit — previous highs/lows, equal highs/lows, range extremes. Inferred from the chart, never known for certain.",
  "Liquidity Sweep":
    "Price trades through a prior high or low and then rejects or reclaims it. A wick on its own is not a sweep.",
  AMD: "Accumulation → Manipulation → Distribution. A range, then a false break taking liquidity, then a directional expansion.",
  MSS: "Market Structure Shift — the trend's character changes (e.g. a lower high breaks in a downtrend).",
  BOS: "Break of Structure — an existing trend continues by breaking its last swing point.",
  Displacement:
    "A decisive, large-bodied move clearly bigger than surrounding candles, usually breaking structure.",
  FVG: "Fair Value Gap — an inefficiency left behind by a fast move that price often revisits.",
  R: "One unit of risk: the distance between entry and stop. +2R means twice the risked amount.",
  "R:R": "Reward-to-risk ratio. It measures potential payoff, not the probability of winning.",
};

/**
 * Kid-simple explanations. Every technical word in the UI gets a question mark
 * that opens one of these — plain words first, jargon second.
 */
export const SIMPLE_TERMS: Record<string, string> = {
  HTF: "The big-picture chart. Like looking at a whole city from a plane instead of one street.",
  MTF: "The medium chart. Between the big picture and the close-up.",
  LTF: "The close-up chart. Like using a magnifying glass to pick the exact moment.",
  Liquidity:
    "Places on the chart where lots of people probably have orders waiting — like a cookie jar price likes to reach into.",
  "Liquidity Sweep":
    "Price pokes above a top (or below a bottom) to grab those waiting orders, then turns back around. Like someone opening a door, grabbing candy, and shutting it again.",
  AMD: "A three-step story: price rests quietly, then tricks people with a fake move, then runs strongly in the real direction.",
  MSS: "The trend changes its mind. It was going down, now it starts going up.",
  BOS: "The trend keeps going and breaks past its last stopping point.",
  Displacement: "One big, strong candle — like a sudden sprint instead of a slow walk.",
  FVG: "A gap price left behind when it moved too fast. Price often comes back to fill it in, like tidying a skipped spot.",
  R: "One 'R' is the amount of money you agreed to risk. +2R means you made twice that. -1R means you lost it.",
  "R:R": "How much you could win compared to how much you could lose. It does NOT say how often you win.",
  "HTF bias": "Which way the big-picture chart is leaning right now: up, down, or unsure.",
  "Setup quality": "A score out of 16 for how many good things this chart has. A tidy checklist, not a promise.",
  "Visual evidence": "How clearly the app can SEE these things in your picture. Not a chance of winning.",
  "Historical edge":
    "How similar setups you saved in the past actually ended. It only shows up once you have enough of them.",
  "Sample quality": "Whether you have enough past trades for the numbers to mean anything yet.",
  "Comparable setups": "Past trades that look a lot like this one, so comparing them is fair.",
  "Win rate": "Out of every 100 finished trades, how many made money.",
  Expectancy: "On average, how much you win or lose per trade, counted in R.",
  "Profit factor": "All the money won divided by all the money lost. Above 1 means more won than lost.",
  "Max drawdown": "The biggest drop from your best point. How much it hurt at the worst moment.",
  "Avg R": "The average result of your trades, in R.",
  Breakeven: "The trade ended with no real win and no real loss.",
  "Entry zone": "The price area where the plan would start, if the conditions happen.",
  "Stop loss": "The 'I was wrong' price. You get out here so a small loss stays small.",
  TP1: "The first place you could take some profit.",
  TP2: "A further place you could take profit if price keeps going.",
  "Position size": "How much to buy or sell so that being wrong only costs your chosen risk.",
  "Risk per trade": "The slice of your money you allow yourself to lose on one trade.",
  Outcome: "What actually happened: win, loss, breakeven, or the setup never happened.",
  Invalidation: "Signs that the idea is broken. If these happen, cancel the plan.",
  "Setup stage": "How far along the idea is: still forming, ready, already gone, or dead.",
  Grade: "A simple letter (A to D) for how strong the checklist score was.",
  "Required confirmation": "Things that must happen first. Until then, you wait and do nothing.",
  Timeframe: "How much time each candle on the chart covers — 5 minutes, 1 hour, 1 day, and so on.",
  "HTF Structure": "Is the big picture making higher steps (up) or lower steps (down)?",
  "Support / Resistance": "Price areas where the chart has bounced or stopped before, like a floor and a ceiling.",
  "MSS / BOS": "Either the trend changed its mind (MSS) or it carried on past its last stop (BOS).",
  "FVG / Imbalance": "A skipped spot left by a very fast move that price often returns to.",
  Volume: "How busy the market was. Tall volume bars mean lots of people were trading.",
  "Risk / Reward": "Possible win compared to possible loss — never a promise of winning.",
  "Change of Character":
    "The first time price breaks the other way. A hint the trend might be about to turn around.",
  "Order Block": "The last candle going the other way just before a big push — a spot price often comes back to.",
  "Breaker Block": "An order block that broke. Price comes back to it later and it now works the opposite way.",
  "Fibonacci & Premium/Discount":
    "Split the recent move in half. Cheap half (discount) is better for buying, expensive half (premium) is better for selling.",
  Trades: "How many finished trades are counted in these numbers.",
  "Avg winner": "On your winning trades, the average amount won, in R.",
  "Avg loser": "On your losing trades, the average amount lost, in R.",
  Cumulative: "Everything added up so far, in R.",
  "Max loss": "The most money you would lose on this trade if the stop is hit.",
  "Stop / invalidation": "The 'I was wrong' price. You get out here so a small loss stays small.",
  Stage: "How far along the idea is: still forming, ready, already gone, or dead.",
  Asset: "The thing being traded, like gold, Bitcoin, or a company share.",
  "Setup checklist": "A list of good things to look for. More boxes ticked means a tidier idea.",
  "AMD Model": "The three-step story: quiet range, fake move that tricks people, then the real run.",
  "Market type": "What kind of market it is: crypto, shares, gold, currencies, and so on.",
  "Conditional trade plan":
    "An 'only if' plan. It only counts if the listed conditions actually happen. It is not a promise.",
  "Required confirmation before considering entry":
    "Proof you wait for before doing anything. Like waiting for the green man before crossing the road.",
  "Invalidation watch": "Warning signs that the idea is broken and should be dropped.",
  "Historical evidence": "What happened in your own past trades that looked like this one.",
  "Risk management": "Deciding beforehand how much you could lose, so one bad trade cannot hurt much.",
  "In plain English": "The same idea, explained with simple everyday words.",
  "Why this read": "The step-by-step reasons behind this opinion, so you can learn the thinking.",
  "Journal this setup": "Writing down what really happened, so the numbers can be honest later.",
};


export const DISCLAIMER =
  "ChartPilot is an educational analysis assistant, not financial advice. Every trade plan is conditional, not a prediction or an instruction to trade. Nothing here guarantees any result.";
