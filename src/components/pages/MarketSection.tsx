import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Calculator, Camera, ChevronDown, Database, Loader2, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CandlePresets } from "@/components/CandlePresets";
import { TradingSessionCard } from "@/components/TradingSessionCard";
import { DenRulesEditor } from "@/components/DenRulesEditor";
import { MarketChart } from "@/components/MarketChart";
import { ResultView } from "@/components/ResultView";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useAccess } from "@/lib/account";
import { CHECKLIST_BY_KEY, DISCLAIMER } from "@/lib/analysis-types";
import { captureElement, screenshotFilename } from "@/lib/capture";
import { DEFAULT_SETTINGS, LOCAL_USER, useAnalyses, useSaveAnalysis, useSaveScreenshot, useSaveSettings, useSettings } from "@/lib/data";
import type { DenRules } from "@/lib/den-rules";
import {
  analyzeMarketData,
  listMarketFreshness,
  listMarketSymbols,
  listMarketTimeframes,
} from "@/lib/market.functions";
import { runDenLive } from "@/lib/den-analyzer.functions";
import {
  ageMinutes,
  classifyFreshness,
  formatAge,
  VERY_STALE_HINT,
  type FreshnessRow,
} from "@/lib/freshness";
import { cn } from "@/lib/utils";
import { inSelectedSessions } from "@/lib/sessions";
import { useSessionFilter } from "@/lib/useSessionFilter";
import type { MarketAnalysis } from "@/lib/market-types";
import { ModelPicker } from "@/components/ModelPicker";
import { DEFAULT_ANALYSIS_MODEL } from "@/lib/ai-models";


const DEFAULT_TFS = ["1D", "D1", "4H", "H4", "1H", "H1", "15M", "M15", "5M", "M5"];


function MarketAnalyze() {
  const { access, session, loading } = useAccess();
  const settingsQuery = useSettings();
  const analysesQuery = useAnalyses();
  const listFn = useServerFn(listMarketSymbols);
  const timeframesFn = useServerFn(listMarketTimeframes);
  const freshnessFn = useServerFn(listMarketFreshness);
  const analyzeFn = useServerFn(analyzeMarketData);
  const denLiveFn = useServerFn(runDenLive);
  const saveAnalysis = useSaveAnalysis();
  const saveScreenshot = useSaveScreenshot();
  const saveSettings = useSaveSettings();

  const [symbol, setSymbol] = useState<string>("");
  const [timeframes, setTimeframes] = useState<string[]>([]);
  const [candleCounts, setCandleCounts] = useState<Record<string, number>>({});
  const [result, setResult] = useState<MarketAnalysis | null>(null);
  const [running, setRunning] = useState(false);
  const [denResult, setDenResult] = useState<MarketAnalysis | null>(null);
  const [denRunning, setDenRunning] = useState(false);
  const [doubleCheck, setDoubleCheck] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [denRules, setDenRules] = useState<Partial<DenRules>>({});
  const [model, setModel] = useState<string>(DEFAULT_ANALYSIS_MODEL);
  const [showTfReads, setShowTfReads] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [divergence, setDivergence] = useState<
    { direction: string; summary: string }[] | null
  >(null);

  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const { filter: sessionFilter } = useSessionFilter();

  const countFor = (tf: string) => candleCounts[tf] ?? 150;


  const isAdmin = Boolean(access?.isAdmin);

  const symbolsQuery = useQuery({
    queryKey: ["market-symbols"],
    enabled: isAdmin,
    queryFn: () => listFn({}) as Promise<string[]>,
  });

  const timeframesQuery = useQuery({
    queryKey: ["market-timeframes", symbol],
    enabled: isAdmin && Boolean(symbol),
    queryFn: () => timeframesFn({ data: { symbol } }) as Promise<string[]>,
  });

  const sortedTfs = [...timeframes].sort();
  const freshnessQuery = useQuery({
    queryKey: ["market-freshness", symbol, sortedTfs.join(",")],
    enabled: isAdmin && Boolean(symbol) && sortedTfs.length > 0,
    refetchInterval: 60_000,
    queryFn: () =>
      freshnessFn({ data: { symbol, timeframes: sortedTfs } }) as Promise<FreshnessRow[]>,
  });

  useEffect(() => {
    if (!symbol && symbolsQuery.data?.length) setSymbol(symbolsQuery.data[0]!);
  }, [symbol, symbolsQuery.data]);

  // Preselect the classic D1→M5 set when it exists, otherwise everything stored.
  useEffect(() => {
    const available = timeframesQuery.data;
    if (!available?.length) return;
    setTimeframes((current) => {
      const kept = current.filter((tf) => available.includes(tf));
      if (kept.length) return kept.length === current.length ? current : kept;
      const preferred = available.filter((tf) => DEFAULT_TFS.includes(tf.toUpperCase()));
      return preferred.length ? preferred : available.slice(0, 5);
    });
  }, [timeframesQuery.data]);

  const toggleTimeframe = (tf: string) =>
    setTimeframes((current) =>
      current.includes(tf) ? current.filter((item) => item !== tf) : [...current, tf],
    );

  const availableTfs = timeframesQuery.data ?? [];
  const freshness = freshnessQuery.data ?? [];


  const settings = settingsQuery.data ?? { user_id: LOCAL_USER, ...DEFAULT_SETTINGS };

  useEffect(() => {
    if (settingsQuery.data?.den_rules) setDenRules(settingsQuery.data.den_rules);
  }, [settingsQuery.data]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!session || !isAdmin) {
    return (
      <section className="card-soft space-y-3 p-5 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-warn/15 text-warn">
          <ShieldCheck className="size-5" />
        </span>
        <h1 className="font-display text-xl font-semibold">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          Live market analysis reads the shared market-data table and is restricted to the admin
          account.
        </p>
        <Button asChild variant="secondary" className="rounded-xl">
          <Link to="/settings">Go to settings</Link>
        </Button>
      </section>
    );
  }

  const save = async (analysis: MarketAnalysis) => {
    try {
      await saveAnalysis.mutateAsync({ result: analysis, images: [], source: "admin_market" });
    } catch {
      toast.error("Analysis ran but could not be saved to admin history.");
    }
  };

  const captureToJournal = async () => {
    const node = captureRef.current;
    if (!node || !result) {
      toast.error("Run an analysis first.");
      return;
    }
    setCapturing(true);
    try {
      const file = await captureElement(
        node,
        screenshotFilename(result.symbol ?? "chart"),
      );
      await saveAnalysis.mutateAsync({
        result,
        images: [{ file, timeframe: result.primary_timeframe ?? null }],
        source: "admin_market",
      });
      await saveScreenshot.mutateAsync({
        file,
        title: `${result.symbol} ${result.primary_timeframe ?? ""}`.trim(),
        symbol: result.symbol ?? null,
        timeframe: result.primary_timeframe ?? null,
      });
      toast.success("Screenshot and analysis saved to your journal.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the screenshot to the journal.",
      );
    } finally {
      setCapturing(false);
    }
  };

  const run = async () => {
    if (sessionFilter.enabled && !inSelectedSessions(new Date(), sessionFilter.sessions)) {
      toast.error("Outside your selected trading sessions — analysis is paused.");
      return;
    }
    if (!symbol) {
      toast.error("Pick a symbol first.");
      return;
    }
    if (!timeframes.length) {
      toast.error("Pick at least one timeframe.");
      return;
    }
    setRunning(true);
    setResult(null);
    setDivergence(null);
    const payload = {
      symbol,
      timeframes,
      candleCount: 150,
      candleCounts: Object.fromEntries(timeframes.map((tf) => [tf, countFor(tf)])),

      minRR: Number(settings.min_rr),
      strictMode: settings.strict_mode,
      requireVolume: settings.require_volume,
      model,
    };
    try {
      const first = (await analyzeFn({ data: payload })) as MarketAnalysis;

      if (!doubleCheck) {
        setResult(first);
        void save(first);
        return;
      }

      const second = (await analyzeFn({ data: payload })) as MarketAnalysis;

      if (first.direction === second.direction) {
        setResult(first);
        void save(first);
        return;
      }

      setDivergence([
        { direction: String(first.direction), summary: first.summary },
        { direction: String(second.direction), summary: second.summary },
      ]);
      const waited = {
        ...first,
        direction: "WAIT" as MarketAnalysis["direction"],
        setup_stage: "SETUP FORMING" as MarketAnalysis["setup_stage"],
      };
      setResult(waited);
      void save(waited);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The market analysis failed. Try again.");
    } finally {
      setRunning(false);
    }
  };

  const runDen = async () => {
    if (!symbol) {
      toast.error("Pick a symbol first.");
      return;
    }
    if (!timeframes.length) {
      toast.error("Pick at least one timeframe.");
      return;
    }
    setDenRunning(true);
    setDenResult(null);
    try {
      const analysis = (await denLiveFn({
        data: {
          symbol,
          timeframes,
          candleCount: 150,
          candleCounts: Object.fromEntries(timeframes.map((tf) => [tf, countFor(tf)])),
          minRR: Number(settings.min_rr),
          strictMode: settings.strict_mode,
          requireVolume: settings.require_volume,
          denRules,
        },
      })) as MarketAnalysis;
      setDenResult(analysis);
      try {
        await saveAnalysis.mutateAsync({ result: analysis, images: [], source: "den_live" });
      } catch {
        toast.error("Den Analyzer ran but could not be saved to history.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The Den Analyzer run failed.");
    } finally {
      setDenRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <TradingSessionCard />

      <section className="card-soft p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="size-3.5 text-primary" /> Admin · market data engine
        </div>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-tight">
          Multi-timeframe read from live candle data
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No screenshots. This pulls the most recent candles straight from your market-data table and
          analyses them with the same 16-point checklist.
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Timeframes are read straight from your market-data table, so any new one you start storing
          (1M, 30M, …) shows up here automatically.
        </p>
      </section>

      <section className="card-soft space-y-3 p-5">
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Symbol</span>
          {symbolsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading symbols…</p>
          ) : symbolsQuery.data?.length ? (
            <div className="flex flex-wrap gap-2">
              {symbolsQuery.data.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSymbol(item)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    symbol === item
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-elevated text-muted-foreground"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No symbols found in the market-data table yet.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Timeframes</span>
          {timeframesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading timeframes…</p>
          ) : availableTfs.length ? (
            <div className="flex flex-wrap gap-2">
              {availableTfs.map((tf) => {
                const on = timeframes.includes(tf);
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => toggleTimeframe(tf)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs transition-colors",
                      on
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-elevated text-muted-foreground",
                    )}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No timeframes stored for {symbol || "this symbol"} yet.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <CandlePresets
            timeframes={timeframes}
            availableTimeframes={availableTfs}
            counts={candleCounts}
            onApply={(next) => setCandleCounts((current) => ({ ...current, ...next }))}
            onApplyTimeframes={(next) => setTimeframes(next)}
          />
          <span className="block text-sm font-medium">Candles per timeframe</span>
          {timeframes.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Pick a timeframe above to set how many candles it loads.
            </p>
          ) : (
            <div className="space-y-3">
              {timeframes.map((tf) => (
                <div key={tf} className="panel space-y-2 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">{tf}</span>
                    <span className="text-xs font-semibold text-primary">{countFor(tf)}</span>
                  </div>
                  <Slider
                    value={[countFor(tf)]}
                    min={10}
                    max={300}
                    step={5}
                    onValueChange={(value) =>
                      setCandleCounts((current) => ({ ...current, [tf]: value[0] ?? 150 }))
                    }
                    aria-label={`Candles for ${tf}`}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Fewer candles = tighter focus on recent price. More candles = broader structure. Range 10
            to 300 per timeframe.
          </p>
        </div>


        {timeframes.length > 0 && (
          <div className="panel space-y-1 p-3">
            <p className="text-xs font-semibold">Last candle updated</p>
            {freshnessQuery.isLoading ? (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Checking data freshness…
              </p>
            ) : (
              freshness.map((row) => {
                const level = classifyFreshness(row.timeframe, row.lastTime);
                const age = ageMinutes(row.lastTime);
                return (
                  <div
                    key={row.timeframe}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="font-medium">{row.timeframe}</span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-right",
                        level === "fresh" && "text-bull",
                        level === "stale" && "text-warn",
                        level === "very-stale" && "text-destructive",
                        level === "unknown" && "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full bg-current",
                          level === "unknown" && "opacity-50",
                        )}
                      />
                      {level === "unknown"
                        ? "No candles stored"
                        : level === "very-stale"
                          ? `${formatAge(age)} — ${VERY_STALE_HINT}`
                          : formatAge(age)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}

        <ModelPicker value={model} onChange={setModel} />

        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full justify-between rounded-xl"
            onClick={() => setShowRules((open) => !open)}
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" /> Den Analyzer rulebook
            </span>
            <ChevronDown className={cn("size-4 transition-transform", showRules && "rotate-180")} />
          </Button>

          {showRules && (
            <div className="space-y-3">
              <DenRulesEditor value={denRules} onChange={setDenRules} />
              <Button
                type="button"
                variant="secondary"
                className="h-11 w-full rounded-xl"
                disabled={saveSettings.isPending}
                onClick={() =>
                  saveSettings.mutate(
                    { den_rules: denRules },
                    {
                      onSuccess: () => toast.success("Den Analyzer rulebook saved."),
                      onError: () => toast.error("Could not save the rulebook."),
                    },
                  )
                }
              >
                {saveSettings.isPending ? "Saving rulebook…" : "Save rulebook"}
              </Button>
            </div>
          )}
        </div>


        <div className="panel flex items-start justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Double-check this analysis</p>
            <p className="text-xs text-muted-foreground">
              Runs the analysis twice and flags any disagreement on direction. Off by default —
              turning it on uses roughly double the AI credits for that analysis.
            </p>
          </div>
          <Switch
            checked={doubleCheck}
            onCheckedChange={setDoubleCheck}
            aria-label="Double-check this analysis"
          />
        </div>

        <Button className="h-12 w-full rounded-xl text-base" onClick={run} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {running ? "Analysing candles…" : "Analyze market data"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 w-full rounded-xl border-bull/50 bg-bull/10 text-base text-bull hover:bg-bull/20"
          onClick={runDen}
          disabled={denRunning}
        >
          {denRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Calculator className="size-4" />
          )}
          {denRunning ? "Running the rules…" : "Analyze now (Den Analyzer — free, no AI)"}
          <span className="ml-2 rounded-full border border-bull/50 px-2 py-0.5 text-[10px] font-semibold">
            0 credits
          </span>
        </Button>

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          {DISCLAIMER}
        </p>
      </section>

      {denResult && (
        <section className="card-soft space-y-4 p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-bull">
            <Calculator className="size-3.5" /> Den Analyzer — rule-based, not AI
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">
              {denResult.direction} · {denResult.score}/{denResult.max_score} ({denResult.grade})
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {denResult.symbol} · {denResult.setup_stage} · HTF bias {denResult.htf_bias} · data as of{" "}
              {denResult.data_as_of ? denResult.data_as_of.slice(0, 16) : "unknown"}
            </p>
            <p className="mt-2 text-sm leading-relaxed">{denResult.summary}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Entry", value: denResult.entry_zone },
              { label: "Stop", value: denResult.stop_loss },
              { label: "TP1", value: denResult.tp1 },
              { label: "TP2", value: denResult.tp2 },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-border bg-elevated p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-sm font-medium">{item.value ?? "—"}</p>
              </div>
            ))}
          </div>
          {denResult.risk_reward != null && (
            <p className="text-xs text-muted-foreground">
              Measured reward-to-risk: {denResult.risk_reward}:1
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Checklist</p>
            {denResult.checklist.map((item) => (
              <div key={item.key} className="rounded-2xl border border-border bg-elevated p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">{CHECKLIST_BY_KEY[item.key]?.label ?? item.key}</p>
                  <span className="text-xs font-semibold text-primary">
                    {item.score}/{item.max}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {item.evidence || item.status}
                </p>
              </div>
            ))}
          </div>

          {denResult.reasoning.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Reasoning</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
                {denResult.reasoning.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {denResult.invalidation.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Invalidation</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm">
                {denResult.invalidation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <MarketChart result={denResult} />
        </section>
      )}

      {divergence && (
        <section className="card-soft p-5">
          <div className="flex items-center gap-2 text-xs text-warn">
            <AlertTriangle className="size-3.5" /> The two runs disagreed — direction forced to WAIT
          </div>
          <h2 className="mt-2 font-display text-base font-semibold">Double-check comparison</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {divergence.map((run_, index) => (
              <div
                key={`run-${index}`}
                className="rounded-2xl border border-border bg-elevated p-3"
              >
                <p className="text-xs font-semibold text-muted-foreground">Run {index + 1}</p>
                <p className="mt-1 text-sm font-semibold text-primary">{run_.direction}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {run_.summary}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {result && (
        <>
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full rounded-xl"
            onClick={captureToJournal}
            disabled={capturing || saveAnalysis.isPending}
          >
            {capturing ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            {capturing ? "Capturing…" : "Save screenshot to journal"}
          </Button>

          <div ref={captureRef} className="space-y-5 bg-background">
          <section className="card-soft p-5">
            <h2 className="font-display text-base font-semibold">Market summary</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {result.symbol} · data as of {result.data_as_of ? result.data_as_of.slice(0, 16) : "unknown"}
            </p>
            <p className="mt-3 text-sm leading-relaxed">{result.summary}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-muted-foreground">Resistance (above)</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {result.resistance_levels.length ? (
                    result.resistance_levels.map((level) => <li key={level}>{level}</li>)
                  ) : (
                    <li className="text-muted-foreground">None identifiable.</li>
                  )}
                </ul>
              </div>
              <div className="rounded-2xl border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-muted-foreground">Support (below)</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {result.support_levels.length ? (
                    result.support_levels.map((level) => <li key={level}>{level}</li>)
                  ) : (
                    <li className="text-muted-foreground">None identifiable.</li>
                  )}
                </ul>
              </div>
            </div>

            {result.momentum && (
              <div className="mt-3 rounded-2xl border border-border bg-elevated p-3">
                <p className="text-xs font-semibold text-muted-foreground">Momentum</p>
                <p className="mt-1.5 text-sm leading-relaxed">{result.momentum}</p>
              </div>
            )}
          </section>

          <MarketChart result={result} />
          </div>

          {result.timeframe_reads.length > 0 && (
            <section className="card-soft p-5">
              <button
                type="button"
                onClick={() => setShowTfReads((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <h2 className="font-display text-base font-semibold">Timeframe by timeframe</h2>
                <ChevronDown
                  className={cn("size-4 transition-transform", showTfReads && "rotate-180")}
                />
              </button>
              {showTfReads && (
                <ul className="mt-3 space-y-3">
                  {result.timeframe_reads.map((item) => (
                    <li key={item.timeframe} className="rounded-2xl border border-border bg-elevated p-3">
                      <p className="text-xs font-semibold text-primary">{item.timeframe}</p>
                      <p className="mt-1 text-sm leading-relaxed">{item.read}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card-soft p-5">
            <button
              type="button"
              onClick={() => setShowStats((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <div>
                <h2 className="font-display text-base font-semibold">Measured statistics</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Computed in code from the candles — not from the model.
                </p>
              </div>
              <ChevronDown className={cn("size-4 transition-transform", showStats && "rotate-180")} />
            </button>
            <div className={cn("mt-3 overflow-x-auto", !showStats && "hidden")}>
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">TF</th>
                    <th className="py-1 pr-3">Close</th>
                    <th className="py-1 pr-3">Trend</th>
                    <th className="py-1 pr-3">EMA20/50</th>
                    <th className="py-1 pr-3">ATR14</th>
                    <th className="py-1 pr-3">Range</th>
                    <th className="py-1 pr-3">Pos%</th>
                    <th className="py-1">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {result.stats.map((stat) => (
                    <tr key={stat.timeframe} className="border-t border-border/60">
                      <td className="py-1.5 pr-3 font-medium">{stat.timeframe}</td>
                      <td className="py-1.5 pr-3">{stat.last_close ?? "—"}</td>
                      <td className="py-1.5 pr-3">{stat.trend}</td>
                      <td className="py-1.5 pr-3">
                        {stat.ema20 ?? "—"} / {stat.ema50 ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3">{stat.atr14 ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        {stat.range_low ?? "—"}–{stat.range_high ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3">{stat.range_position_pct ?? "—"}</td>
                      <td className="py-1.5">{stat.volume_trend}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ResultView
            result={result}
            journal={analysesQuery.data ?? []}
            settings={settings}
            savedRow={null}
          />
        </>
      )}
    </div>
  );
}

export function MarketSection() {
  return <MarketAnalyze />;
}
