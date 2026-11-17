/**
 * Small pure helpers over bar history. No I/O, no state, no randomness —
 * every function here is deterministic given the same bars, which is what
 * the harness requires (two runs must produce byte-identical action logs).
 *
 * Prices arrive as raw integers at the symbol's price_scale; callers keep
 * them as `number` (float64 holds integers up to 2^53 exactly, and CBBTC
 * closes are ~6.4e9, far below that).
 */

/** Highest `high` over the last `n` bars, or null when history is shorter. */
export function rollingHigh(highs: number[], n: number): number | null {
  if (highs.length < n) return null;
  let best = -Infinity;
  for (let i = highs.length - n; i < highs.length; i++) {
    if (highs[i] > best) best = highs[i];
  }
  return best;
}

/** Lowest `low` over the last `n` bars, or null when history is shorter. */
export function rollingLow(lows: number[], n: number): number | null {
  if (lows.length < n) return null;
  let best = Infinity;
  for (let i = lows.length - n; i < lows.length; i++) {
    if (lows[i] < best) best = lows[i];
  }
  return best;
}

/** `price` is at least `bps` basis points below `reference`. */
export function isDownByBps(price: number, reference: number, bps: number): boolean {
  return price * 10_000 <= reference * (10_000 - bps);
}

/** `price` is at least `bps` basis points above `reference`. */
export function isUpByBps(price: number, reference: number, bps: number): boolean {
  return price * 10_000 >= reference * (10_000 + bps);
}
