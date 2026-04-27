"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const LUKE_TAN = "#c9a36a";
const LUKE_BROWN = "#5a3a1a";
const LUKE_BROWN_DEEP = "#3a2410";
const LUKE_PANEL = "#2a1c0e";
const LUKE_PARCHMENT = "#f0e0c4";
const LUKE_DIM = "#a8896a";
const LUKE_FAINT = "#7a5e44";
const LUKE_BORDER = "#4a3520";
const LUKE_WARN = "#d4a017";
const LUKE_ERR = "#c0524a";

const BRAND_KEYS = [
  "brand50",
  "brand100",
  "brand200",
  "brand300",
  "brand400",
  "brand500",
  "brand600",
  "brand700",
  "brand800",
  "brand900",
  "brand950",
] as const;

type BrandKey = (typeof BRAND_KEYS)[number];

type ProspectImageRecord = {
  role: "hero" | "about" | "extra";
  url: string;
  source: string;
  attribution: string;
  alt: string;
};

type LukeOutput = {
  images?: ProspectImageRecord[];
  imageCommitSha?: string;
  brandColorScale?: Record<BrandKey, string>;
  fonts?: { display: string; body: string };
  atmosphere?: string;
  designPrinciples?: string[];
  imageQueries?: { hero: string; supporting: string[] };
  designMdBody?: string;
  designCommitSha?: string;
  completedAt?: number;
};

function StepBadge({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.3rem 0.7rem",
        background: done ? LUKE_BROWN : LUKE_PANEL,
        color: done ? LUKE_PARCHMENT : LUKE_FAINT,
        border: `1px solid ${done ? LUKE_TAN : LUKE_BORDER}`,
        borderRadius: 0,
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "0.78rem",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          color: done ? LUKE_TAN : LUKE_FAINT,
          fontWeight: 700,
        }}
      >
        {done ? "✓" : "○"}
      </span>
      {label}
    </span>
  );
}

export default function LukeTestPage() {
  const [prospectIdInput, setProspectIdInput] = useState(
    "js75x5y7xbb3b0j77asykk9peh85mnbk",
  );
  const [activeId, setActiveId] = useState<Id<"prospects"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const triggerLuke = useMutation(api.triggers.triggerLuke);
  const prospect = useQuery(
    api.prospects.getById,
    activeId ? { id: activeId } : "skip",
  );

  async function handleRun() {
    setError(null);
    setSubmitting(true);
    try {
      const id = prospectIdInput.trim() as Id<"prospects">;
      await triggerLuke({ prospectId: id });
      setActiveId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const lukeOutput = (prospect?.lukeOutput ?? null) as LukeOutput | null;
  const buildSteps = prospect?.buildSteps;
  const dnsWarn = Boolean(prospect?.dnsWarn);
  const lukeFailedReason = prospect?.lukeFailedReason;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: LUKE_BROWN_DEEP,
        color: LUKE_PARCHMENT,
        padding: "2rem 1.25rem 4rem",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            marginBottom: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.72rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: LUKE_DIM,
            }}
          >
            Rebel Alliance &nbsp;//&nbsp; Tatooine Outpost &nbsp;//&nbsp; Luke
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.72rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: LUKE_FAINT,
            }}
          >
            v0.5.5 · luke design layer
          </span>
        </div>

        <h1
          style={{
            fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 0.4rem",
            color: LUKE_PARCHMENT,
          }}
        >
          Luke Test{" "}
          <span style={{ color: LUKE_TAN }}>·</span>{" "}
          <span style={{ color: LUKE_TAN }}>visual design pass</span>
        </h1>
        <p
          style={{
            fontFamily: "var(--font-mono, monospace)",
            color: LUKE_DIM,
            fontSize: "0.92rem",
            margin: "0 0 1.75rem",
            maxWidth: "60ch",
          }}
        >
          DNS · images · design tokens. Click Run, then watch buildSteps flip.
        </p>

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "2rem",
            flexWrap: "wrap",
          }}
        >
          <input
            value={prospectIdInput}
            onChange={(e) => setProspectIdInput(e.target.value)}
            placeholder="prospectId"
            style={{
              flex: "1 1 320px",
              padding: "0.6rem 0.8rem",
              background: LUKE_PANEL,
              color: LUKE_PARCHMENT,
              border: `1px solid ${LUKE_BORDER}`,
              borderRadius: 0,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.9rem",
              outline: "none",
            }}
          />
          <button
            onClick={handleRun}
            disabled={!prospectIdInput.trim() || submitting}
            style={{
              padding: "0.6rem 1.4rem",
              background: LUKE_TAN,
              color: LUKE_BROWN_DEEP,
              border: `1px solid ${LUKE_TAN}`,
              borderRadius: 0,
              cursor:
                prospectIdInput.trim() && !submitting
                  ? "pointer"
                  : "not-allowed",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.85rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Sending…" : "Run Luke"}
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "0.85rem 1rem",
              background: "#3a1410",
              border: `1px solid ${LUKE_ERR}`,
              color: "#f4b8b2",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.85rem",
              marginBottom: "1.25rem",
            }}
          >
            Error: {error}
          </div>
        )}

        {activeId && prospect === undefined && (
          <div style={{ color: LUKE_DIM, fontFamily: "var(--font-mono, monospace)" }}>
            Loading prospect…
          </div>
        )}
        {activeId && prospect === null && (
          <div style={{ color: LUKE_ERR, fontFamily: "var(--font-mono, monospace)" }}>
            Prospect not found.
          </div>
        )}

        {prospect && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
            <section
              style={{
                background: LUKE_PANEL,
                border: `1px solid ${LUKE_BORDER}`,
                padding: "1.25rem 1.4rem",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: LUKE_FAINT,
                  marginBottom: "0.4rem",
                }}
              >
                Prospect
              </div>
              <h2
                style={{
                  fontSize: "1.4rem",
                  margin: "0 0 0.3rem",
                  color: LUKE_PARCHMENT,
                  fontWeight: 600,
                }}
              >
                {prospect.businessName}
              </h2>
              <div
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.85rem",
                  color: LUKE_DIM,
                }}
              >
                status:{" "}
                <span style={{ color: LUKE_TAN, fontWeight: 600 }}>
                  {prospect.status}
                </span>
                {prospect.customSubdomain && (
                  <>
                    {" · "}
                    subdomain:{" "}
                    <span style={{ color: LUKE_PARCHMENT }}>
                      {prospect.customSubdomain}
                    </span>
                  </>
                )}
                {prospect.repoName && (
                  <>
                    {" · "}
                    repo:{" "}
                    <span style={{ color: LUKE_PARCHMENT }}>
                      {prospect.repoName}
                    </span>
                  </>
                )}
              </div>
            </section>

            {buildSteps && (
              <section>
                <div
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: LUKE_FAINT,
                    marginBottom: "0.6rem",
                  }}
                >
                  Build Steps · Luke
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <StepBadge label="dnsCreated" done={!!buildSteps.dnsCreated} />
                  <StepBadge label="imagesSourced" done={!!buildSteps.imagesSourced} />
                  <StepBadge label="designApplied" done={!!buildSteps.designApplied} />
                </div>
                <div
                  style={{
                    marginTop: "0.75rem",
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  {dnsWarn && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        padding: "0.3rem 0.7rem",
                        background: "#3a2a08",
                        color: LUKE_WARN,
                        border: `1px solid ${LUKE_WARN}`,
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "0.78rem",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      ⚠ dnsWarn
                    </span>
                  )}
                  {lukeFailedReason && (
                    <span
                      style={{
                        padding: "0.3rem 0.7rem",
                        background: "#3a1410",
                        color: "#f4b8b2",
                        border: `1px solid ${LUKE_ERR}`,
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "0.78rem",
                      }}
                    >
                      ✗ {lukeFailedReason}
                    </span>
                  )}
                </div>
              </section>
            )}

            {lukeOutput?.brandColorScale && (
              <section>
                <div
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: LUKE_FAINT,
                    marginBottom: "0.6rem",
                  }}
                >
                  Brand Color Scale
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(11, minmax(0, 1fr))",
                    gap: "2px",
                    border: `1px solid ${LUKE_BORDER}`,
                  }}
                >
                  {BRAND_KEYS.map((k) => {
                    const hex = lukeOutput.brandColorScale?.[k] ?? "#000000";
                    return (
                      <div
                        key={k}
                        title={`${k} ${hex}`}
                        style={{
                          background: hex,
                          height: 56,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          padding: "0.2rem 0",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "0.55rem",
                            color: parseInt(k.replace("brand", ""), 10) >= 500
                              ? LUKE_PARCHMENT
                              : LUKE_BROWN_DEEP,
                            mixBlendMode: "normal",
                          }}
                        >
                          {k.replace("brand", "")}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(11, minmax(0, 1fr))",
                    gap: "2px",
                    marginTop: "4px",
                  }}
                >
                  {BRAND_KEYS.map((k) => (
                    <div
                      key={`${k}-hex`}
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "0.55rem",
                        color: LUKE_FAINT,
                        textAlign: "center",
                      }}
                    >
                      {lukeOutput.brandColorScale?.[k]?.replace("#", "")}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {lukeOutput?.fonts && (
              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "1rem",
                }}
              >
                <div
                  style={{
                    background: LUKE_PANEL,
                    border: `1px solid ${LUKE_BORDER}`,
                    padding: "1rem 1.2rem",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: LUKE_FAINT,
                      marginBottom: "0.4rem",
                    }}
                  >
                    Display Font
                  </div>
                  <div style={{ fontSize: "1.15rem", color: LUKE_PARCHMENT }}>
                    {lukeOutput.fonts.display}
                  </div>
                </div>
                <div
                  style={{
                    background: LUKE_PANEL,
                    border: `1px solid ${LUKE_BORDER}`,
                    padding: "1rem 1.2rem",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "0.7rem",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: LUKE_FAINT,
                      marginBottom: "0.4rem",
                    }}
                  >
                    Body Font
                  </div>
                  <div style={{ fontSize: "1.15rem", color: LUKE_PARCHMENT }}>
                    {lukeOutput.fonts.body}
                  </div>
                </div>
              </section>
            )}

            {lukeOutput?.atmosphere && (
              <section
                style={{
                  background: LUKE_PANEL,
                  border: `1px solid ${LUKE_BORDER}`,
                  padding: "1.1rem 1.4rem",
                  borderLeft: `3px solid ${LUKE_TAN}`,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: LUKE_FAINT,
                    marginBottom: "0.5rem",
                  }}
                >
                  Atmosphere
                </div>
                <p
                  style={{
                    margin: 0,
                    fontStyle: "italic",
                    color: LUKE_PARCHMENT,
                    lineHeight: 1.55,
                    fontSize: "0.97rem",
                  }}
                >
                  {lukeOutput.atmosphere}
                </p>
              </section>
            )}

            {lukeOutput?.images && lukeOutput.images.length > 0 && (
              <section>
                <div
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: LUKE_FAINT,
                    marginBottom: "0.6rem",
                  }}
                >
                  Image Attribution ({lukeOutput.images.length})
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  {lukeOutput.images.map((img) => (
                    <div
                      key={img.role + img.url}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        gap: "0.85rem",
                        alignItems: "center",
                        padding: "0.6rem 0.85rem",
                        background: LUKE_PANEL,
                        border: `1px solid ${LUKE_BORDER}`,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "0.7rem",
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: LUKE_TAN,
                          fontWeight: 700,
                          minWidth: 48,
                        }}
                      >
                        {img.role}
                      </span>
                      <a
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "0.78rem",
                          color: LUKE_PARCHMENT,
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          borderBottom: `1px dotted ${LUKE_FAINT}`,
                        }}
                      >
                        {img.url}
                      </a>
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "0.7rem",
                          color: LUKE_DIM,
                        }}
                      >
                        {img.source}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {prospect.pagesDevUrl && (
              <section
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "0.85rem",
                  color: LUKE_DIM,
                }}
              >
                pages.dev:{" "}
                <a
                  href={prospect.pagesDevUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: LUKE_TAN }}
                >
                  {prospect.pagesDevUrl}
                </a>
                {prospect.siteUrl && (
                  <>
                    {" · "}
                    siteUrl:{" "}
                    <a
                      href={prospect.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: LUKE_TAN }}
                    >
                      {prospect.siteUrl}
                    </a>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
