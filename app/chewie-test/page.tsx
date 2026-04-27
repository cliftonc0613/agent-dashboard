"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default function ChewieTestPage() {
  const [prospectIdInput, setProspectIdInput] = useState("");
  const [activeId, setActiveId] = useState<Id<"prospects"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const triggerChewie = useMutation(api.triggers.triggerChewie);
  const prospect = useQuery(
    api.prospects.getById,
    activeId ? { id: activeId } : "skip",
  );

  async function handleRun() {
    setError(null);
    try {
      const id = prospectIdInput.trim() as Id<"prospects">;
      await triggerChewie({ prospectId: id });
      setActiveId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 780, margin: "0 auto", fontFamily: "var(--font-sans, monospace)" }}>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "0.5rem" }}>Chewie Test</h1>
      <p style={{ color: "var(--rebel-faint, #888)", marginBottom: "1.5rem" }}>
        Phase 5 minimal interface. Click Run, then watch buildSteps flip.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}>
        <input
          value={prospectIdInput}
          onChange={(e) => setProspectIdInput(e.target.value)}
          placeholder="prospectId (e.g. k173abc...)"
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            background: "#111",
            color: "var(--rebel-parchment, #eee)",
            border: "1px solid #333",
            borderRadius: 4,
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={handleRun}
          disabled={!prospectIdInput.trim()}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--rebel-amber, #d4a017)",
            color: "#000",
            border: "none",
            borderRadius: 4,
            cursor: prospectIdInput.trim() ? "pointer" : "not-allowed",
            fontWeight: 600,
          }}
        >
          Run Chewie
        </button>
      </div>

      {error && (
        <div style={{ padding: "1rem", background: "#4a1f1f", color: "#f88", borderRadius: 4, marginBottom: "1rem" }}>
          Error: {error}
        </div>
      )}

      {activeId && prospect === undefined && <div>Loading prospect...</div>}
      {activeId && prospect === null && <div>Prospect not found.</div>}
      {prospect && (
        <div>
          <h2 style={{ fontSize: "1.25rem" }}>{prospect.businessName}</h2>
          <p style={{ color: "var(--rebel-faint, #888)" }}>
            Status: <strong>{prospect.status}</strong>
          </p>

          <h3 style={{ marginTop: "1.5rem" }}>buildSteps</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {(Object.entries(prospect.buildSteps) as [string, boolean][]).map(([step, done]) => (
              <li key={step} style={{ padding: "0.25rem 0" }}>
                {done ? "✓" : "○"} {step}
              </li>
            ))}
          </ul>

          {prospect.pagesDevUrl && (
            <p style={{ marginTop: "1rem" }}>
              pages.dev: <a href={prospect.pagesDevUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--rebel-amber, #d4a017)" }}>{prospect.pagesDevUrl}</a>
            </p>
          )}
          {prospect.siteUrl && (
            <p>
              siteUrl: <a href={prospect.siteUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--rebel-amber, #d4a017)" }}>{prospect.siteUrl}</a>
            </p>
          )}
          {prospect.rejectionReason && (
            <p style={{ marginTop: "1rem", color: "#f88" }}>
              rejectionReason: {prospect.rejectionReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
