/** Share of a countdown left (0..1), relative to its full length; `fallbackSeconds` is used when the full length is unknown. */
export function timerShare(deadline: number, span: number | null, now: number, fallbackSeconds: number | null): number {
  const left = Math.max(0, deadline - now);
  const full = span != null && span > 0 ? span : fallbackSeconds ? fallbackSeconds * 1000 : 0;
  return full ? Math.min(1, left / full) : 0;
}
