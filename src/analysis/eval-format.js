// Format a White-relative centipawn score for display, Fritz/ChessBase style:
// a sign (+ = White better, − = Black better) and two decimals, e.g. "+0.84",
// "−1.02". The review clamps any score to ±1000 cp (a mate counts as ±1000),
// so |cp| ≥ 1000 shows as "+10+" / "−10+" rather than a mate distance.
export function fmtEval(cp) {
  if (cp >= 1000) return '+10+';
  if (cp <= -1000) return '−10+';
  const v = (Math.abs(cp) / 100).toFixed(2);
  return (cp >= 0 ? '+' : '−') + v;
}
