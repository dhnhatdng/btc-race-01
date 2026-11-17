/**
 * DipHunter v3 — all tunable parameters in one place.
 *
 * v3 = v1's entries + a partial take-profit. v2 (dip 1.0% / 1h high /
 * trailing 0.8%) traded 4 round trips but only earned +$22.41, and the
 * dev leaderboard now shows ~600 entries above that (rank 602/2108, top
 * 10 paid). A ~5,000-combination sweep (Rounds A–H) found that NO
 * dip-buying variant reaches 4 entry cycles AND $35+ on this window:
 * the window only holds ~5 dip-recovery swings, the 4th available cycle
 * is a loser, shallower dips bleed fees, stricter bounces kill entries,
 * and scale-in legs never fill (the price never dips a further 30+ bps
 * after a bounce-confirmed entry). The best way back to $35+ is v1's
 * deep-dip entries (dip 1.5% / 6h high / trailing 1.2%, +$35.94, 3
 * cycles) plus selling 1/3 of the position at +1.75%: that banks a
 * third of the move early instead of risking giving it all back to the
 * trailing stop, for +$35.40 with 5 sell fills / 8 orders, a 0.66%
 * drawdown, +$24.29 / +$11.11 in the two halves, worst 6h window
 * -$1.00, and +$32.93 at 2x fees. The remainder still exits on the
 * usual +2% take-profit / trailing / hard stop.
 *
 * Why these values: the dev window (24h of 1-minute CBBTC bars) is choppy
 * and nearly flat (+0.49% end to end). One-minute noise is ~6 bps while a
 * full round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~11 bps price
 * impact each way), so any signal that trades often bleeds fees — every
 * 1-minute EMA/Donchian/RSI variant we swept lost $74–$164 on the dev
 * window. The only family that made money was "buy a dip, ride the
 * recovery": few trades, each catching a >1% swing.
 */
export const CONFIG = {
  /** Symbol traded (the only symbol in this competition's universe). */
  symbol: "CBBTC",

  /** Entry: price must be this far below its recent high to count as a dip. */
  dipBps: 150, // 1.5% (v2: 100 — the shallower dip caught a losing 4th cycle)
  /** How far back the recent high is measured (bars of 1 minute). */
  lookbackBars: 360, // 6 hours (v2: 60 — the 1h high missed the big swings' tops)
  /** Bounce confirmation: the close must sit at least this far above the
   * lowest low of the previous 10 bars, so we buy a dip that has started
   * to turn up instead of catching a falling knife mid-drop. */
  bounceBps: 10, // 0.1%
  /** Bars of history used for the bounce confirmation. */
  bounceBars: 10,

  /** Exit: take profit this far above the entry close. */
  takeProfitBps: 200, // 2.0%
  /** Exit: sell this far below the highest close since entry (trailing). */
  trailingStopBps: 120, // 1.2% (v2: 80)
  /** Exit: hard stop this far below the entry close. */
  hardStopBps: 120, // 1.2%
  /** A round trip counts as a loss when it ends this far below entry. */
  lossThresholdBps: 50, // 0.5%
  /** Partial take-profit (v3): once, per position, when the close first
   * reaches this far above the entry close, sell `partialTakeProfitBps`
   * share of the position and let the rest ride on the usual exits.
   * Banking a third early costs ~$0.54 of dev PnL vs v1 ($35.94 ->
   * $35.40) but adds 2 sell fills, cuts the drawdown to 0.66%, and
   * locks in profit on swings whose recovery reverses before the
   * trailing stop fires. */
  partialTakeProfitBps: 175, // +1.75%
  /** Share of the position sold at the partial take-profit, in bps. */
  partialTakeProfitShareBps: 3300, // 33%

  /** Risk brake: after this many losing round trips in a row, the dip
   * threshold rises to `deepDipBps`, demanding stronger conviction before
   * the next entry. */
  maxConsecutiveLosses: 2,
  /** Dip threshold while the loss brake is active. */
  deepDipBps: 200, // 2.0%

  /** Max move allowed from the latest close for a fill (harness cap). One
   * minute moves at most ~0.45% on the dev window, so 150 bps leaves room
   * for a gap minute without letting a fill run away. */
  maxSlippageBps: 150,
} as const;
