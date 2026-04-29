import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { mapCategory } from "./lib/categoryMapping";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

const C = {
  human: "#3B82F6",
  humanBg: "#EFF6FF",
  humanTxt: "#1D4ED8",
  ai: "#14B8A6",
  aiBg: "#F0FDFA",
  aiTxt: "#0F766E",
  combined: "#111827",
  border: "#E5E7EB",
  borderL: "#F3F4F6",
  txt: "#111827",
  txt2: "#6B7280",
  txt3: "#9CA3AF",
  bg: "#F9FAFB",
  surface: "#FFFFFF",
  ink: "#0F172A",
  successBg: "#ECFDF5",
  successBorder: "#BBF7D0",
  successTxt: "#166534",
  warnBg: "#FFFBEB",
  warnTxt: "#B45309",
  warnBorder: "#FDE68A",
  overlay: "rgba(15, 23, 42, 0.45)",
};

const FF = "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif";

// Display helpers — round all percentages and deltas to whole numbers
const fmtPct = (v) => (v == null ? "" : `${Math.round(v)}%`);
const fmtDelta = (v) => (v == null ? "" : `${Math.round(v)} pts`);

const LEADERBOARD = [
  { rank: 1, name: "Dr. Sarah Chen", type: "Human", domain: "AI Research", accuracy: "87%", calibration: "0.82", reputation: 94, influence: "High" },
  { rank: 2, name: "GPT-Research v4", type: "AI", domain: "General", accuracy: "91%", calibration: "0.89", reputation: 91, influence: "High" },
  { rank: 3, name: "Claude-Analyst", type: "AI", domain: "General", accuracy: "90%", calibration: "0.87", reputation: 90, influence: "High" },
];

const AI_MODELS = [
  {
    name: "GPT-Research v4",
    role: "General forecasting baseline",
    strengths: "Benchmark trend synthesis, funding signals, public research digestion",
    score: 91,
  },
  {
    name: "Claude-Analyst",
    role: "Long-form reasoning model",
    strengths: "Structured argumentation, uncertainty framing, scenario decomposition",
    score: 90,
  },
  {
    name: "Gemini-Forecast",
    role: "Momentum and ecosystem tracker",
    strengths: "Market trajectory, open-weight movement, product release synthesis",
    score: 85,
  },
];

const EVIDENCE_INPUTS = [
  {
    title: "Llama 3.1 vs GPT-4o Benchmark Study",
    type: "Research",
    date: "Sep 2025",
    summary:
      "Meta's Llama 3.1 405B achieved within 3% of GPT-4o on MMLU and HumanEval benchmarks.",
  },
  {
    title: "Epoch AI Open-Weight Progress Report",
    type: "Research",
    date: "Jan 2026",
    summary:
      "The lag between frontier and open-weight models has compressed sharply since 2023.",
  },
  {
    title: "Enterprise Reliability Benchmarks 2025",
    type: "Benchmark",
    date: "Oct 2025",
    summary:
      "CTO survey suggests reliability and support still hold back open-weight deployment.",
  },
  {
    title: "EU AI Act Open-Weight Exemptions",
    type: "Policy",
    date: "Nov 2025",
    summary:
      "Regulatory carve-outs may accelerate open-weight adoption while introducing compliance ambiguity.",
  },
];

const AI_SYNTHESIS = {
  bullCase:
    "Rapid benchmark convergence, lower cost curves, and infrastructure investment suggest open-weight models could achieve functional parity on many important tasks before end of 2027.",
  bearCase:
    "Benchmark parity is not deployment parity. Frontier labs still hold structural advantages in safety tooling, reliability, and enterprise support.",
  keyUncertainty:
    "The definition of parity is contested. Shorter timelines follow from benchmark-based definitions; longer timelines follow from deployment-quality definitions.",
  disagreement:
    "Experts weight deployment quality and enterprise readiness. AI models weight benchmark trajectories and open-weight momentum.",
};

const CHART_DATA = [
  { date: "Jan '25", human: 42, ai: 55, combined: 48, high: 54 },
  { date: "Mar '25", human: 45, ai: 58, combined: 51, high: 57 },
  { date: "May '25", human: 48, ai: 62, combined: 54, high: 60 },
  { date: "Jul '25", human: 50, ai: 65, combined: 57, high: 62 },
  { date: "Sep '25", human: 53, ai: 67, combined: 59, high: 64 },
  { date: "Nov '25", human: 55, ai: 69, combined: 61, high: 66 },
  { date: "Jan '26", human: 57, ai: 70, combined: 63, high: 68 },
  { date: "Mar '26", human: 58, ai: 71, combined: 64, high: 69 },
];

function getProbabilityLabel(p) {
  if (p === 0) return "NO";
  if (p === 25) return "NO-LEANING";
  if (p === 50) return "UNCERTAIN";
  if (p === 75) return "YES-LEANING";
  if (p === 100) return "YES";
  return "CUSTOM";
}

// ── Global categories ────────────────────────────────────────────────────────
// Single source of truth — used by CategoryBar, SignalsIndexPage, LeaderboardPage
const CATEGORIES = ["All", "AI & ML", "Policy", "Safety", "Economics", "Science"];

// Map a UI category label to a compact URL slug and back
const CATEGORY_SLUG = {
  "All": "",
  "AI & ML": "ai-ml",
  "Policy": "policy",
  "Safety": "safety",
  "Economics": "economics",
  "Science": "science",
};
const SLUG_TO_CATEGORY = Object.fromEntries(
  Object.entries(CATEGORY_SLUG).map(([label, slug]) => [slug, label])
);

function useCategoryParam() {
  const getFromURL = () => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("category") || "";
    return SLUG_TO_CATEGORY[slug] ?? "All";
  };

  const [selected, setSelectedRaw] = useState(getFromURL);

  // Sync from popstate (browser back/forward)
  useEffect(() => {
    const handler = () => setSelectedRaw(getFromURL());
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setSelected = (label) => {
    const slug = CATEGORY_SLUG[label] ?? "";
    const params = new URLSearchParams(window.location.search);
    if (slug) {
      params.set("category", slug);
    } else {
      params.delete("category");
    }
    const newSearch = params.toString();
    const newURL = newSearch ? `?${newSearch}` : window.location.pathname;
    window.history.pushState({}, "", newURL);
    setSelectedRaw(label);
  };

  return [selected, setSelected];
}

function useBreakpoint() {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1100,
  };
}

function Card({ children, style = {} }) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        background: C.surface,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Badge({ children, bg = "#F3F4F6", color = "#374151" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: bg,
        color,
        fontFamily: FF,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function MetaPill({ label, value, highlight = false }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "6px 12px",
        borderRadius: 10,
        backgroundColor: highlight ? C.humanBg : C.borderL,
        border: `1px solid ${highlight ? "#BFDBFE" : C.border}`,
      }}
    >
      <span style={{ fontSize: 11, color: C.txt3, fontWeight: 500, fontFamily: FF }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: highlight ? C.humanTxt : C.txt,
          fontWeight: 700,
          fontFamily: FF,
        }}
      >
        {value}
      </span>
    </div>
  );
}

// Pages where the category bar is shown
const CATEGORY_BAR_PAGES = new Set(["index", "leaderboard"]);

function CategoryBar({ selected, onSelect }) {
  const { isMobile } = useBreakpoint();
  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        background: C.surface,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: isMobile ? "0 12px" : "0 20px",
          display: "flex",
          gap: 2,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {CATEGORIES.map((cat) => {
          const active = selected === cat;
          return (
            <button
              key={cat}
              onClick={() => onSelect(cat)}
              style={{
                padding: isMobile ? "10px 12px" : "11px 16px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: FF,
                fontSize: isMobile ? 13 : 14,
                fontWeight: active ? 700 : 500,
                color: active ? C.txt : C.txt2,
                whiteSpace: "nowrap",
                borderBottom: active ? `2px solid ${C.ink}` : "2px solid transparent",
                borderRadius: 0,
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TopNav({ page, onNav, currentUser, onSignOut, userStats, rewardJustLanded, selectedCategory, onSelectCategory }) {
  const { isMobile } = useBreakpoint();

  // Animate points 0 → real value when reward lands
  const [displayedPoints, setDisplayedPoints] = useState(userStats?.points ?? 0);
  useEffect(() => {
    if (!rewardJustLanded || userStats == null) return;
    const target = userStats.points;
    const duration = 800;
    const steps = 30;
    const interval = duration / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setDisplayedPoints(Math.round((step / steps) * target));
      if (step >= steps) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [rewardJustLanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep displayedPoints in sync when not animating
  useEffect(() => {
    if (!rewardJustLanded && userStats != null) {
      setDisplayedPoints(userStats.points);
    }
  }, [userStats?.points, rewardJustLanded]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = [
    ["index", "Signals"],
    ["leaderboard", "Leaderboard"],
    ["models", "AI Models"],
    ["methodology", "Methodology"],
    ["company", "Company"],
  ];

  const userLabel =
    currentUser?.user_metadata?.first_name ||
    currentUser?.email ||
    "Account";

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          minHeight: isMobile ? 68 : 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 1280,
          margin: "0 auto",
          padding: isMobile ? "12px 16px" : "0 20px",
          fontFamily: FF,
          gap: 12,
          flexWrap: isMobile ? "wrap" : "nowrap",
        }}
      >
        <button
          onClick={() => onNav("index")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            border: "none",
            background: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "#111B3A",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            FS
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: C.txt }}>
            Future Signals
          </span>
        </button>

        {!isMobile && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {items.map(([key, label]) => (
              <button
                key={key}
                onClick={() => onNav(key)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: page === key ? C.borderL : "transparent",
                  color: page === key ? C.txt : C.txt2,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: FF,
                  fontWeight: page === key ? 600 : 500,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
          {currentUser ? (
            <>
              {!isMobile && userStats && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontFamily: FF }}>
                  <span style={{
                    color: rewardJustLanded ? C.aiTxt : C.txt2,
                    transition: "color 0.4s, box-shadow 0.4s",
                    padding: rewardJustLanded ? "3px 8px" : "3px 0",
                    borderRadius: 6,
                    boxShadow: rewardJustLanded ? `0 0 0 1px ${C.ai}40, 0 0 8px ${C.ai}30` : "none",
                    background: rewardJustLanded ? `${C.ai}10` : "transparent",
                  }}>
                    ⚡ {displayedPoints.toLocaleString()} pts
                  </span>
                  {userStats.streak > 0 && <span style={{ color: C.txt2 }}>🔥 {userStats.streak} streak</span>}
                  {userStats.accuracy != null && <span style={{ color: C.txt2 }}>🎯 {fmtPct(userStats.accuracy)}</span>}
                </div>
              )}
              {!isMobile && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: C.borderL,
                    color: C.txt,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {userLabel}
                </div>
              )}
              <button onClick={onSignOut} style={secondaryBtn}>
                Sign out
              </button>
            </>
          ) : (
            <button onClick={() => onNav("login")} style={secondaryBtn}>
              Log in
            </button>
          )}

          <button onClick={() => onNav("submit")} style={primaryBtn}>
            Submit Forecast
          </button>
        </div>

        {isMobile && (
          <div
            style={{
              width: "100%",
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 2,
            }}
          >
            {items.map(([key, label]) => (
              <button
                key={key}
                onClick={() => onNav(key)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: page === key ? C.borderL : "transparent",
                  color: page === key ? C.txt : C.txt2,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: FF,
                  fontWeight: page === key ? 600 : 500,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {CATEGORY_BAR_PAGES.has(page) && (
        <CategoryBar selected={selectedCategory} onSelect={onSelectCategory} />
      )}
    </nav>
  );
}

function SignalsIndexPage({ signals, onOpen, userForecasts, selectedCategory }) {
  const { isMobile } = useBreakpoint();

  const filtered =
    selectedCategory === "All"
      ? signals
      : signals.filter((signal) => mapCategory(signal.category) === selectedCategory);

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: isMobile ? "28px 16px 44px" : "42px 36px 60px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: FF, fontSize: isMobile ? 28 : 34, color: C.txt, margin: "0 0 8px" }}>
            {selectedCategory === "All" ? "Forecast Signals" : selectedCategory}
          </h1>
          <p style={{ fontFamily: FF, color: C.txt2, fontSize: 15, margin: 0 }}>
            Forecast the questions that move markets. See where experts and AI disagree before consensus forms.
          </p>
        </div>
        <select style={{ ...selectStyle, width: isMobile ? "100%" : "auto", flexShrink: 0 }} defaultValue="Highest Signal">
          <option>Highest Signal</option>
          <option>Most Active</option>
          <option>Highest Divergence</option>
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {filtered.map((signal) => {
          const hasContributed = !!userForecasts[signal.id];
          const myForecast = userForecasts[signal.id];

          const strength = (signal.signalStrength || "").toLowerCase();
          const strBg = strength === "high" ? "#ECFDF5" : strength === "moderate" ? "#EEF2FF" : strength === "low" ? "#FFFBEB" : "#F3F4F6";
          const strColor = strength === "high" ? "#166534" : strength === "moderate" ? "#4338CA" : strength === "low" ? "#B45309" : C.txt3;
          const aiDelta = signal.hasHumanData ? signal.ai - signal.human : null;

          return (
            <Card key={signal.id} style={{ padding: isMobile ? 14 : 20 }}>
              <button
                onClick={() => onOpen(signal)}
                style={{ width: "100%", border: "none", background: "none", textAlign: "left", padding: 0, cursor: "pointer" }}
              >
                {/* Badge row */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {signal.category && <Badge bg={C.humanBg} color={C.humanTxt}>{mapCategory(signal.category)}</Badge>}
                  {signal.signalStrength && (
                    <Badge bg={strBg} color={strColor}>
                      {signal.signalStrength.charAt(0).toUpperCase() + signal.signalStrength.slice(1)} signal
                    </Badge>
                  )}
                  {signal.divergence >= 15 && <Badge bg="#FFFBEB" color="#B45309">High divergence</Badge>}
                  {hasContributed && <Badge bg={C.successBg} color={C.successTxt}>Contributed</Badge>}
                </div>

                {/* Main row: question + combined % */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: FF, fontSize: isMobile ? 14 : 15, fontWeight: 600, color: C.txt, lineHeight: 1.45 }}>
                      {signal.question}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontFamily: FF, fontSize: isMobile ? 24 : 28, fontWeight: 800, color: C.txt, lineHeight: 1 }}>
                      {fmtPct(signal.combined)}
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontFamily: FF, fontSize: 13, color: C.txt2, marginBottom: 10, alignItems: "center" }}>
                  <span>
                    <span style={{ color: C.human }}>●</span>{" "}
                    Human <strong style={{ color: C.humanTxt }}>{signal.hasHumanData ? fmtPct(signal.human) : "—"}</strong>
                  </span>
                  <span>
                    <span style={{ color: C.ai }}>●</span>{" "}
                    AI <strong style={{ color: C.aiTxt }}>{fmtPct(signal.ai)}</strong>
                  </span>
                  {aiDelta != null && (
                    <span style={{ color: C.txt3 }}>
                      {aiDelta === 0 ? "Aligned" : aiDelta > 0 ? `AI +${Math.round(aiDelta)} pts` : `AI −${Math.round(Math.abs(aiDelta))} pts`}
                    </span>
                  )}
                  {!signal.hasHumanData && <span style={{ color: C.txt3 }}>AI baseline only</span>}
                </div>

                {/* Footer row */}
                <div style={{ fontFamily: FF, fontSize: 13, color: C.txt3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {hasContributed && (
                    <span style={{ color: C.successTxt, fontWeight: 600 }}>
                      Your position: {myForecast.probability >= 50 ? "YES" : "NO"} · {fmtPct(myForecast.probability)}
                    </span>
                  )}
                  {hasContributed && <span>·</span>}
                  <span>
                    {signal.contributorCount === 0 ? "Be the first" : `${signal.contributorCount} contributors`}
                    {signal.resolutionDate ? ` · Resolves ${signal.resolutionDate}` : ""}
                  </span>
                </div>
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        fontFamily: FF,
      }}
    >
      <div style={{ fontSize: 12, color: C.txt2, marginBottom: 8 }}>{label}</div>
      {payload.map((p) => (
        <div
          key={p.dataKey}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            fontSize: 12,
            marginBottom: 4,
          }}
        >
          <span style={{ color: C.txt2 }}>{p.name}</span>
          <strong style={{ color: C.txt }}>{fmtPct(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function EvidenceAnalysis({ isMobile, aiSummary }) {
  const overall = aiSummary?.overall ?? {};
  const profileSummary = aiSummary?.profile_summary ?? {};
  const synthesis = aiSummary?.synthesis ?? {};

  const disagreementScore = overall.disagreement_score ?? null;
  const disagreementLabel =
    disagreementScore == null ? null :
    disagreementScore <= 15 ? "Low" :
    disagreementScore <= 30 ? "Moderate" : "High";
  const disagreementColor =
    disagreementLabel === "Low" ? "#10B981" :
    disagreementLabel === "Moderate" ? "#F59E0B" : "#EF4444";

  const investorP = profileSummary.investor?.avg_probability ?? null;
  const baseP = profileSummary.base?.avg_probability ?? null;
  const researcherP = profileSummary.researcher?.avg_probability ?? null;

  const aiBaseline = overall.ai_baseline_probability ?? null;
  const weightedBaseline = overall.weighted_ai_baseline_probability ?? null;
  const confWeighted = overall.confidence_weighted_baseline ?? null;
  const showSignalConstruction = aiBaseline != null || weightedBaseline != null || confWeighted != null;

  // Live synthesis fields — fall back to static copy only if synthesis is absent
  const primaryDriver = synthesis.primary_driver ?? "Benchmark convergence and open-weight momentum";
  const mainConstraint = synthesis.main_constraint ?? "Enterprise reliability, safety infrastructure, and deployment quality";
  const netEffect = synthesis.net_effect ?? "Moderate probability with meaningful disagreement across perspectives";

  const researcherText = synthesis.researcher_view ?? AI_SYNTHESIS.bullCase;
  const investorText = synthesis.investor_view ?? AI_SYNTHESIS.bearCase;
  const keyUncertaintyText = synthesis.key_uncertainty ?? AI_SYNTHESIS.keyUncertainty;
  const whyDifferText = synthesis.why_disagree
    ?? "The researcher lens weights benchmark progress and scaling trends. The investor lens weights adoption friction and execution risk. The final signal reconciles both.";

  return (
    <div style={{ fontFamily: FF }}>
      {/* What’s Driving the Signal — structured */}
      <div
        style={{
          padding: "16px 18px",
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          backgroundColor: C.ink,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.55)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 12,
          }}
        >
          What’s Driving the Signal
        </div>
        {[
          ["Primary driver", primaryDriver],
          ["Main constraint", mainConstraint],
          ["Net effect", netEffect],
        ].map(([label, text]) => (
          <div key={label} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.38)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
                minWidth: 118,
                paddingTop: 2,
              }}
            >
              {label}
            </span>
            <span style={{ fontSize: 13, color: "#F9FAFB", lineHeight: 1.55 }}>{text}</span>
          </div>
        ))}
      </div>

      {/* AI Disagreement block */}
      {(disagreementLabel != null || investorP != null || baseP != null || researcherP != null) && (
        <div
          style={{
            padding: "14px 18px",
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            backgroundColor: C.surface,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.txt3,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 10,
            }}
          >
            AI Disagreement
          </div>
          {disagreementLabel && (
            <div style={{ fontSize: 13, fontWeight: 600, color: disagreementColor, marginBottom: 12 }}>
              {disagreementLabel} disagreement{disagreementScore != null ? ` • ${Math.round(disagreementScore)} pt spread` : ""}
            </div>
          )}
          <div style={{ display: "flex", gap: 24 }}>
            {[
              ["Investor", investorP],
              ["Base", baseP],
              ["Researcher", researcherP],
            ].map(([label, val]) =>
              val != null ? (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: C.txt3,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {label}
                  </span>
                  <span style={{ fontSize: 17, fontWeight: 700, color: C.txt }}>{fmtPct(val)}</span>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* AI Synthesis — Researcher / Investor views */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.ai }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>AI Synthesis</span>
        </div>

        <Card style={{ overflow: "hidden" }}>
          {[
            ["RESEARCHER VIEW", "Technical Lens", researcherText, "#0F766E", "#F0FDFA"],
            ["INVESTOR VIEW", "Deployment Lens", investorText, "#C2410C", "#FFF7ED"],
            ["KEY UNCERTAINTY", null, keyUncertaintyText, "#F59E0B", "#FFFBEB"],
          ].map(([label, sublabel, text, color, bg], i) => (
            <div
              key={label}
              style={{
                padding: "16px 18px",
                borderBottom: `1px solid ${C.border}`,
                backgroundColor: bg,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {label}
                </div>
                {sublabel && (
                  <div style={{ fontSize: 11, color: `${color}99` }}>{sublabel}</div>
                )}
              </div>
              <p style={{ fontSize: 13, color: C.txt, lineHeight: 1.6, margin: 0 }}>{text}</p>
            </div>
          ))}
          <div style={{ padding: "16px 18px", backgroundColor: C.borderL }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: C.combined,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 6,
              }}
            >
              Why These Views Differ
            </div>
            <p style={{ fontSize: 13, color: C.txt, lineHeight: 1.6, margin: 0 }}>{whyDifferText}</p>
          </div>
        </Card>
      </div>

      {/* Signal construction block */}
      {showSignalConstruction && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: C.txt3,
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              marginBottom: 10,
            }}
          >
            How This Signal Is Formed
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            {[
              ["AI baseline (unweighted)", aiBaseline],
              ["Weighted baseline", weightedBaseline],
              ["Confidence-weighted baseline", confWeighted],
            ].map(([label, val], i, arr) =>
              val != null ? (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 16px",
                    borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none",
                    backgroundColor: C.surface,
                  }}
                >
                  <span style={{ fontSize: 13, color: C.txt2 }}>{label}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{fmtPct(val)}</span>
                </div>
              ) : null
            )}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 12 }}>
          Evidence Inputs
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: 10,
          }}
        >
          {EVIDENCE_INPUTS.map((e) => (
            <Card key={e.title} style={{ padding: "14px 16px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <h4
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.txt,
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {e.title}
                </h4>
                <Badge
                  bg={
                    e.type === "Research"
                      ? C.humanBg
                      : e.type === "Benchmark"
                      ? C.aiBg
                      : e.type === "Policy"
                      ? "#F5F3FF"
                      : "#F3F4F6"
                  }
                  color={
                    e.type === "Research"
                      ? C.humanTxt
                      : e.type === "Benchmark"
                      ? C.aiTxt
                      : e.type === "Policy"
                      ? "#6D28D9"
                      : "#374151"
                  }
                >
                  {e.type}
                </Badge>
              </div>
              <p style={{ fontSize: 13, color: C.txt2, lineHeight: 1.5, margin: "0 0 8px" }}>
                {e.summary}
              </p>
              <div style={{ fontSize: 11, color: C.txt3 }}>{e.date}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}


function InlinePredictionBlock({
  signal,
  userForecast,
  liveHuman,
  liveContributors,
  liveCombined,
  isSaving,
  onSave,
  isAuthenticated,
}) {
  const { isMobile } = useBreakpoint();
  const isComposingRef = useRef(false);

  const deriveDirection = (forecast) => {
    if (!forecast) return null;
    return forecast.probability >= 50 ? "YES" : "NO";
  };

  const [panelState, setPanelState] = useState(() =>
    userForecast ? "submitted_success" : "idle"
  );
  const [direction, setDirection] = useState(() => deriveDirection(userForecast));
  const [probability, setProbability] = useState(userForecast?.probability ?? null);
  const [stake, setStake] = useState(userForecast?.stake ?? 50);
  const [rationale, setRationale] = useState(userForecast?.rationale ?? "");

  // Full reset when navigating to a different signal
  useEffect(() => {
    isComposingRef.current = false;
    const dir = deriveDirection(userForecast);
    setDirection(dir);
    setProbability(userForecast?.probability ?? null);
    setStake(userForecast?.stake ?? 50);
    setRationale(userForecast?.rationale ?? "");
    setPanelState(userForecast ? "submitted_success" : "idle");
  }, [signal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transition to position view when forecast arrives (auth → submit path).
  // No isComposingRef guard here — if a forecast lands from the DB, it always wins.
  // Edit is disabled so there is no risk of overwriting an in-progress form.
  useEffect(() => {
    if (userForecast) {
      isComposingRef.current = false;
      setDirection(deriveDirection(userForecast));
      setProbability(userForecast.probability ?? null);
      setStake(userForecast.stake ?? 50);
      setRationale(userForecast.rationale ?? "");
      setPanelState("submitted_success");
    }
  }, [userForecast]);

  const handleDirectionSelect = (dir) => {
    isComposingRef.current = true;
    setPanelState("composing");
    setDirection(dir);
    if (probability === null) setProbability(dir === "YES" ? 60 : 40);
  };

  const handleSubmit = async () => {
    const ok = await onSave({ probability: currentProb, confidence: null, rationale, stake });
    if (ok) {
      isComposingRef.current = false;
      setPanelState("submitted_success");
    }
  };

  const YES_COLOR = "#0F766E";
  const YES_LIGHT = "#CCFBF1";
  const NO_COLOR = "#C2410C";
  const NO_LIGHT = "#FEE2E2";
  const activeColor = direction === "YES" ? YES_COLOR : direction === "NO" ? NO_COLOR : C.combined;
  const currentProb = probability ?? 50;

  // ── Position view ──────────────────────────────────────────────────────────
  if (panelState === "submitted_success" && userForecast) {
    const posDir = deriveDirection(userForecast);
    const posColor = posDir === "YES" ? YES_COLOR : NO_COLOR;
    const posLight = posDir === "YES" ? YES_LIGHT : NO_LIGHT;
    const posProb = Math.min(100, Math.max(1, Number(userForecast.probability ?? currentProb) || 1));
    const safeStake = Math.max(0, Number(stake) || 0);
    const rawReward = safeStake * (100 / posProb);
    const posReward = Number.isFinite(rawReward) ? Math.round(rawReward) : null;
    const conviction = safeStake <= 20 ? "Low" : safeStake <= 70 ? "Medium" : "High";
    const posDelta = (liveCombined != null && Number.isFinite(liveCombined))
      ? Math.round(posProb - liveCombined)
      : null;

    return (
      <Card style={{ padding: isMobile ? 16 : 20, marginBottom: 14, fontFamily: FF }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%", background: posColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>✓</div>
          <span style={{ fontSize: 13, fontWeight: 700, color: posColor, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {posDir} Position Locked In
          </span>
        </div>

        {/* Your Position */}
        <div style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 10, background: posLight, border: `1px solid ${posColor}33` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.txt3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
            Your Position
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: rationale ? 8 : 0 }}>
            <span style={{ padding: "3px 10px", borderRadius: 999, background: posColor, color: "#fff", fontSize: 12, fontWeight: 800 }}>
              {posDir}
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: posColor }}>{fmtPct(posProb)}</span>
            <span style={{ fontSize: 12, color: C.txt3 }}>· {stake} pts staked</span>
          </div>
          {rationale ? (
            <p style={{ fontSize: 12, color: C.txt2, lineHeight: 1.5, margin: 0, fontStyle: "italic" }}>
              "{rationale}"
            </p>
          ) : null}
        </div>

        {/* Reward */}
        <div style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 10, background: C.surface, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.txt3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
            Reward
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 8 }}>
            +{stake} Signal Points committed
          </div>
          <div style={{ display: "flex", gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, color: C.txt3, marginBottom: 2 }}>Potential reward</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: YES_COLOR }}>{posReward != null ? `+${posReward} pts` : "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.txt3, marginBottom: 2 }}>Conviction</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.txt }}>{conviction}</div>
            </div>
          </div>
        </div>

        {/* Market context */}
        <div style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 10, background: C.surface, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.txt3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
            Market Context
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: C.txt2 }}>You entered at</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{fmtPct(posProb)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: C.txt2 }}>Current signal</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>{fmtPct(liveCombined)}</span>
            </div>
            {posDelta != null && (
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${C.border}`, paddingTop: 6, marginTop: 2 }}>
                <span style={{ fontSize: 13, color: C.txt2 }}>Δ vs signal</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: posDelta >= 0 ? YES_COLOR : NO_COLOR }}>
                  {posDelta != null && Number.isFinite(posDelta) ? `${posDelta >= 0 ? "+" : ""}${posDelta} pts` : "—"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Resolution criteria */}
        {signal.resolution_criteria ? (
          <div style={{ padding: "10px 14px", borderRadius: 10, marginBottom: 10, background: C.borderL, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.txt3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
              Resolves YES if
            </div>
            <p style={{ fontSize: 12, color: C.txt2, lineHeight: 1.5, margin: 0 }}>
              {signal.resolution_criteria}
            </p>
          </div>
        ) : null}


      </Card>
    );
  }

  // ── Composing / idle view ──────────────────────────────────────────────────
  return (
    <Card style={{ padding: isMobile ? 16 : 20, marginBottom: 14 }}>
      <div style={{ fontFamily: FF, fontSize: 11, fontWeight: 700, color: C.txt3, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>
        {userForecast ? "Your Prediction" : "Make Your Prediction"}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: direction ? 20 : 0 }}>
        <button
          onClick={() => handleDirectionSelect("YES")}
          style={{
            flex: 1, height: 60, borderRadius: 14, border: "none",
            background: direction === "NO" ? YES_LIGHT : YES_COLOR,
            color: direction === "NO" ? YES_COLOR : "#fff",
            cursor: "pointer", fontWeight: 800, fontFamily: FF, fontSize: 18,
            transition: "background 0.15s, color 0.15s",
          }}
        >Bet YES ↑</button>
        <button
          onClick={() => handleDirectionSelect("NO")}
          style={{
            flex: 1, height: 60, borderRadius: 14, border: "none",
            background: direction === "YES" ? NO_LIGHT : NO_COLOR,
            color: direction === "YES" ? NO_COLOR : "#fff",
            cursor: "pointer", fontWeight: 800, fontFamily: FF, fontSize: 18,
            transition: "background 0.15s, color 0.15s",
          }}
        >Bet NO ↓</button>
      </div>

      {!isAuthenticated && (
        <div style={{
          fontFamily: FF,
          fontSize: 12,
          color: C.aiTxt,
          fontWeight: 500,
          textAlign: "center",
          marginTop: 10,
          marginBottom: direction ? 10 : 0,
          opacity: 0.75,
          letterSpacing: "0.01em",
        }}>
          +1,000 Signal Points when you create your account
        </div>
      )}

      {direction && (
        <>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.txt2, marginBottom: 8, fontFamily: FF }}>
              How likely is this?
            </div>
            <input
              type="range" min={0} max={100} value={currentProb}
              onChange={(e) => setProbability(Number(e.target.value))}
              style={{ width: "100%", accentColor: activeColor, marginBottom: 8 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: activeColor, fontFamily: FF, letterSpacing: "-0.03em" }}>
                {fmtPct(currentProb)}
              </span>
              <span style={{ fontSize: 12, color: C.txt3, fontFamily: FF }}>
                Current signal: {fmtPct(liveCombined)}
              </span>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.txt2, fontFamily: FF }}>Stake (Signal Points)</div>
              <div style={{ fontSize: 11, color: C.txt3, fontFamily: FF, marginTop: 2 }}>Higher stake = stronger conviction</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {[10, 50, 100].map((value) => (
                <button
                  key={value}
                  onClick={() => setStake(value)}
                  style={{
                    flex: 1, padding: "9px 0", borderRadius: 10,
                    border: `1.5px solid ${stake === value ? activeColor : C.border}`,
                    background: stake === value ? activeColor + "18" : "#fff",
                    color: stake === value ? activeColor : C.txt2,
                    cursor: "pointer", fontWeight: 700, fontFamily: FF, fontSize: 14,
                    transition: "border-color 0.1s, background 0.1s, color 0.1s",
                  }}
                >{value}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <textarea
              rows={3}
              placeholder="What's driving your view? (optional)"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              style={{ ...inputStyle, resize: "vertical", marginBottom: 0 }}
            />
          </div>

          <button
            disabled={isSaving}
            onClick={handleSubmit}
            style={{
              width: "100%", padding: "15px 0", borderRadius: 14, border: "none",
              background: activeColor, color: "#fff",
              cursor: isSaving ? "not-allowed" : "pointer",
              fontWeight: 800, fontFamily: FF, fontSize: 16,
              opacity: isSaving ? 0.7 : 1,
            }}
          >
            {isSaving ? "Saving..." : `Submit ${direction} Prediction`}
          </button>
        </>
      )}
    </Card>
  );
}


function SignalDetailPage({
  signal,
  onBack,
  onNavigate,
  allSignals,
  onSave,
  userForecast,
  liveHuman,
  liveContributors,
  liveCombined,
  isLoading,
  isSaving,
  successMessage,
  isAuthenticated,
  aiSummary,
}) {
  const { isMobile, isTablet } = useBreakpoint();
  const stackRightRail = isMobile || isTablet;
  const hasHumanData = liveContributors > 0;

  // Category-scoped prev/next navigation
  const categorySignals = useMemo(
    () => (allSignals || []).filter((s) => s.category === signal.category),
    [allSignals, signal.category]
  );
  const currentIndex = categorySignals.findIndex((s) => String(s.id) === String(signal.id));
  const prevSignal = currentIndex > 0 ? categorySignals[currentIndex - 1] : null;
  const nextSignal = currentIndex < categorySignals.length - 1 ? categorySignals[currentIndex + 1] : null;
  const posLabel = categorySignals.length > 1
    ? `${currentIndex + 1} / ${categorySignals.length}`
    : null;

  const [hoveredNav, setHoveredNav] = useState(null); // "prev" | "next" | null

  const truncate = (str, n) => (str && str.length > n ? str.slice(0, n) + "…" : str);

  const navArrowStyle = (which, signal) => {
    const active = !!signal;
    const hovered = active && hoveredNav === which;
    return {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 36,
      height: 36,
      minWidth: 36,
      borderRadius: 7,
      border: "none",
      background: !active ? "#E5E7EB" : hovered ? "#374151" : C.ink,
      color: !active ? "#9CA3AF" : "#FFFFFF",
      fontSize: 18,
      lineHeight: 1,
      fontFamily: FF,
      cursor: active ? "pointer" : "default",
      transition: "background 0.12s, transform 0.1s",
      transform: hovered ? "scale(1.05)" : "scale(1)",
      userSelect: "none",
      flexShrink: 0,
    };
  };

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: isMobile ? "28px 16px 44px" : "34px 36px 60px",
      }}
    >
      {/* Back + prev/next row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 6,
          flexWrap: "nowrap",
        }}
      >
        <button onClick={onBack} style={{ ...secondaryBtn, flexShrink: 0 }}>
          ← Back
        </button>

        {posLabel && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            {/* Category context label — desktop only */}
            {!isMobile && (
              <span
                style={{
                  fontFamily: FF,
                  fontSize: 11,
                  color: C.txt3,
                  letterSpacing: "0.02em",
                  userSelect: "none",
                }}
              >
                {mapCategory(signal.category)} signals
              </span>
            )}

            {/* Nav pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: 4,
                boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
              }}
            >
              <button
                onClick={() => prevSignal && onNavigate(prevSignal)}
                disabled={!prevSignal}
                title={prevSignal ? prevSignal.question : undefined}
                onMouseEnter={() => prevSignal && setHoveredNav("prev")}
                onMouseLeave={() => setHoveredNav(null)}
                style={navArrowStyle("prev", prevSignal)}
              >
                ‹
              </button>

              <span
                style={{
                  fontFamily: FF,
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.txt,
                  minWidth: 48,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  userSelect: "none",
                  padding: "0 4px",
                }}
              >
                {posLabel}
              </span>

              <button
                onClick={() => nextSignal && onNavigate(nextSignal)}
                disabled={!nextSignal}
                title={nextSignal ? nextSignal.question : undefined}
                onMouseEnter={() => nextSignal && setHoveredNav("next")}
                onMouseLeave={() => setHoveredNav(null)}
                style={navArrowStyle("next", nextSignal)}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 22, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <Badge bg={C.humanBg} color={C.humanTxt}>
            {mapCategory(signal.category)}
          </Badge>
          <Badge bg="#F0FDF4" color="#166534">
            Active
          </Badge>
          <Badge bg="#F3F4F6" color="#374151">
            Resolution Signal
          </Badge>
        </div>

        <h1
          style={{
            fontFamily: FF,
            fontSize: isMobile ? 28 : 34,
            lineHeight: 1.3,
            color: C.txt,
            margin: "0 0 16px",
            maxWidth: 900,
          }}
        >
          {signal.question}
        </h1>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            overflowX: isMobile ? "auto" : "visible",
            paddingBottom: isMobile ? 4 : 0,
          }}
        >
          <MetaPill label="Combined Signal" value={fmtPct(liveCombined)} highlight />
          <MetaPill label="Human Consensus" value={hasHumanData ? fmtPct(liveHuman) : "No data"} />
          <MetaPill label="AI Consensus" value={fmtPct(signal.ai)} />
          <MetaPill label="Resolves" value={signal.resolutionDate} />
          <MetaPill label="Contributors" value={liveContributors} />
        </div>
      </div>

      {successMessage && (
        <div
          style={{
            marginBottom: 18,
            padding: "12px 16px",
            backgroundColor: C.successBg,
            border: `1px solid ${C.successBorder}`,
            borderRadius: 12,
            fontFamily: FF,
            fontSize: 14,
            color: C.successTxt,
            fontWeight: 600,
          }}
        >
          {successMessage}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: stackRightRail ? "1fr" : "minmax(0, 1fr) 312px",
          gap: 28,
          alignItems: "start",
        }}
      >
        <div>
          <Card style={{ padding: isMobile ? "18px 16px 16px" : "22px 24px 18px", marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 14,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontFamily: FF,
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.txt2,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Signal Evolution
              </div>
              {isLoading && <div style={{ fontSize: 12, color: C.txt3 }}>Loading…</div>}
            </div>

            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={CHART_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.borderL} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: C.txt3 }} />
                <YAxis tick={{ fontSize: 11, fill: C.txt3 }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={50} stroke="#D1D5DB" strokeDasharray="5 4" />
                <Area type="monotone" dataKey="high" stroke="none" fill={C.human} fillOpacity={0.06} />
                <Line type="monotone" dataKey="combined" stroke={C.combined} strokeWidth={2.5} name="Combined" />
                <Line type="monotone" dataKey="human" stroke={C.human} strokeWidth={2} name="Human" />
                <Line type="monotone" dataKey="ai" stroke={C.ai} strokeWidth={2} name="AI" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {hasHumanData ? (
            <div
              style={{
                marginBottom: 20,
                border: `1px solid ${C.warnBorder}`,
                borderRadius: 10,
                backgroundColor: C.warnBg,
                padding: "14px 18px",
                fontFamily: FF,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.warnTxt, marginBottom: 4 }}>
                Human / AI Divergence is Elevated
              </div>
              <div style={{ fontSize: 13, color: "#92400E", lineHeight: 1.55 }}>
                AI models are <strong>{Math.round(Math.abs(signal.ai - liveHuman))} points</strong> more
                optimistic than expert consensus.
              </div>
            </div>
          ) : (
            <div
              style={{
                marginBottom: 20,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                backgroundColor: C.borderL,
                padding: "14px 18px",
                fontFamily: FF,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 4 }}>
                No human forecasts yet
              </div>
              <div style={{ fontSize: 13, color: C.txt2, lineHeight: 1.55 }}>
                The current signal is showing the AI baseline only. Be the first to contribute a forecast.
              </div>
            </div>
          )}

          {userForecast && (
            <div
              style={{
                marginBottom: 20,
                padding: "12px 16px",
                backgroundColor: C.successBg,
                border: `1px solid ${C.successBorder}`,
                borderRadius: 10,
                fontFamily: FF,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: C.successTxt, marginBottom: 6 }}>
                Your Prediction
              </div>
              <div style={{ fontSize: 13, color: C.txt }}>
                Probability: <strong>{fmtPct(userForecast.probability)}</strong>{userForecast.confidence != null ? <> · Confidence: <strong>{userForecast.confidence}</strong></> : null}{" "}
                {userForecast.stake ? <>· Stake: <strong>{userForecast.stake}</strong></> : null}
              </div>
              {userForecast.rationale ? (
                <div style={{ fontSize: 13, color: C.txt2, marginTop: 4 }}>{userForecast.rationale}</div>
              ) : null}
            </div>
          )}

          <Card style={{ padding: isMobile ? "18px 16px" : "22px 24px" }}>
            <EvidenceAnalysis isMobile={isMobile} aiSummary={aiSummary} />
          </Card>
        </div>

        <div style={{ position: stackRightRail ? "static" : "sticky", top: 90 }}>
          <Card style={{ padding: isMobile ? 16 : 20, marginBottom: 14 }}>
            <div
              style={{
                fontFamily: FF,
                fontSize: 11,
                fontWeight: 700,
                color: C.txt3,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: 14,
              }}
            >
              Current Signal
            </div>

            <div
              style={{
                fontFamily: FF,
                fontSize: 42,
                fontWeight: 800,
                color: C.txt,
                lineHeight: 1,
                letterSpacing: "-0.04em",
                marginBottom: 4,
              }}
            >
              {fmtPct(liveCombined)}
            </div>
            <div style={{ fontSize: 12, color: C.txt2, fontFamily: FF, marginBottom: 16 }}>
              Combined forecast
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              <div
                style={{
                  padding: "10px 12px",
                  backgroundColor: C.humanBg,
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                <div style={{ fontFamily: FF, fontSize: 20, fontWeight: 600, color: C.humanTxt }}>
                  {liveContributors > 0 ? fmtPct(liveHuman) : "—"}
                </div>
                <div style={{ fontFamily: FF, fontSize: 11, color: C.humanTxt, marginTop: 2 }}>Human</div>
              </div>
              <div
                style={{
                  padding: "10px 12px",
                  backgroundColor: C.aiBg,
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                <div style={{ fontFamily: FF, fontSize: 20, fontWeight: 600, color: C.aiTxt }}>{fmtPct(signal.ai)}</div>
                <div style={{ fontFamily: FF, fontSize: 11, color: C.aiTxt, marginTop: 2 }}>AI</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                ["Contributors", liveContributors],
                ["Verified Experts", signal.verifiedExperts],
                ["Signal Strength", signal.signalStrength],
                ["AI Models", signal.aiModels],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    fontFamily: FF,
                  }}
                >
                  <span style={{ color: C.txt3 }}>{label}</span>
                  <span style={{ color: C.txt, fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
          </Card>

          <InlinePredictionBlock
            signal={signal}
            userForecast={userForecast}
            liveHuman={liveHuman}
            liveContributors={liveContributors}
            liveCombined={liveCombined}
            isSaving={isSaving}
            onSave={onSave}
            isAuthenticated={isAuthenticated}
          />
        </div>
      </div>
    </div>
  );
}

function LeaderboardPage({ selectedCategory }) {
  const { isMobile } = useBreakpoint();

  const filteredRows =
    selectedCategory === "All"
      ? LEADERBOARD
      : LEADERBOARD.filter((row) => mapCategory(row.domain) === selectedCategory);

  return (
    <div
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: isMobile ? "28px 16px 44px" : "42px 36px 60px",
      }}
    >
      <h1 style={{ fontFamily: FF, fontSize: isMobile ? 28 : 34, color: C.txt, margin: "0 0 12px" }}>
        {selectedCategory === "All" ? "Leaderboard" : `${selectedCategory} — Leaderboard`}
      </h1>
      <p style={{ fontFamily: FF, color: C.txt2, marginBottom: 24 }}>
        Ranked by forecast quality, calibration, and consistency.
      </p>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredRows.length === 0 ? (
            <div style={{ fontFamily: FF, fontSize: 14, color: C.txt3, padding: "24px 0" }}>
              No contributors in this category yet.
            </div>
          ) : filteredRows.map((row) => (
            <Card key={row.rank} style={{ padding: 16 }}>
              <div style={{ fontFamily: FF, fontSize: 14, color: C.txt3, marginBottom: 6 }}>
                Rank #{row.rank}
              </div>
              <div style={{ fontFamily: FF, fontSize: 18, fontWeight: 700, color: C.txt }}>
                {row.name}
              </div>
              <div style={{ fontFamily: FF, fontSize: 14, color: C.txt2, marginTop: 4 }}>
                {row.type} · {row.domain}
              </div>
              <div style={{ fontFamily: FF, fontSize: 14, color: C.txt2, marginTop: 10 }}>
                Accuracy: {row.accuracy} · Calibration: {row.calibration}
              </div>
              <div style={{ fontFamily: FF, fontSize: 14, color: C.txt2, marginTop: 4 }}>
                Reputation: {row.reputation} · Influence: {row.influence}
              </div>
            </Card>
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <div style={{ fontFamily: FF, fontSize: 14, color: C.txt3, padding: "32px 0" }}>
          No contributors in this category yet.
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FF }}>
            <thead style={{ background: C.borderL }}>
              <tr>
                {["Rank", "Contributor", "Type", "Domain", "Accuracy", "Calibration", "Reputation", "Influence"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "14px 16px",
                      fontSize: 12,
                      color: C.txt2,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.rank} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={td}>{row.rank}</td>
                  <td style={td}><strong>{row.name}</strong></td>
                  <td style={td}>{row.type}</td>
                  <td style={td}>{row.domain}</td>
                  <td style={td}>{row.accuracy}</td>
                  <td style={td}>{row.calibration}</td>
                  <td style={td}>{row.reputation}</td>
                  <td style={td}>{row.influence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function AIModelsPage() {
  const { isMobile } = useBreakpoint();

  return (
    <div
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        padding: isMobile ? "28px 16px 44px" : "42px 36px 60px",
      }}
    >
      <h1 style={{ fontFamily: FF, fontSize: isMobile ? 28 : 34, color: C.txt, margin: "0 0 12px" }}>
        AI Models
      </h1>
      <p style={{ fontFamily: FF, color: C.txt2, marginBottom: 24 }}>
        The AI baseline layer combines multiple model perspectives into structured forecast inputs.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
          gap: 14,
        }}
      >
        {AI_MODELS.map((model) => (
          <Card key={model.name} style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
              <div>
                <div style={{ fontFamily: FF, fontSize: 18, fontWeight: 700, color: C.txt }}>
                  {model.name}
                </div>
                <div style={{ fontFamily: FF, fontSize: 13, color: C.txt2, marginTop: 4 }}>
                  {model.role}
                </div>
              </div>
              <div style={{ fontFamily: FF, fontSize: 28, fontWeight: 800, color: C.txt }}>
                {model.score}
              </div>
            </div>
            <div style={{ fontFamily: FF, fontSize: 13, color: C.txt2, lineHeight: 1.6 }}>
              {model.strengths}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const PREVIEW_CARDS = [
  {
    category: "AI & ML",
    categoryBg: C.humanBg,
    categoryColor: C.humanTxt,
    headline: "Likely at 77% with tight consensus",
    pct: 77,
    primaryDriver: "AI infrastructure demand sustaining rapid revenue growth",
    mainConstraint: "Customer concentration and revenue timing risk",
    netEffect: "Signal is slightly bullish with tight consensus across models.",
  },
  {
    category: "AI & ML",
    categoryBg: C.humanBg,
    categoryColor: C.humanTxt,
    headline: "Near-even at 47% with moderate disagreement",
    pct: 47,
    primaryDriver: "Rapid open-model iteration and post-training gains",
    mainConstraint: "Closed-model edge in reliability and multimodal benchmarks",
    netEffect: "Signal is near-even with moderate disagreement on capability convergence.",
  },
  {
    category: "Science",
    categoryBg: "#F0FDF4",
    categoryColor: "#166534",
    headline: "Near-even at 51% with wide disagreement",
    pct: 51,
    primaryDriver: "Strong efficacy driving broad patient demand",
    mainConstraint: "Coverage, pricing, and adherence limiting scale",
    netEffect: "Signal is near-even with wide disagreement on adoption pace.",
  },
  {
    category: "AI & ML",
    categoryBg: C.humanBg,
    categoryColor: C.humanTxt,
    headline: "Unlikely at 22% with tight consensus",
    pct: 22,
    primaryDriver: "Automation reaching routine white-collar workflows",
    mainConstraint: "Companies avoiding explicit AI attribution in layoffs",
    netEffect: "Signal is skewed cautious with tight consensus across models.",
  },
];

function SignalPreviewCard({ card }) {
  const headlineColor = card.pct >= 60 ? C.aiTxt : card.pct >= 40 ? C.txt : "#92400E";
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        background: C.surface,
        padding: "16px 18px",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 9px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            backgroundColor: card.categoryBg,
            color: card.categoryColor,
            fontFamily: FF,
          }}
        >
          {card.category}
        </span>
        <span style={{ fontFamily: FF, fontSize: 20, fontWeight: 800, color: C.txt, lineHeight: 1 }}>
          {card.pct}%
        </span>
      </div>
      <div style={{ fontFamily: FF, fontSize: 14, fontWeight: 600, color: headlineColor, marginBottom: 14, lineHeight: 1.35 }}>
        {card.headline}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: FF, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: C.txt3, marginBottom: 3 }}>
            Primary driver
          </div>
          <div style={{ fontFamily: FF, fontSize: 12, color: C.txt, lineHeight: 1.4 }}>
            {card.primaryDriver}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: FF, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: C.txt3, marginBottom: 3 }}>
            Main constraint
          </div>
          <div style={{ fontFamily: FF, fontSize: 12, color: C.txt, lineHeight: 1.4 }}>
            {card.mainConstraint}
          </div>
        </div>
      </div>
      <div
        style={{
          borderTop: `1px solid ${C.borderL}`,
          paddingTop: 10,
          fontFamily: FF,
          fontSize: 12,
          color: C.txt2,
          fontStyle: "italic",
          lineHeight: 1.45,
        }}
      >
        {card.netEffect}
      </div>
    </div>
  );
}

function ScrollingSignals({ isMobile }) {
  const [paused, setPaused] = useState(false);

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28 }}>
        {PREVIEW_CARDS.slice(0, 2).map((card, i) => (
          <SignalPreviewCard key={i} card={card} />
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        height: 520,
        overflow: "hidden",
        borderRadius: 16,
        position: "relative",
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <style>{`
        @keyframes fs-scroll-up {
          from { transform: translateY(0); }
          to   { transform: translateY(-50%); }
        }
      `}</style>
      {/* Fade masks */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 48,
        background: "linear-gradient(to bottom, #F9FAFB, transparent)",
        zIndex: 2, pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 64,
        background: "linear-gradient(to top, #F9FAFB, transparent)",
        zIndex: 2, pointerEvents: "none",
      }} />
      {/* Scrolling track — 2 copies for seamless loop */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          animationName: "fs-scroll-up",
          animationDuration: "28s",
          animationTimingFunction: "linear",
          animationIterationCount: "infinite",
          animationPlayState: paused ? "paused" : "running",
        }}
      >
        {[...PREVIEW_CARDS, ...PREVIEW_CARDS].map((card, i) => (
          <SignalPreviewCard key={i} card={card} />
        ))}
      </div>
    </div>
  );
}

function StartSignalModal({ onClose }) {
  const { isMobile } = useBreakpoint();
  const [question, setQuestion] = useState("");
  const [domain, setDomain] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [context, setContext] = useState("");

  const inputStyle = {
    fontFamily: FF,
    fontSize: 14,
    color: C.txt,
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    resize: "vertical",
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.surface,
          borderRadius: 16,
          padding: isMobile ? "28px 20px" : "36px 32px",
          width: "100%",
          maxWidth: 520,
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <h2
            style={{
              fontFamily: FF,
              fontSize: isMobile ? 18 : 20,
              fontWeight: 700,
              color: C.txt,
              margin: 0,
              lineHeight: 1.3,
              maxWidth: 380,
            }}
          >
            What question are you trying to answer?
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.txt3,
              fontSize: 20,
              lineHeight: 1,
              padding: "0 0 0 12px",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Main prompt */}
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Will NVIDIA hit $100B revenue by FY2027?"
          rows={4}
          style={{ ...inputStyle, marginBottom: 20 }}
          autoFocus
        />

        {/* Optional fields */}
        <div
          style={{
            borderTop: `1px solid ${C.borderL}`,
            paddingTop: 16,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontFamily: FF,
              fontSize: 11,
              fontWeight: 600,
              color: C.txt3,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Optional
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain (AI, Pharma, Policy...)"
              style={inputStyle}
            />
            <input
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              placeholder="Timeframe (e.g. by end of 2026)"
              style={inputStyle}
            />
          </div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Any additional context..."
            rows={2}
            style={inputStyle}
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ ...secondaryBtn, fontSize: 14, padding: "10px 18px" }}
          >
            Cancel
          </button>
          <button
            style={{ ...primaryBtn, fontSize: 14, padding: "10px 20px", opacity: question.trim() ? 1 : 0.5 }}
            disabled={!question.trim()}
          >
            Start a Signal
          </button>
        </div>
      </div>
    </div>
  );
}

function CompanyPage({ onNav }) {
  const { isMobile } = useBreakpoint();
  const [showModal, setShowModal] = useState(false);

  const sectionGap = { marginBottom: isMobile ? 52 : 64 };

  const bulletItem = (text, muted = false) => (
    <div
      key={text}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        fontFamily: FF,
        fontSize: 14,
        color: muted ? C.txt2 : C.txt,
        lineHeight: 1.55,
      }}
    >
      <span style={{ color: muted ? C.txt3 : C.txt2, fontSize: 10, flexShrink: 0, marginTop: 2 }}>●</span>
      <span>{text}</span>
    </div>
  );

  return (
    <>
      {showModal && <StartSignalModal onClose={() => setShowModal(false)} />}
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: isMobile ? "36px 16px 72px" : "56px 36px 88px",
        }}
      >
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div
          style={{
            ...sectionGap,
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 380px",
            gap: isMobile ? 0 : 52,
            alignItems: "start",
          }}
        >
          <div>
            <h1
              style={{
                fontFamily: FF,
                fontSize: isMobile ? 28 : 38,
                fontWeight: 800,
                color: C.txt,
                margin: "0 0 16px",
                lineHeight: 1.2,
                letterSpacing: "-0.02em",
              }}
            >
              See What the Right Experts Actually Believe
            </h1>
            <p
              style={{
                fontFamily: FF,
                fontSize: isMobile ? 15 : 17,
                color: C.txt2,
                lineHeight: 1.65,
                margin: "0 0 8px",
                maxWidth: 500,
              }}
            >
              We source, evaluate, and track expert forecasts so you can see who is right, where conviction is real, and where the market is mispriced across AI, biotech, and emerging systems.
            </p>
            <p
              style={{
                fontFamily: FF,
                fontSize: isMobile ? 14 : 15,
                color: C.txt3,
                margin: "0 0 28px",
              }}
            >
              Ask a question. Get a signal.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowModal(true)}
                style={{ ...primaryBtn, fontSize: 15, padding: "12px 22px" }}
              >
                Start a Signal
              </button>
              <button
                onClick={() => onNav("index")}
                style={{ ...secondaryBtn, fontSize: 15, padding: "12px 22px" }}
              >
                View Signals
              </button>
            </div>
          </div>
          <ScrollingSignals isMobile={isMobile} />
        </div>

        {/* ── Where Expert Opinion Breaks ───────────────────────── */}
        <div style={sectionGap}>
          <h2 style={{ fontFamily: FF, fontSize: isMobile ? 20 : 24, fontWeight: 700, color: C.txt, margin: "0 0 20px" }}>
            Where Expert Opinion Breaks
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
            {[
              "Strong opinions, no probabilities",
              "No way to know who has been right",
              "Consensus is noisy and unreliable",
              "No system to track belief over time",
            ].map((t) => bulletItem(t, true))}
          </div>

          <div
            style={{
              fontFamily: FF,
              fontSize: isMobile ? 16 : 18,
              fontWeight: 700,
              color: C.txt,
              marginBottom: 16,
            }}
          >
            We turn this into signals
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              "Every question becomes a probability",
              "Every prediction is scored on resolution",
              "Every expert builds a track record",
              "Signals aggregate into measurable conviction",
            ].map((t) => bulletItem(t, false))}
          </div>
        </div>

        {/* ── What You Actually See ─────────────────────────────── */}
        <div style={sectionGap}>
          <h2 style={{ fontFamily: FF, fontSize: isMobile ? 20 : 24, fontWeight: 700, color: C.txt, margin: "0 0 20px" }}>
            What You Actually See
          </h2>

          {/* Signal output example */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              background: C.surface,
              padding: "18px 20px",
              marginBottom: 24,
            }}
          >
            <div
              style={{
                fontFamily: FF,
                fontSize: 11,
                fontWeight: 600,
                color: C.txt3,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Signal Output
            </div>
            <div
              style={{
                fontFamily: FF,
                fontSize: isMobile ? 20 : 24,
                fontWeight: 800,
                color: C.txt,
                marginBottom: 12,
              }}
            >
              77% likely
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "6px 20px" }}>
              {[
                ["Driver", "AI capex growth"],
                ["Constraint", "Customer concentration"],
              ].map(([label, val]) => (
                <div key={label} style={{ fontFamily: FF, fontSize: 13, color: C.txt2 }}>
                  <span style={{ fontWeight: 600, color: C.txt }}>{label}</span>{"  "}{val}
                </div>
              ))}
            </div>
            <div
              style={{
                fontFamily: FF,
                fontSize: 13,
                color: C.txt2,
                fontStyle: "italic",
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px solid ${C.borderL}`,
              }}
            >
              Bullish with tight consensus
            </div>
          </div>

          {/* What this gives you */}
          <div>
            <div style={{ fontFamily: FF, fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 10 }}>
              What this gives you
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                "Where experts agree vs diverge",
                "What is driving the outcome",
                "Who has been consistently right",
              ].map((t) => bulletItem(t, true))}
            </div>
          </div>
        </div>

        {/* ── Market Intelligence Report ───────────────────────── */}
        {(() => {
          const mirTrend = [
            { month: "Jan", v: 68 },
            { month: "Feb", v: 71 },
            { month: "Mar", v: 70 },
            { month: "Apr", v: 74 },
            { month: "May", v: 73 },
            { month: "Jun", v: 77 },
          ];
          return (
            <div style={sectionGap}>
              <div
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  background: C.surface,
                  overflow: "hidden",
                  fontFamily: FF,
                }}
              >
                {/* Header */}
                <div
                  style={{
                    padding: isMobile ? "18px 18px 16px" : "22px 28px 18px",
                    borderBottom: `1px solid ${C.borderL}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: C.txt3,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Signal Report
                  </div>
                  <div
                    style={{
                      fontSize: isMobile ? 16 : 19,
                      fontWeight: 700,
                      color: C.txt,
                      marginBottom: 10,
                    }}
                  >
                    AI Infrastructure Demand Outlook
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 26, fontWeight: 800, color: C.txt, lineHeight: 1 }}>77%</span>
                    <span style={{ fontSize: 13, color: C.txt2 }}>likely</span>
                    <span style={{ width: 1, height: 14, background: C.border, display: "inline-block" }} />
                    <span style={{ fontSize: 13, color: C.txt2 }}>Tight consensus</span>
                  </div>
                </div>

                {/* Body */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  }}
                >
                  {/* Left: labeled fields */}
                  <div
                    style={{
                      padding: isMobile ? "18px 18px" : "22px 28px",
                      borderRight: isMobile ? "none" : `1px solid ${C.borderL}`,
                      borderBottom: isMobile ? `1px solid ${C.borderL}` : "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 18,
                    }}
                  >
                    {[
                      ["Primary Driver", "AI infrastructure demand"],
                      ["Main Constraint", "Customer concentration"],
                      ["Expert Disagreement", "Moderate disagreement across investor vs researcher views"],
                    ].map(([label, val]) => (
                      <div key={label}>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: C.txt3,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            marginBottom: 4,
                          }}
                        >
                          {label}
                        </div>
                        <div style={{ fontSize: 14, color: C.txt, lineHeight: 1.45 }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Right: trend chart */}
                  <div style={{ padding: isMobile ? "18px 18px" : "22px 28px" }}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: C.txt3,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        marginBottom: 14,
                      }}
                    >
                      Signal Evolution
                    </div>
                    <ResponsiveContainer width="100%" height={110}>
                      <ComposedChart data={mirTrend} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <defs>
                          <linearGradient id="mirAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={C.human} stopOpacity={0.1} />
                            <stop offset="100%" stopColor={C.human} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 10, fill: C.txt3, fontFamily: FF }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis domain={[60, 85]} hide />
                        <Area
                          type="monotone"
                          dataKey="v"
                          fill="url(#mirAreaGrad)"
                          stroke="none"
                        />
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={C.human}
                          strokeWidth={2}
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Footer */}
                <div
                  style={{
                    padding: isMobile ? "11px 18px" : "12px 28px",
                    borderTop: `1px solid ${C.borderL}`,
                    fontSize: 12,
                    color: C.txt3,
                  }}
                >
                  Based on 12 expert forecasts and 3 AI models
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Expert Disagreement + Forecaster Performance ─────── */}
        <div
          style={{
            ...sectionGap,
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: 16,
          }}
        >
          {/* Expert Disagreement Panel */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              background: C.surface,
              padding: "20px 22px",
              fontFamily: FF,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 20 }}>
              Where experts disagree
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                ["Researcher", 65],
                ["Investor", 48],
                ["Operator", 55],
                ["AI", 52],
              ].map(([label, pct]) => (
                <div key={label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                      fontSize: 12,
                      color: C.txt2,
                    }}
                  >
                    <span>{label}</span>
                    <span style={{ fontWeight: 600, color: C.txt }}>{pct}%</span>
                  </div>
                  <div
                    style={{
                      background: C.borderL,
                      borderRadius: 4,
                      height: 5,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        background: C.txt2,
                        height: "100%",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Forecaster Performance Panel */}
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              background: C.surface,
              padding: "20px 22px",
              fontFamily: FF,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: C.txt, marginBottom: 16 }}>
              Top Forecasters
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Name", "Accuracy", "Calibration"].map((h) => (
                    <th
                      key={h}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: C.txt3,
                        textAlign: "left",
                        paddingBottom: 10,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        fontFamily: FF,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Sarah Chen", "87%", "0.82"],
                  ["Claude Analyst", "90%", "0.87"],
                  ["Marcus Reeves", "84%", "0.79"],
                ].map(([name, acc, cal]) => (
                  <tr key={name} style={{ borderTop: `1px solid ${C.borderL}` }}>
                    <td
                      style={{
                        fontSize: 13,
                        color: C.txt,
                        fontWeight: 500,
                        padding: "11px 0",
                        fontFamily: FF,
                      }}
                    >
                      {name}
                    </td>
                    <td
                      style={{
                        fontSize: 13,
                        color: C.txt2,
                        padding: "11px 0",
                        fontFamily: FF,
                      }}
                    >
                      {acc}
                    </td>
                    <td
                      style={{
                        fontSize: 13,
                        color: C.txt2,
                        padding: "11px 0",
                        fontFamily: FF,
                      }}
                    >
                      {cal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Final CTA ─────────────────────────────────────────── */}
        <div
          style={{
            borderRadius: 16,
            background: C.ink,
            padding: isMobile ? "32px 24px" : "44px 48px",
          }}
        >
          <h2
            style={{
              fontFamily: FF,
              fontSize: isMobile ? 20 : 24,
              fontWeight: 700,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Start a Signal
          </h2>
          <p
            style={{
              fontFamily: FF,
              fontSize: 15,
              color: "rgba(255,255,255,0.65)",
              margin: "0 0 24px",
              lineHeight: 1.6,
              maxWidth: 400,
            }}
          >
            Ask a question. Get a signal.
          </p>
          <button
            onClick={() => setShowModal(true)}
            style={{
              ...primaryBtn,
              background: "#fff",
              color: C.ink,
              fontSize: 15,
              padding: "12px 24px",
            }}
          >
            Start a Signal
          </button>
        </div>
      </div>
    </>
  );
}

function MethodologyPage() {
  const { isMobile } = useBreakpoint();

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: isMobile ? "28px 16px 44px" : "42px 36px 60px",
      }}
    >
      <h1 style={{ fontFamily: FF, fontSize: isMobile ? 28 : 34, color: C.txt, margin: "0 0 12px" }}>
        Methodology
      </h1>
      <p style={{ fontFamily: FF, color: C.txt2, marginBottom: 26 }}>
        Future Signals combines human forecasts and AI baseline estimates into a structured decision signal.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        {[
          ["Human Consensus", "Average of submitted human probability estimates for a given signal."],
          ["AI Consensus", "AI baseline probability used as a comparison layer."],
          ["Combined Signal", "When no human data exists, combined = AI baseline. Once human forecasts exist, combined = 60% human consensus + 40% AI consensus."],
          ["Identity", "Forecasts are linked to authenticated users so forecasting history can be tracked over time."],
          ["Leaderboard", "Current leaderboard is still placeholder UI. True ranking requires resolved outcomes and scoring."],
        ].map(([title, body]) => (
          <Card key={title} style={{ padding: 20 }}>
            <div style={{ fontFamily: FF, fontSize: 16, fontWeight: 700, color: C.txt, marginBottom: 8 }}>
              {title}
            </div>
            <div style={{ fontFamily: FF, fontSize: 14, color: C.txt2, lineHeight: 1.65 }}>
              {body}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: `1px solid ${C.borderL}`,
        fontFamily: FF,
        fontSize: 13,
      }}
    >
      <span style={{ color: C.txt2 }}>{label}</span>
      <span style={{ fontWeight: 600, color: C.txt }}>{value}</span>
    </div>
  );
}

const primaryBtn = {
  padding: "12px 16px",
  background: C.ink,
  color: "#fff",
  borderRadius: 12,
  border: "none",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: FF,
  fontSize: 14,
};

const secondaryBtn = {
  padding: "10px 14px",
  background: "#fff",
  color: C.txt,
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  cursor: "pointer",
  fontFamily: FF,
  fontSize: 14,
};

const inputStyle = {
  display: "block",
  width: "100%",
  marginBottom: 12,
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  boxSizing: "border-box",
  fontSize: 14,
  fontFamily: FF,
};

const selectStyle = {
  padding: "10px 14px",
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  background: C.surface,
  fontFamily: FF,
  fontSize: 14,
};

const td = {
  padding: "14px 16px",
  fontFamily: FF,
  fontSize: 14,
  color: C.txt,
};

function AuthGate({
  authMode,
  setAuthMode,
  email,
  setEmail,
  password,
  setPassword,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  role,
  setRole,
  onClose,
  onContinue,
  onForgotPassword,
  authStatus,
  pendingDraft,
}) {
  const isSignup = authMode === "signup";
  const hasDraft = !!pendingDraft;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 110,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          borderRadius: 16,
          border: `1px solid ${C.border}`,
          padding: 28,
          fontFamily: FF,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: C.txt }}>
            {hasDraft
              ? (isSignup ? "Lock in your prediction" : "Sign in to submit")
              : (isSignup ? "Create account" : "Sign in")}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: C.txt3, padding: "0 0 0 8px", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {hasDraft && isSignup && (
          <div style={{ fontSize: 15, fontWeight: 600, color: C.aiTxt, marginBottom: 12, marginTop: 4 }}>
            ✨ Get 1,000 Signal Points instantly
          </div>
        )}

        {hasDraft && (
          <div style={{
            background: C.borderL,
            borderRadius: 8,
            padding: "9px 13px",
            marginBottom: 16,
            fontSize: 13,
            color: C.txt2,
            lineHeight: 1.5,
          }}>
            <span style={{ fontWeight: 600, color: C.txt }}>
              {(pendingDraft.probability ?? 50) >= 50 ? "YES" : "NO"} · {fmtPct(pendingDraft.probability ?? 50)}
            </span>
            {pendingDraft.stake ? <> · {pendingDraft.stake} pts staked</> : null}
            {" — saved automatically after sign-up."}
          </div>
        )}

        <p style={{ fontSize: 13, color: C.txt2, margin: "0 0 20px" }}>
          {isSignup ? (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setAuthMode("login")}
                style={{ background: "none", border: "none", color: C.ai, cursor: "pointer", fontSize: 13, padding: 0, fontFamily: FF }}
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                onClick={() => setAuthMode("signup")}
                style={{ background: "none", border: "none", color: C.ai, cursor: "pointer", fontSize: 13, padding: 0, fontFamily: FF }}
              >
                Create account
              </button>
            </>
          )}
        </p>

        {isSignup && (
          <>
            <input
              type="text"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              style={inputStyle}
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={{ ...selectStyle, display: "block", width: "100%", marginBottom: 12, boxSizing: "border-box" }}
            >
              <option value="">Role (optional)</option>
              <option value="researcher">Researcher</option>
              <option value="investor">Investor</option>
              <option value="engineer">Engineer</option>
              <option value="policymaker">Policymaker</option>
              <option value="other">Other</option>
            </select>
          </>
        )}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />

        {authStatus && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: C.borderL,
              color: C.txt2,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {authStatus}
          </div>
        )}

        <button onClick={onContinue} style={{ ...primaryBtn, width: "100%", marginBottom: 10 }}>
          {isSignup ? "Create account" : "Sign in"}
        </button>

        {!isSignup && (
          <button
            onClick={onForgotPassword}
            style={{ background: "none", border: "none", color: C.txt2, cursor: "pointer", fontSize: 13, fontFamily: FF, padding: 0 }}
          >
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
}

function RewardOverlay({ onDone }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // Trigger CSS transition on next frame
    const show = requestAnimationFrame(() => setVisible(true));
    const dismiss = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 300); // wait for fade-out before removing
    }, 1100);
    return () => { cancelAnimationFrame(show); clearTimeout(dismiss); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.35)",
      opacity: visible ? 1 : 0,
      transition: "opacity 0.3s ease",
      pointerEvents: "none",
    }}>
      <div style={{
        background: C.surface,
        borderRadius: 20,
        padding: "36px 44px",
        textAlign: "center",
        fontFamily: FF,
        boxShadow: `0 0 0 1px ${C.ai}30, 0 8px 40px rgba(0,0,0,0.18)`,
        transform: visible ? "scale(1)" : "scale(0.97)",
        transition: "transform 0.35s ease, opacity 0.3s ease",
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.txt, marginBottom: 6 }}>
          You unlocked 1,000 Signal Points
        </div>
        <div style={{ fontSize: 14, color: C.txt2, fontWeight: 400 }}>
          Welcome to Future Signals
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("index");
  const [selectedCategory, setSelectedCategory] = useCategoryParam();
  const [signals, setSignals] = useState([]);
  const [activeSignalId, setActiveSignalId] = useState(null);
  const [userForecasts, setUserForecasts] = useState({});
  const [forecastRowsBySignal, setForecastRowsBySignal] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const [currentUser, setCurrentUser] = useState(null);
  const [userPointsBalance, setUserPointsBalance] = useState(null);
  const [bonusMessage, setBonusMessage] = useState("");
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [pendingForecast, setPendingForecast] = useState(null);
  const [showRewardOverlay, setShowRewardOverlay] = useState(false);
  const [rewardJustLanded, setRewardJustLanded] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);

  const [authMode, setAuthMode] = useState("signup");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFirstName, setAuthFirstName] = useState("");
  const [authLastName, setAuthLastName] = useState("");
  const [authRole, setAuthRole] = useState("");
  const [authStatus, setAuthStatus] = useState("");

  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const fetchSignals = async () => {
    const { data, error } = await supabase
      .from("signals")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[fetchSignals] ERROR:", error);
      return;
    }

    console.log(`[fetchSignals] DB returned ${(data || []).length} active signal(s):`,
      (data || []).map(s => ({ id: s.id, status: s.status, question: s.question?.slice(0, 60) }))
    );
    setSignals(data || []);
  };

  const fetchAllForecasts = async () => {
    const { data, error } = await supabase
      .from("forecasts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("FETCH ALL FORECASTS ERROR:", error);
      return;
    }

    const grouped = {};
    for (const row of data || []) {
      const key = String(row.signal_id);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    setForecastRowsBySignal(grouped);

    const mine = {};
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user?.id) {
      for (const row of data || []) {
        if (row.user_id === session.user.id) {
          mine[String(row.signal_id)] = row;
        }
      }
      setUserForecasts(mine);
    }
  };

  useEffect(() => {
    fetchSignals();
    fetchAllForecasts();

    const channel = supabase
      .channel("signals-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, () => {
        fetchSignals();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    if (signals.length && !activeSignalId) {
      setActiveSignalId(signals[0].id);
    }
  }, [signals, activeSignalId]);

  const fetchAiSummary = async (signalId) => {
    const { data, error } = await supabase
      .from("ai_forecast_summaries")
      .select("summary")
      .eq("question_id", signalId)
      .maybeSingle();

    if (error) {
      console.warn("[fetchAiSummary] error for", signalId, ":", error.message);
      setAiSummary(null);
      return;
    }

    const payload = data?.summary ?? null;
    console.log("[fetchAiSummary] loaded for", signalId, ":", payload);
    console.log("[fetchAiSummary] synthesis:", payload?.synthesis ?? null);
    setAiSummary(payload);
  };

  useEffect(() => {
    if (activeSignalId) {
      fetchAiSummary(activeSignalId);
    } else {
      setAiSummary(null);
    }
  }, [activeSignalId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchUserPoints = async (userId) => {
    if (!userId) return null;
    const { data, error } = await supabase
      .from("user_points")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data != null) {
      setUserPointsBalance(data.balance);
      return data.balance;
    }
    return null;
  };

  const bootstrapUserPoints = async (userId) => {
    if (!userId) return;
    const balance = await fetchUserPoints(userId);
    if (balance === null) {
      // No row yet — claim signup bonus (idempotent at DB level)
      try {
        await supabase.rpc("claim_signup_bonus");
      } catch (_) {}
      const fresh = await fetchUserPoints(userId);
      if (fresh !== null) {
        setBonusMessage("🎉 Welcome bonus awarded! Your Signal Points are ready.");
        setTimeout(() => setBonusMessage(""), 7000);
      }
    }
  };

  useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) bootstrapUserPoints(user.id);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) bootstrapUserPoints(user.id);
      if (!user) setUserPointsBalance(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const hash = window.location.hash || "";
    const search = window.location.search || "";

    if (hash.includes("type=recovery") || search.includes("type=recovery")) {
      setShowResetPassword(true);
      setShowAuthGate(false);
      setPage("index");
      setAuthStatus("");
    }
  }, []);

  const activeSignalBase =
    signals.find((s) => String(s.id) === String(activeSignalId)) || null;

  const rowsForSignal = forecastRowsBySignal[String(activeSignalId)] || [];

  const liveHuman = useMemo(() => {
    if (!rowsForSignal.length) return 0;
    const total = rowsForSignal.reduce((sum, row) => sum + Number(row.probability || 0), 0);
    return Math.round(total / rowsForSignal.length);
  }, [rowsForSignal]);

  const liveContributors = useMemo(() => rowsForSignal.length, [rowsForSignal]);

  const liveCombined = useMemo(() => {
    if (!activeSignalBase) return 0;
    if (activeSignalBase.combined_signal != null) return activeSignalBase.combined_signal;
    if (liveContributors === 0) return activeSignalBase.ai_consensus || 0;
    return Math.round(liveHuman * 0.6 + (activeSignalBase.ai_consensus || 0) * 0.4);
  }, [liveHuman, liveContributors, activeSignalBase]);

  const hydratedSignals = useMemo(() => {
    console.log(`[hydratedSignals] rendering ${signals.length} card(s) from DB`);
    return signals.map((signal) => {
      const rows = forecastRowsBySignal[String(signal.id)] || [];
      const hasHumanData = rows.length > 0;

      const human = hasHumanData
        ? Math.round(
            rows.reduce((sum, row) => sum + Number(row.probability || 0), 0) / rows.length
          )
        : 0;

      const contributorCount = rows.length;
      const calculatedCombined = hasHumanData
        ? Math.round(human * 0.6 + (signal.ai_consensus || 0) * 0.4)
        : signal.ai_consensus || 0;

      return {
        id: signal.id,
        question: signal.question,
        category: signal.category,
        resolutionDate: signal.resolution_date,
        human,
        ai: signal.ai_consensus || 0,
        combined: signal.combined_signal ?? calculatedCombined,
        contributorCount,
        hasHumanData,
        signalStrength: signal.signal_strength || null,
        verifiedExperts: signal.verified_experts_count || 0,
        aiModels: signal.ai_models_count || 0,
        divergence: signal.divergence ?? (hasHumanData ? Math.abs((signal.ai_consensus || 0) - human) : 0),
      };
    });
  }, [signals, forecastRowsBySignal]);

  const effectiveSignal = useMemo(() => {
    if (!activeSignalBase) return null;
    return {
      id: activeSignalBase.id,
      question: activeSignalBase.question,
      category: activeSignalBase.category,
      resolutionDate: activeSignalBase.resolution_date,
      human: liveHuman,
      ai: activeSignalBase.ai_consensus || 0,
      combined: activeSignalBase.combined_signal ?? liveCombined,
      contributorCount: liveContributors,
      signalStrength: activeSignalBase.signal_strength || null,
      verifiedExperts: activeSignalBase.verified_experts_count || 0,
      aiModels: activeSignalBase.ai_models_count || 0,
      divergence: activeSignalBase.divergence ?? (liveContributors > 0 ? Math.abs((activeSignalBase.ai_consensus || 0) - liveHuman) : 0),
    };
  }, [activeSignalBase, liveHuman, liveContributors, liveCombined]);

  const upsertProfile = async (user, firstName, lastName, role) => {
    const displayName =
      [firstName, lastName].filter(Boolean).join(" ").trim() || user.email;

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      first_name: firstName || null,
      last_name: lastName || null,
      role: role || null,
      display_name: displayName,
    });

    if (error) {
      console.error("PROFILE UPSERT ERROR:", error);
    }
  };

  const saveForecastToDatabase = async (forecastData, user) => {
    const probabilityNumber = Number(forecastData.probability);

    const payload = {
      signal_id: activeSignalId,
      user_id: user.id,
      probability: probabilityNumber,
      confidence: forecastData.confidence,
      rationale: forecastData.rationale || null,
    };

    const { error } = await supabase.from("forecasts").insert([payload]);

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);
      setSuccessMessage(`Error saving forecast: ${error.message}`);
      return false;
    }

    setUserForecasts((prev) => ({
      ...prev,
      [activeSignalId]: payload,
    }));

    await fetchAllForecasts();
    setSuccessMessage("Prediction recorded ✅ Your contribution is now part of the live signal.");
    setPage("detail");
    return true;
  };

  const handleSaveForecast = async (data) => {
    const probabilityNumber = Number(data.probability);

    if (Number.isNaN(probabilityNumber) || probabilityNumber < 0 || probabilityNumber > 100) {
      setSuccessMessage("Please enter a valid probability between 0 and 100.");
      return false;
    }

    if (!currentUser) {
      setPendingForecast(data);
      setAuthMode("signup");
      setAuthStatus("");
      setShowAuthGate(true);
      return false;
    }

    setIsSaving(true);
    const ok = await saveForecastToDatabase(data, currentUser);
    setIsSaving(false);
    return ok;
  };

  const handleAuthSubmit = async () => {
    setAuthStatus("");

    if (!authEmail || !authPassword) {
      setAuthStatus("Please enter email and password.");
      return;
    }

    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail,
        password: authPassword,
      });

      if (error) {
        setAuthStatus(error.message);
        return;
      }

      if (data.user) {
        await upsertProfile(data.user, authFirstName, authLastName, authRole);
        setCurrentUser(data.user);

        if (pendingForecast) {
          setIsSaving(true);
          const ok = await saveForecastToDatabase(pendingForecast, data.user);
          setIsSaving(false);

          if (ok) {
            setPendingForecast(null);
            setShowAuthGate(false);
            setAuthStatus("");
            setSuccessMessage("✅ Prediction recorded. Your signal is now part of the market.");
            setAuthMode("signup");
            setAuthEmail("");
            setAuthPassword("");
            setAuthFirstName("");
            setAuthLastName("");
            setAuthRole("");
            setShowRewardOverlay(true);
          }
        } else {
          setShowAuthGate(false);
          setSuccessMessage("Account created successfully.");
          setAuthMode("signup");
          setAuthEmail("");
          setAuthPassword("");
          setAuthFirstName("");
          setAuthLastName("");
          setAuthRole("");
          setShowRewardOverlay(true);
        }
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });

      if (error) {
        setAuthStatus(error.message);
        return;
      }

      if (data.user) {
        setCurrentUser(data.user);

        if (pendingForecast) {
          setIsSaving(true);
          const ok = await saveForecastToDatabase(pendingForecast, data.user);
          setIsSaving(false);

          if (ok) {
            setPendingForecast(null);
            setShowAuthGate(false);
            setAuthStatus("");
            setSuccessMessage("Logged in and prediction saved.");
            setAuthEmail("");
            setAuthPassword("");
          }
        } else {
          setShowAuthGate(false);
          setSuccessMessage("Logged in successfully.");
          setAuthEmail("");
          setAuthPassword("");
        }
      }
    }
  };

  const handleForgotPassword = async () => {
    setAuthStatus("");

    if (!authEmail) {
      setAuthStatus("Enter your email first.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
      redirectTo: window.location.origin,
    });

    if (error) {
      setAuthStatus(error.message);
    } else {
      setAuthStatus("Password reset email sent.");
    }
  };

  const handleSetNewPassword = async () => {
    setAuthStatus("");

    if (!newPassword) {
      setAuthStatus("Enter a new password.");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      setAuthStatus(error.message);
      return;
    }

    setShowResetPassword(false);
    setNewPassword("");
    setSuccessMessage("Password updated successfully.");
    setAuthMode("login");
    setShowAuthGate(true);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setSuccessMessage("Signed out.");
    setUserForecasts({});
  };

  const userForecast = userForecasts[activeSignalId] || null;

  const onNav = (targetPage) => {
    setSuccessMessage("");

    if (targetPage === "login") {
      setAuthMode("login");
      setShowAuthGate(true);
      return;
    }

    if (targetPage === "submit") {
      if (effectiveSignal) {
        setPage("detail");
      } else {
        setPage("index");
      }
      return;
    }

    setPage(targetPage);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <TopNav
        page={page}
        onNav={onNav}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        userStats={currentUser && userPointsBalance != null ? { points: userPointsBalance, streak: null, accuracy: null } : null}
        rewardJustLanded={rewardJustLanded}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {bonusMessage && (
        <div
          style={{
            background: "#ECFDF5",
            borderBottom: "1px solid #A7F3D0",
            padding: "12px 20px",
            fontFamily: FF,
            fontSize: 14,
            fontWeight: 600,
            color: "#065F46",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {bonusMessage}
          <button
            onClick={() => setBonusMessage("")}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#065F46", lineHeight: 1, padding: "0 0 0 12px" }}
          >
            ×
          </button>
        </div>
      )}

      {page === "index" && (
        <SignalsIndexPage
          signals={hydratedSignals}
          userForecasts={userForecasts}
          selectedCategory={selectedCategory}
          onOpen={(signal) => {
            setSuccessMessage("");
            setActiveSignalId(signal.id);
            setPage("detail");
          }}
        />
      )}

      {page === "detail" && effectiveSignal && (
        <SignalDetailPage
          signal={effectiveSignal}
          onBack={() => {
            setSuccessMessage("");
            setPage("index");
          }}
          onNavigate={(sig) => {
            setSuccessMessage("");
            setActiveSignalId(sig.id);
          }}
          allSignals={hydratedSignals}
          onSave={handleSaveForecast}
          userForecast={userForecast}
          liveHuman={liveHuman}
          liveContributors={liveContributors}
          liveCombined={liveCombined}
          isLoading={isLoading}
          isSaving={isSaving}
          successMessage={successMessage}
          isAuthenticated={!!currentUser}
          aiSummary={aiSummary}
        />
      )}

      {page === "leaderboard" && <LeaderboardPage selectedCategory={selectedCategory} />}
      {page === "models" && <AIModelsPage />}
      {page === "methodology" && <MethodologyPage />}
      {page === "company" && <CompanyPage onNav={(p) => setPage(p)} />}

      {showAuthGate && (
        <AuthGate
          authMode={authMode}
          setAuthMode={setAuthMode}
          email={authEmail}
          setEmail={setAuthEmail}
          password={authPassword}
          setPassword={setAuthPassword}
          firstName={authFirstName}
          setFirstName={setAuthFirstName}
          lastName={authLastName}
          setLastName={setAuthLastName}
          role={authRole}
          setRole={setAuthRole}
          onClose={() => setShowAuthGate(false)}
          onContinue={handleAuthSubmit}
          onForgotPassword={handleForgotPassword}
          authStatus={authStatus}
          pendingDraft={pendingForecast}
        />
      )}

      {showRewardOverlay && (
        <RewardOverlay
          onDone={() => {
            setShowRewardOverlay(false);
            setRewardJustLanded(true);
            setTimeout(() => setRewardJustLanded(false), 1800);
          }}
        />
      )}

      {showResetPassword && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: C.overlay,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 110,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#fff",
              borderRadius: 16,
              border: `1px solid ${C.border}`,
              padding: 24,
              fontFamily: FF,
            }}
          >
            <h2 style={{ fontSize: 28, margin: "0 0 10px", color: C.txt }}>
              Set new password
            </h2>

            <p style={{ fontSize: 14, color: C.txt2, lineHeight: 1.6, marginBottom: 18 }}>
              Enter your new password below.
            </p>

            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />

            {authStatus && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: C.borderL,
                  color: C.txt2,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {authStatus}
              </div>
            )}

            <button
              onClick={handleSetNewPassword}
              style={{ ...primaryBtn, width: "100%", marginBottom: 10 }}
            >
              Update password
            </button>

            <button
              onClick={() => {
                setShowResetPassword(false);
                setNewPassword("");
              }}
              style={{ ...secondaryBtn, width: "100%" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}