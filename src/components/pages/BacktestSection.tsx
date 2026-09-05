import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useAccess } from "@/lib/account";
import { runBacktest } from "@/lib/backtest.functions";
import type { BacktestResult } from "@/lib/den-backtest.server";
import { listMarketSymbols, listMarketTimeframes } from "@/lib/market.functions";
import { cn } from "@/lib/utils";

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function rr(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

export function BacktestSection() {
  const { access, loading } = useAccess();
  const isAdmin = Boolean(access?.isAdmin);

  const symbolsFn = useServerFn(listMarketSymbols);
  const timeframesFn = useServerFn(listMarketTimeframes);
  const backtestFn = useServerFn(runBacktest);

  const [symbol, setSymbol] = useState("");
  const [timeframes, setTimeframes] = useState<string[]>([]);
  const [stepTf, setStepTf] = useState("");
  const [candleCount, setCandleCount] = useState(400);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [showComponents, setShowComponents] = useState(false);

  const symbolsQuery = useQuery({
    queryKey: ["market-symbols"],
    enabled: isAdmin,
    queryFn: () => symbolsFn({}) as Promise<string[]>,
  });

  const timeframesQuery = useQuery({
    queryKey: ["market-timeframes", symbol],
    enabled: isAdmin && Boolean(symbol),
    queryFn: () => timeframesFn({ data: { symbol } }) as Promise<string[]>,
  });

  useEffect(() => {
    if (!symbol && symbolsQuery.data?.length) setSymbol(symbolsQuery.data[0]!);
  }, [symbol, symbolsQuery.data]);

  const availableTfs = timeframesQuery.data ?? [];

  useEffect(() => {
    if (!availableTfs.length) return;
    setTimeframes((current) => {
      const kept = current.filter((tf) => availableTfs.includes(tf));
      return kept.length ? kept : availableTfs.slice(0, 3);
    });
  }, [timeframesQuery.data]);

  useEffect(() => {
    if (timeframes.length && !timeframes.includes(stepTf)) {
      setStepTf(timeframes[timeframes.length - 1]!);
    }
  }, [timeframes, stepTf]);

  const toggleTf = (tf: string) =>
    setTimeframes((current) =>
      current.includes(tf) ? current.filter((item) => item !== tf) : [...current, tf],
    );

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const data = (await backtestFn({
        data: { symbol, timeframes, stepTimeframe: stepTf, candleCount },
      })) as BacktestResult;
      setResult(data);
      toast.success(`${data.totalSetups} setups found across ${data.steps} simulated steps.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backtest failed.");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking access…
      </p>
    );
  }

  if (!isAdmin) {
    return (
      <div className="card-soft space-y-2 p-6">
        <ShieldCheck className="size-5 text-primary" />
        <h1 className="font-display text-lg font-semibold">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          The Den Analyzer backtest is restricted to admin accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="card-soft space-y-4 p-5">
        <div>
          <h1 className="font-display text-lg font-semibold">Backtest</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Walk-forward replay of the rule-based Den Analyzer. At every step the engine only sees
            candles that existed at that moment, on every timeframe — no lookahead.
          </p>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Symbol</span>
          <div className="flex flex-wrap gap-2">
            {(symbolsQuery.data ?? []).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setSymbol(item)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  item === symbol
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-elevated text-muted-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Timeframes</span>
          <div className="flex flex-wrap gap-2">
            {availableTfs.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => toggleTf(tf)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  timeframes.includes(tf)
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-elevated text-muted-foreground",
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Simulation step timeframe</span>
          <div className="flex flex-wrap gap-2">
            {timeframes.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setStepTf(tf)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  tf === stepTf
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-elevated text-muted-foreground",
                )}
              >
                {tf}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each closed candle on this timeframe advances the simulation clock.
          </p>
        </div>

        <div className="panel space-y-2 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">History depth per timeframe</span>
            <span className="text-xs font-semibold text-primary">{candleCount}</span>
          </div>
          <Slider
            value={[candleCount]}
            min={100}
            max={2000}
            step={50}
            onValueChange={(value) => setCandleCount(value[0] ?? 400)}
            aria-label="History depth"
          />
        </div>

        <Button
          onClick={run}
          disabled={running || !symbol || timeframes.length === 0}
          className="w-full"
        >
          {running ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" /> Replaying history…
            </>
          ) : (
            "Run backtest"
          )}
        </Button>
        {running && (
          <p className="text-[11px] text-muted-foreground">
            The engine re-analyses every step in a single request; this can take a few seconds.
          </p>
        )}
      </section>

      {result && (
        <>
          <section className="card-soft space-y-4 p-5">
            <h2 className="font-display text-base font-semibold">Results</h2>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Setups found", value: String(result.totalSetups) },
                { label: "Win rate", value: pct(result.winRate) },
                { label: "Average R", value: rr(result.avgR) },
              ].map((item) => (
                <div key={item.label} className="panel p-3 text-center">
                  <p className="text-lg font-semibold text-primary">{item.value}</p>
                  <p className="text-[11px] text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {result.steps} simulated steps on {result.stepTimeframe} ({result.from?.slice(0, 16)} →{" "}
              {result.to?.slice(0, 16)}). {result.wins} wins, {result.losses} losses,{" "}
              {result.unresolved} unresolved. Total {rr(result.totalR)}.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Group</th>
                    <th className="py-1 pr-3">Setups</th>
                    <th className="py-1 pr-3">Resolved</th>
                    <th className="py-1 pr-3">Win rate</th>
                    <th className="py-1">Avg R</th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.byDirection, ...result.byScore].map((row) => (
                    <tr key={row.label} className="border-t border-border/60">
                      <td className="py-1.5 pr-3 font-medium">{row.label}</td>
                      <td className="py-1.5 pr-3">{row.setups}</td>
                      <td className="py-1.5 pr-3">{row.resolved}</td>
                      <td className="py-1.5 pr-3">{pct(row.winRate)}</td>
                      <td className="py-1.5">{rr(row.avgR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card-soft space-y-3 p-5">
            <button
              type="button"
              onClick={() => setShowComponents((open) => !open)}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <span>
                <span className="font-display text-base font-semibold">By component presence</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Compares setups that included each component vs. setups that didn&apos;t, using
                  this same run&apos;s results.
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
                  showComponents && "rotate-180",
                )}
              />
            </button>

            {showComponents && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3">Component</th>
                      <th className="py-1">Present vs. absent (setups · win rate · avg R)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.byComponent.map((row) => (
                      <tr key={row.key} className="border-t border-border/60 align-top">
                        <td className="py-1.5 pr-3" colSpan={row.noComparison ? 5 : 1}>
                          <span className="font-medium">{row.label}</span>
                          {row.noComparison && (
                            <span className="ml-2 text-muted-foreground">
                              {row.present.setups === 0
                                ? "never present this run — no comparison possible"
                                : "always present this run — no comparison possible"}
                            </span>
                          )}
                          {!row.noComparison && row.lowSample && (
                            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              low sample
                            </span>
                          )}
                        </td>
                        {!row.noComparison && (
                          <td className="py-1.5 pr-3" colSpan={4}>
                            <div className={cn("space-y-1", row.lowSample && "text-muted-foreground")}>
                              {[row.present, row.absent].map((side) => (
                                <div key={side.label} className="grid grid-cols-4 gap-2">
                                  <span>{side.label}</span>
                                  <span>{side.setups} setups</span>
                                  <span>{pct(side.winRate)}</span>
                                  <span>{rr(side.avgR)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>


          <section className="card-soft space-y-3 p-5">
            <h2 className="font-display text-base font-semibold">Individual setups</h2>
            {result.setups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No long or short setups were proposed over this history.
              </p>
            ) : (
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {result.setups.map((setup) => (
                  <div key={`${setup.time}-${setup.direction}`} className="panel space-y-1 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">
                        {setup.time.slice(0, 16).replace("T", " ")}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          setup.outcome === "STOP"
                            ? "bg-destructive/15 text-destructive"
                            : setup.outcome === "UNRESOLVED"
                              ? "bg-muted text-muted-foreground"
                              : "bg-bull/15 text-bull",
                        )}
                      >
                        {setup.outcome === "STOP"
                          ? "Loss"
                          : setup.outcome === "UNRESOLVED"
                            ? "Unresolved"
                            : `Win ${setup.outcome}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span
                        className={cn(
                          "font-semibold",
                          setup.direction === "POTENTIAL LONG" ? "text-bull" : "text-destructive",
                        )}
                      >
                        {setup.direction === "POTENTIAL LONG" ? "Long" : "Short"}
                      </span>
                      <span>Score {setup.score}</span>
                      <span>{rr(setup.realizedR)}</span>
                      <span>
                        E {setup.entry} · SL {setup.stop} · TP1 {setup.tp1}
                      </span>
                    </div>
                    {setup.components.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {setup.components.map((c) => `${c.key} (${c.score})`).join(" · ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
