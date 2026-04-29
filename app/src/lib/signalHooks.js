/**
 * Signal hook titles — short, punchy display names keyed by signal id.
 *
 * To add a hook for a new signal:
 *   1. Add the signal's id as a key (must match signals.id in the DB)
 *   2. Set a concise title (aim for 4–6 words, headline style)
 *
 * If a signal has no entry here, the UI falls back to showing the full
 * question text as before. Never breaks.
 *
 * Future: migrate these into a signals.hook column once the schema is ready.
 */

export const SIGNAL_HOOKS = {
  q1_open_source_parity: "Open Source vs. Frontier AI",

  // Future signals — add ids as they are created:
  // ai_nvidia_100b_fy2027: "NVIDIA $100B Backbone Bet",
  // ai_f500_ai_layoffs_2026: "White Collar Reality Check",
  // pharma_glp1_10pct_us_2028: "Weight Loss Takeover",
  // pharma_alz_phase3_30pct_2026: "Alzheimer's Breakthrough",
};

/**
 * Returns the hook title for a signal id, or null if none is defined.
 * Components should fall back to the full question when this returns null.
 *
 * @param {string | null | undefined} signalId
 * @returns {string | null}
 */
export function getSignalHook(signalId) {
  if (!signalId) return null;
  return SIGNAL_HOOKS[signalId] ?? null;
}
