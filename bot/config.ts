/**
 * DipHunter — all tunable parameters in one place.
 *
 * Why these values: the dev window (24h of 1-minute CBBTC bars) is choppy
 * and nearly flat (+0.49% end to end). One-minute noise is ~6 bps while a
 * full round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~11 bps price
 * impact each way), so any signal that trades often bleeds fees — every
 * 1-minute EMA/Donchian/RSI variant we swept lost $74–$164 on the dev
 * window. The only family that made money was "buy a deep dip, ride the
 * recovery": few trades, each catching a >1% swing. A 63-combination grid
 * around these values had a median PnL of +$11 and only 6 losing combos,
 * so the edge is a plateau, not one lucky parameter set.
 */
export const CONFIG = {
  /** Symbol traded (the only symbol in this competition's universe). */
  symbol: "CBBTC",

  /** Entry: price must be this far below its recent high to count as a dip. */
  dipBps: 150, // 1.5%
  /** How far back the recent high is measured (bars of 1 minute). */
  lookbackBars: 360, // 6 hours
  /** Bounce confirmation: the close must sit at least this far above the
   * lowest low of the previous 10 bars, so we buy a dip that has started
   * to turn up instead of catching a falling knife mid-drop. */
  bounceBps: 10, // 0.1%
  /** Bars of history used for the bounce confirmation. */
  bounceBars: 10,

  /** Exit: take profit this far above the entry close. */
  takeProfitBps: 200, // 2.0%
  /** Exit: sell this far below the highest close since entry (trailing). */
  trailingStopBps: 120, // 1.2%
  /** Exit: hard stop this far below the entry close. */
  hardStopBps: 120, // 1.2%
  /** A round trip counts as a loss when it ends this far below entry. */
  lossThresholdBps: 50, // 0.5%

  /** Risk brake: after this many losing round trips in a row, the dip
   * threshold rises to `deepDipBps`, demanding stronger conviction before
   * the next entry. Never triggered on the dev window (no losing trade). */
  maxConsecutiveLosses: 2,
  /** Dip threshold while the loss brake is active. */
  deepDipBps: 200, // 2.0%

  /** Max move allowed from the latest close for a fill (harness cap). One
   * minute moves at most ~0.45% on the dev window, so 150 bps leaves room
   * for a gap minute without letting a fill run away. */
  maxSlippageBps: 150,
} as const;
