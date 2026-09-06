/**
 * AI analysis layer (server only).
 *
 * Responsibilities are deliberately narrow: the model reads the screenshots and
 * reports what it can observe. It NEVER produces win rates, accuracy figures or
 * totals — the score is recomputed here from clamped per-component values and
 * all historical numbers come from the statistics engine instead.
 */

import { chatWithFallback } from "./ai-gateway.server";
import { cascadeModels, isDenModel } from "./ai-models";
import { fetchLivePrice, checkPriceDrift } from "./live-price.server";
import {
  CHECKLIST_SPEC,
  MAX_SCORE,
  gradeFor,
  normalizeChecklist,
  totalScore,
  type AnalysisResult,
  type Direction,
  type SetupStage,
} from "./analysis-types";

export interface AnalyzeInput {
  images: { dataUrl: string; timeframe?: string | null }[];
  assetHint?: string | null;
  minRR: number;
  requireVolume: boolean;
  strictMode: boolean;
}

const MODEL = "google/gemini-2.5-pro";

function buildSystemPrompt(input: AnalyzeInput): string {
  const checklistRules = CHECKLIST_SPEC.map(
    (spec) => `- ${spec.key} (max ${spec.max}): ${spec.rule}`,
  ).join("\n");

  return `You are ChartPilot, a strict, evidence-based trading chart analyst. You are NOT a hype machine and NOT an autopilot.

ABSOLUTE RULES
1. Never invent anything. If a price level, swing point, liquidity area, FVG, volume, indicator, timeframe or ticker is not visibly readable in the screenshots, say "Not visible" or "Unclear". Accuracy matters more than producing an answer.
2. Never claim guaranteed profit, accuracy percentages, win probabilities or "you should trade". Never output a win rate — you have no historical data.
3. Never say "BUY NOW" or "SELL NOW". Use "POTENTIAL LONG" / "POTENTIAL SHORT" / "WAIT" / "NO TRADE" / "INSUFFICIENT DATA".
4. You are expected and encouraged to answer "NO TRADE" or "WAIT". ${input.strictMode ? "STRICT MODE IS ON: when evidence is insufficient or ambiguous, prefer WAIT or INSUFFICIENT DATA over guessing." : ""}
5. Do not force AMD, a liquidity sweep, an MSS/BOS or an FVG onto a chart. A wick alone is not a sweep. A green candle alone is not a bullish trend. Structure must come from meaningful swing points.
6. Be market-agnostic: crypto, forex, metals, indices and stocks all use the same framework, adjusted for session/instrument context. If the ticker is not confidently readable, set asset to "UNKNOWN" and ask the user.
7. Multiple screenshots are ONE setup across timeframes. Use the highest timeframe for directional bias and lower timeframes for entry confirmation. Identify each screenshot's timeframe only when it is legible; otherwise ask.
8. Volume: ${input.requireVolume ? "the user requires volume confirmation. If volume is not visible, request a screenshot with volume enabled." : "if volume is not visible, state 'Volume context unavailable' and score volume 0."}
9. The user's minimum acceptable reward-to-risk is ${input.minRR}:1. If measurable R:R is below that, flag it as unfavourable.
10. Prices may be expressed as approximate zones. Never fabricate false precision.

SUFFICIENCY CHECK (do this first)
Check readability of candles, price scale, timeframe, ticker, volume (if required), amount of visible history (~100 candles preferred), visible swing highs/lows, indicator clutter and cropping, plus whether a higher timeframe is present for bias.
If the evidence is insufficient, set sufficient_information=false, direction="INSUFFICIENT DATA", list exactly what is missing in missing_information, and put concrete, actionable requests in requested_additional_images (e.g. "Please upload a 4H chart showing the previous swing structure", "Please upload a 5M chart around the setup so I can confirm the MSS/BOS", "Please provide a wider screenshot showing at least 100 candles"). Still fill the checklist with what IS observable, scoring 0 where nothing is observable.

SCORING RULES (never exceed the maximum for a component)
${checklistRules}

Return ONLY minified JSON, no markdown fences, matching exactly:
{
 "asset": string,
 "market_type": "crypto"|"forex"|"stocks"|"commodities"|"indices"|"unknown",
 "timeframes": string[],
 "primary_timeframe": string|null,
 "sufficient_information": boolean,
 "requested_additional_images": string[],
 "missing_information": string[],
 "htf_bias": "BULLISH"|"BEARISH"|"RANGING"|"UNCONFIRMED",
 "direction": "POTENTIAL LONG"|"POTENTIAL SHORT"|"WAIT"|"NO TRADE"|"INSUFFICIENT DATA",
 "setup_stage": "SETUP FORMING"|"SETUP CONFIRMED"|"ENTRY AVAILABLE"|"ENTRY MISSED"|"SETUP INVALIDATED"|"NO TRADE",
 "visual_evidence": "HIGH"|"MEDIUM"|"LOW",
 "summary": string,
 "checklist": [{"key": string, "status": string, "score": number, "evidence": string, "confidence": "HIGH"|"MEDIUM"|"LOW", "missing": string|null}],
 "entry_zone": string|null,
 "stop_loss": string|null,
 "tp1": string|null,
 "tp2": string|null,
 "risk_reward": number|null,
 "required_confirmation": string[],
 "invalidation": string[],
 "reasoning": string[]
}

"visual_evidence" describes ONLY how clear the visual evidence in the screenshots is. It is not a probability of winning.
"summary" is 1-3 plain-English sentences a beginner can understand.
"reasoning" is 4-8 numbered plain-English steps teaching WHY this read exists (structure → liquidity → sweep → shift → displacement → entry zone → invalidation).
"invalidation" lists specific, observable conditions that would kill the setup.
Do NOT output a total score — it is computed outside the model.`;
}

const DIRECTIONS: Direction[] = [
  "POTENTIAL LONG",
  "POTENTIAL SHORT",
  "WAIT",
  "NO TRADE",
  "INSUFFICIENT DATA",
];

const STAGES: SetupStage[] = [
  "SETUP FORMING",
  "SETUP CONFIRMED",
  "ENTRY AVAILABLE",
  "ENTRY MISSED",
  "SETUP INVALIDATED",
  "NO TRADE",
];

function strArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .slice(0, limit)
    .map((item) => (item as string).trim().slice(0, 400));
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("The analysis engine returned an unreadable response. Please try again.");
  }
}

export async function runAnalysis(input: AnalyzeInput): Promise<AnalysisResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");
  if (!input.images.length) throw new Error("Upload at least one chart screenshot.");

  const userContent: unknown[] = [
    {
      type: "text",
      text: [
        `${input.images.length} chart screenshot(s) uploaded.`,
        input.assetHint ? `The user says the asset is: ${input.assetHint}.` : "Asset not provided by the user — read it from the chart or set UNKNOWN and ask.",
        input.images
          .map(
            (img, i) =>
              `Screenshot ${i + 1}: ${img.timeframe ? `user-labelled timeframe ${img.timeframe}` : "timeframe not labelled by the user"}.`,
          )
          .join(" "),
        "Perform the sufficiency check first, then the checklist. Return JSON only.",
      ].join(" "),
    },
    ...input.images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
  ];

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(input) },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 429) {
      throw new Error("Analysis rate limit reached. Please wait a moment and try again.");
    }
    if (response.status === 402) {
      throw new Error("AI credits are exhausted for this workspace.");
    }
    throw new Error(`Analysis failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The analysis engine returned an empty response.");

  const raw = parseJson(content);

  const checklist = normalizeChecklist(raw["checklist"]);
  const score = totalScore(checklist);

  const sufficient = raw["sufficient_information"] === true;
  let direction = DIRECTIONS.includes(raw["direction"] as Direction)
    ? (raw["direction"] as Direction)
    : "NO TRADE";
  let stage = STAGES.includes(raw["setup_stage"] as SetupStage)
    ? (raw["setup_stage"] as SetupStage)
    : "SETUP FORMING";

  // Hard guardrails the model cannot override.
  if (!sufficient) {
    direction = "INSUFFICIENT DATA";
    stage = "SETUP FORMING";
  } else if (input.strictMode && score < 7 && (direction === "POTENTIAL LONG" || direction === "POTENTIAL SHORT")) {
    // Strict mode: when in doubt, wait.
    direction = "WAIT";
    stage = "SETUP FORMING";
  }

  const rr = typeof raw["risk_reward"] === "number" && Number.isFinite(raw["risk_reward"])
    ? Math.max(0, Math.min(Number(raw["risk_reward"]), 50))
    : null;

  const asset = String(raw["asset"] ?? "").trim() || (input.assetHint ?? "UNKNOWN");

  const result: AnalysisResult = {
    asset: asset.toUpperCase().slice(0, 24),
    market_type: String(raw["market_type"] ?? "unknown").toLowerCase().slice(0, 20),
    timeframes: strArray(raw["timeframes"], 8),
    primary_timeframe: raw["primary_timeframe"] ? String(raw["primary_timeframe"]).slice(0, 8) : null,
    sufficient_information: sufficient,
    requested_additional_images: strArray(raw["requested_additional_images"], 8),
    missing_information: strArray(raw["missing_information"], 10),
    htf_bias: String(raw["htf_bias"] ?? "UNCONFIRMED").toUpperCase().slice(0, 20),
    direction,
    setup_stage: stage,
    checklist,
    score,
    max_score: MAX_SCORE,
    grade: gradeFor(score),
    visual_evidence:
      raw["visual_evidence"] === "HIGH" || raw["visual_evidence"] === "MEDIUM"
        ? (raw["visual_evidence"] as "HIGH" | "MEDIUM")
        : "LOW",
    summary: String(raw["summary"] ?? "").slice(0, 900),
    entry_zone: sufficient && raw["entry_zone"] ? String(raw["entry_zone"]).slice(0, 80) : null,
    stop_loss: sufficient && raw["stop_loss"] ? String(raw["stop_loss"]).slice(0, 80) : null,
    tp1: sufficient && raw["tp1"] ? String(raw["tp1"]).slice(0, 80) : null,
    tp2: sufficient && raw["tp2"] ? String(raw["tp2"]).slice(0, 80) : null,
    risk_reward: sufficient ? rr : null,
    required_confirmation: strArray(raw["required_confirmation"], 8),
    invalidation: strArray(raw["invalidation"], 8),
    reasoning: strArray(raw["reasoning"], 10),
  };

  // Live price cross-check (non-fatal: silently no-ops without FIRECRAWL_API_KEY).
  if (result.sufficient_information && result.asset && result.asset !== "UNKNOWN") {
    const live = await fetchLivePrice(result.asset, result.market_type);
    if (live) {
      result.live_price = live;
      result.price_drift_note = checkPriceDrift(result.entry_zone, live);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Data-based analysis (real OHLC candles instead of screenshots)     */
/* ------------------------------------------------------------------ */

export interface DataSeries {
  timeframe: string;
  candles: { time: string; open: number; high: number; low: number; close: number; volume: number | null }[];
}

export interface AnalyzeDataInput {
  symbol: string;
  series: DataSeries[];
  minRR: number;
  requireVolume: boolean;
  strictMode: boolean;
  model?: string | null;
  /** Editable Den Analyzer rulebook (ignored by the AI models). */
  denRules?: unknown;
}

function buildDataSystemPrompt(input: AnalyzeDataInput, hasVolume: boolean): string {
  const checklistRules = CHECKLIST_SPEC.map(
    (spec) => `- ${spec.key} (max ${spec.max}): ${spec.rule}`,
  ).join("\n");

  return `You are ChartPilot, a strict, evidence-based trading chart analyst. You are NOT a hype machine and NOT an autopilot.

You are reading REAL historical OHLC candle data (not screenshots). Every level you mention must be derivable from the numbers provided.

ABSOLUTE RULES
1. Never invent anything. If a price level, swing point, liquidity area, FVG, indicator or timeframe is not present in the provided data range, say "Not present in the provided data range" or "Unclear". Accuracy matters more than producing an answer.
2. Never claim guaranteed profit, accuracy percentages, win probabilities or "you should trade". Never output a win rate — you have no historical performance data.
3. Never say "BUY NOW" or "SELL NOW". Use "POTENTIAL LONG" / "POTENTIAL SHORT" / "WAIT" / "NO TRADE" / "INSUFFICIENT DATA".
4. You are expected and encouraged to answer "NO TRADE" or "WAIT". ${input.strictMode ? "STRICT MODE IS ON: when evidence is insufficient or ambiguous, prefer WAIT or INSUFFICIENT DATA over guessing." : ""}
5. Do not force AMD, a liquidity sweep, an MSS/BOS or an FVG onto the data. A single wick is not a sweep. One up candle is not a trend. Structure must come from meaningful swing points in the series.
6. Be market-agnostic: crypto, forex, metals, indices and stocks use the same framework. The symbol is given: ${input.symbol}.
7. Multiple timeframes are ONE setup. Use the highest timeframe for directional bias and lower timeframes for entry confirmation.
8. Volume: ${hasVolume ? "tick_volume values ARE present in the data — use them for real volume confirmation (compare recent volume against the average of the series, look for expansion on displacement and contraction in consolidation) and score the volume component on that evidence." : "tick_volume is missing or zero in this data — state 'Volume context unavailable' and score volume 0."}${input.requireVolume ? " The user requires volume confirmation." : ""}
9. The user's minimum acceptable reward-to-risk is ${input.minRR}:1. If measurable R:R is below that, flag it as unfavourable.
10. Prices come from real candles — quote levels with the same precision as the data, and use zones where appropriate.

SUFFICIENCY CHECK (do this first)
Check whether enough candles are present per timeframe, whether identifiable swing highs/lows exist, whether a higher timeframe is included for bias, and whether volume is present when required.
If the evidence is insufficient, set sufficient_information=false, direction="INSUFFICIENT DATA", list exactly what is missing in missing_information, and put concrete requests in requested_additional_images (here: which additional timeframes or longer history to include). Still fill the checklist with what IS observable, scoring 0 where nothing is observable.

SCORING RULES (never exceed the maximum for a component)
${checklistRules}

Return ONLY minified JSON, no markdown fences, matching exactly:
{
 "asset": string,
 "market_type": "crypto"|"forex"|"stocks"|"commodities"|"indices"|"unknown",
 "timeframes": string[],
 "primary_timeframe": string|null,
 "sufficient_information": boolean,
 "requested_additional_images": string[],
 "missing_information": string[],
 "htf_bias": "BULLISH"|"BEARISH"|"RANGING"|"UNCONFIRMED",
 "direction": "POTENTIAL LONG"|"POTENTIAL SHORT"|"WAIT"|"NO TRADE"|"INSUFFICIENT DATA",
 "setup_stage": "SETUP FORMING"|"SETUP CONFIRMED"|"ENTRY AVAILABLE"|"ENTRY MISSED"|"SETUP INVALIDATED"|"NO TRADE",
 "visual_evidence": "HIGH"|"MEDIUM"|"LOW",
 "summary": string,
 "checklist": [{"key": string, "status": string, "score": number, "evidence": string, "confidence": "HIGH"|"MEDIUM"|"LOW", "missing": string|null}],
 "entry_zone": string|null,
 "stop_loss": string|null,
 "tp1": string|null,
 "tp2": string|null,
 "risk_reward": number|null,
 "required_confirmation": string[],
 "invalidation": string[],
 "reasoning": string[]
}

"visual_evidence" describes ONLY how clear the evidence in the data is. It is not a probability of winning.
"summary" is 1-3 plain-English sentences a beginner can understand.
"reasoning" is 4-8 numbered plain-English steps teaching WHY this read exists (structure → liquidity → sweep → shift → displacement → entry zone → invalidation).
"invalidation" lists specific, observable price conditions that would kill the setup.
Do NOT output a total score — it is computed outside the model.`;
}

function seriesToText(series: DataSeries): string {
  const lines = series.candles
    .map(
      (c) =>
        `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume ?? ""}`,
    )
    .join("\n");
  return `TIMEFRAME ${series.timeframe} (${series.candles.length} candles, oldest first)\ntime,open,high,low,close,tick_volume\n${lines}`;
}

export async function runAnalysisFromData(input: AnalyzeDataInput): Promise<AnalysisResult> {
  const series = input.series.filter((set) => set.candles.length > 0);
  if (!series.length) throw new Error("No candles found for that symbol and timeframe selection.");

  if (isDenModel(input.model)) {
    const { runDenAnalysisResult } = await import("./den-analyzer.server");
    return runDenAnalysisResult({
      symbol: input.symbol,
      series,
      minRR: input.minRR,
      requireVolume: input.requireVolume,
      strictMode: input.strictMode,
      rules: input.denRules ?? null,
    });
  }

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project.");

  const hasVolume = series.some((set) =>
    set.candles.some((candle) => (candle.volume ?? 0) > 0),
  );

  const userText = [
    `Symbol: ${input.symbol}. Timeframes provided: ${series.map((s) => s.timeframe).join(", ")}.`,
    "Perform the sufficiency check first, then the checklist. Return JSON only.",
    "",
    ...series.map(seriesToText),
  ].join("\n");

  const { content, provider, model: servedModel } = await chatWithFallback(apiKey, cascadeModels(input.model), {
    messages: [
      { role: "system", content: buildDataSystemPrompt(input, hasVolume) },
      { role: "user", content: userText },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = parseJson(content);
  const checklist = normalizeChecklist(raw["checklist"]);
  const score = totalScore(checklist);

  const sufficient = raw["sufficient_information"] === true;
  let direction = DIRECTIONS.includes(raw["direction"] as Direction)
    ? (raw["direction"] as Direction)
    : "NO TRADE";
  let stage = STAGES.includes(raw["setup_stage"] as SetupStage)
    ? (raw["setup_stage"] as SetupStage)
    : "SETUP FORMING";

  if (!sufficient) {
    direction = "INSUFFICIENT DATA";
    stage = "SETUP FORMING";
  } else if (
    input.strictMode &&
    score < 7 &&
    (direction === "POTENTIAL LONG" || direction === "POTENTIAL SHORT")
  ) {
    direction = "WAIT";
    stage = "SETUP FORMING";
  }

  const rr =
    typeof raw["risk_reward"] === "number" && Number.isFinite(raw["risk_reward"])
      ? Math.max(0, Math.min(Number(raw["risk_reward"]), 50))
      : null;

  const timeframes = strArray(raw["timeframes"], 8);

  const result: AnalysisResult = {
    asset: input.symbol.toUpperCase().slice(0, 24),
    market_type: String(raw["market_type"] ?? "unknown").toLowerCase().slice(0, 20),
    timeframes: timeframes.length ? timeframes : series.map((s) => s.timeframe),
    primary_timeframe: raw["primary_timeframe"]
      ? String(raw["primary_timeframe"]).slice(0, 8)
      : (series[0]?.timeframe ?? null),
    sufficient_information: sufficient,
    requested_additional_images: strArray(raw["requested_additional_images"], 8),
    missing_information: strArray(raw["missing_information"], 10),
    htf_bias: String(raw["htf_bias"] ?? "UNCONFIRMED").toUpperCase().slice(0, 20),
    direction,
    setup_stage: stage,
    checklist,
    score,
    max_score: MAX_SCORE,
    grade: gradeFor(score),
    visual_evidence:
      raw["visual_evidence"] === "HIGH" || raw["visual_evidence"] === "MEDIUM"
        ? (raw["visual_evidence"] as "HIGH" | "MEDIUM")
        : "LOW",
    summary: String(raw["summary"] ?? "").slice(0, 900),
    entry_zone: sufficient && raw["entry_zone"] ? String(raw["entry_zone"]).slice(0, 80) : null,
    stop_loss: sufficient && raw["stop_loss"] ? String(raw["stop_loss"]).slice(0, 80) : null,
    tp1: sufficient && raw["tp1"] ? String(raw["tp1"]).slice(0, 80) : null,
    tp2: sufficient && raw["tp2"] ? String(raw["tp2"]).slice(0, 80) : null,
    risk_reward: sufficient ? rr : null,
    required_confirmation: strArray(raw["required_confirmation"], 8),
    invalidation: strArray(raw["invalidation"], 8),
    reasoning: strArray(raw["reasoning"], 10),
    provider_used: provider,
    model_used: servedModel,
  };

  // Live price cross-check (non-fatal: silently no-ops without FIRECRAWL_API_KEY).
  if (result.sufficient_information && result.asset && result.asset !== "UNKNOWN") {
    const live = await fetchLivePrice(result.asset, result.market_type);
    if (live) {
      result.live_price = live;
      result.price_drift_note = checkPriceDrift(result.entry_zone, live);
    }
  }

  return result;
}
