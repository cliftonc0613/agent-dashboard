"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";

type RunResult =
  | { runId: string; status: string }
  | { error: string }
  | null;

export default function Home() {
  const runPipeline = useAction(api.pipeline.runDaily);
  const pausePipeline = useMutation(api.pipelineControl.pause);
  const resumePipeline = useMutation(api.pipelineControl.resume);
  const control = useQuery(api.pipelineControl.get);

  const [busy, setBusy] = useState(false);
  const [runResult, setRunResult] = useState<RunResult>(null);
  const [controlBusy, setControlBusy] = useState(false);

  const paused = control?.paused ?? false;
  const pausedReason = control?.pausedReason;

  async function handleRunPipeline() {
    setBusy(true);
    setRunResult(null);
    try {
      const r = await runPipeline({ triggeredBy: "manual" });
      setRunResult(r as RunResult);
    } catch (err) {
      setRunResult({
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    setControlBusy(true);
    try {
      await pausePipeline({ reason: "manual pause" });
    } finally {
      setControlBusy(false);
    }
  }

  async function handleResume() {
    setControlBusy(true);
    try {
      await resumePipeline({});
    } finally {
      setControlBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "3rem 1.25rem",
      }}
    >
      <main
        style={{
          width: "100%",
          maxWidth: "780px",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        {/* Top identifier */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span className="readout-label">
            Rebel Alliance &nbsp;//&nbsp; Command Center &nbsp;//&nbsp; Node 01
          </span>
          <span className="readout-label" style={{ color: "var(--rebel-faint)" }}>
            v0.6.0 &middot; pipeline orchestration
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <h1
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "clamp(2.25rem, 5vw, 3.5rem)",
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              color: "var(--rebel-parchment)",
              margin: 0,
            }}
          >
            Dashboard{" "}
            <span
              style={{
                color: "var(--rebel-amber)",
                textShadow:
                  "0 0 24px color-mix(in oklch, var(--rebel-amber) 55%, transparent)",
              }}
            >
              online.
            </span>
          </h1>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.95rem",
              color: "var(--rebel-dim)",
              letterSpacing: "0.02em",
              maxWidth: "46ch",
              margin: 0,
            }}
          >
            Autonomous site-building pipeline. Awaiting orders.
          </p>
        </div>

        {/* Data readout panel */}
        <section className="rebel-panel" aria-label="System readout">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "1.25rem 2.5rem",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Status</span>
              <span className="readout-value">
                <span className="status-live">
                  Phase 6: Pipeline Orchestration + Cron — IN PROGRESS
                </span>
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Phase</span>
              <span className="readout-value">06 / 12</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Stack</span>
              <span className="readout-value">Next 15 &middot; React 19</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Backend</span>
              <span className="readout-value">Convex &middot; wired</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Agents</span>
              <span className="readout-value">
                R2 &middot; Leia &middot; Chewie &middot;{" "}
                <span style={{ color: "#c9a36a" }}>Luke</span> &middot; Ahsoka &middot; Han
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Dry Run</span>
              <span className="readout-value readout-value--amber">true</span>
            </div>
          </div>
        </section>

        <div className="rebel-divider" role="separator" aria-hidden="true" />

        {/* Phase 6 Pipeline Controls */}
        <section className="rebel-panel" aria-label="Phase 6 pipeline controls">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
              }}
            >
              <span className="readout-label">
                Phase 6 &nbsp;//&nbsp; Pipeline Controls
              </span>
              <span className="readout-value">
                {control === undefined ? (
                  <span className="status-offline">loading control…</span>
                ) : paused ? (
                  <span className="status-offline">
                    paused{pausedReason ? ` — ${pausedReason}` : ""}
                  </span>
                ) : (
                  <span className="status-live">unpaused</span>
                )}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <Button
                className="btn-rebel btn-rebel-solid"
                style={{ borderRadius: 0 }}
                type="button"
                onClick={handleRunPipeline}
                disabled={busy || control === undefined}
              >
                {busy ? "Running…" : "Run Pipeline (Manual)"}
              </Button>

              {paused ? (
                <Button
                  className="btn-rebel"
                  style={{ borderRadius: 0 }}
                  type="button"
                  onClick={handleResume}
                  disabled={controlBusy || control === undefined}
                >
                  {controlBusy ? "…" : "Resume"}
                </Button>
              ) : (
                <Button
                  className="btn-rebel"
                  style={{ borderRadius: 0 }}
                  type="button"
                  onClick={handlePause}
                  disabled={controlBusy || control === undefined}
                >
                  {controlBusy ? "…" : "Pause"}
                </Button>
              )}
            </div>

            {runResult && (
              <pre
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.78rem",
                  color: "var(--rebel-dim)",
                  background:
                    "color-mix(in oklch, var(--rebel-panel) 60%, transparent)",
                  padding: "0.875rem 1rem",
                  margin: 0,
                  border:
                    "1px solid color-mix(in oklch, var(--rebel-amber) 18%, transparent)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  letterSpacing: "0.02em",
                }}
              >
                {JSON.stringify(runResult, null, 2)}
              </pre>
            )}
          </div>
        </section>

        <div className="rebel-divider" role="separator" aria-hidden="true" />

        {/* Command action */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span className="readout-label" style={{ color: "var(--rebel-faint)" }}>
            v0.6.0 &middot; pipeline orchestration
          </span>
          <span className="readout-label">
            R2 &middot; Leia &middot; Chewie &middot;{" "}
            <span style={{ color: "#c9a36a" }}>Luke</span> &middot; Ahsoka &middot; Han
          </span>
        </div>
      </main>
    </div>
  );
}
