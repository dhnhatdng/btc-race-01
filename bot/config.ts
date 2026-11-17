/**
 * DipHunter v2 — all tunable parameters in one place.
 *
 * v2 changes vs v1 (dip 1.5% / 6h high / trailing 1.2% -> dip 1.0% /
 * 1h high / trailing 0.8%): v1 earned +$35.94 on the dev window but only
 * traded 3 round trips, so the live 24h race could easily see 0-1 trades
 * if no deep dip shows up. A ~1,000-combination sweep showed the dev
 * window only holds ~5 distinct dip-recovery events, so no dip-buying
 * variant can trade much more — but the shallower 1.0% dip catches a
 * fourth event (a second dip in the same morning swing) for 4 round
 * trips at +$22.41, positive in both halves of the day (+$12.56 /
 * +$9.85) and with the worst 6h window only -$1.30. The 1.0% dip sits
 * on a broad plateau: across every lookback / bounce / TP / trailing /
 * RSI combination around it, the median PnL is +$17.49 and 214 of 216
 * combos are profitable, so the edge does not depend on one lucky
 * number. Chasing 10+ trades is impossible here — every faster-cycling
 * variant bleeds the ~30 bps round-trip cost and ends negative.
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
  dipBps: 100, // 1.0% (v1: 150)
  /** How far back the recent high is measured (bars of 1 minute). */
  lookbackBars: 60, // 1 hour (v1: 360 = 6 hours)
  /** Bounce confirmation: the close must sit at least this far above the
   * lowest low of the previous 10 bars, so we buy a dip that has started
   * to turn up instead of catching a falling knife mid-drop. */
  bounceBps: 10, // 0.1%
  /** Bars of history used for the bounce confirmation. */
  bounceBars: 10,

  /** Exit: take profit this far above the entry close. */
  takeProfitBps: 200, // 2.0%
  /** Exit: sell this far below the highest close since entry (trailing).
   * Tightened from 1.2% in v1: with a shallower entry the recovery is
   * smaller, so a tighter trail banks the move sooner and frees the
   * capital for the next dip instead of giving it all back. */
  trailingStopBps: 80, // 0.8% (v1: 120)
  /** Exit: hard stop this far below the entry close. */
  hardStopBps: 120, // 1.2%
  /** A round trip counts as a loss when it ends this far below entry. */
  lossThresholdBps: 50, // 0.5%

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
