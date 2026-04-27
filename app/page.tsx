import { Button } from "@/components/ui/button";

export default function Home() {
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
            v0.5.5 &middot; luke design layer
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
                <span className="status-live">Luke design layer live</span>
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span className="readout-label">Phase</span>
              <span className="readout-value">05.5 / 12</span>
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
          <Button
            className="btn-rebel btn-rebel-solid"
            style={{ borderRadius: 0 }}
            type="button"
          >
            Acknowledge &nbsp;/&nbsp; Continue
          </Button>
          <span className="readout-label">
            R2 &middot; Leia &middot; Chewie &middot;{" "}
            <span style={{ color: "#c9a36a" }}>Luke</span> &middot; Ahsoka &middot; Han
          </span>
        </div>
      </main>
    </div>
  );
}
