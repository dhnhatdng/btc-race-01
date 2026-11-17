/**
 * Risk management: how much to buy, when to get out, and when to demand
 * stronger conviction. All decisions are pure functions of the prices the
 * bot has already seen — no clock, no randomness, no network.
 *
 * The competition is long-only with at most one open position, so sizing is
 * simple: one full-size position (100% of cash) per trade. A trade has to
 * clear ~30 bps of round-trip cost, which is why entries only fire on
 * dips and exits only on a real recovery or a stop. v2's trailing stop is
 * 0.8% (was 1.2% in v1): with a shallower entry the recovery is smaller,
 * so the trail banks the move sooner instead of giving it all back.
 */
import { CONFIG } from "./config.ts";
import { isDownByBps, isUpByBps } from "./indicators.ts";

/** What the risk manager remembers about the open position (if any). */
export interface OpenPosition {
  /** Close of the bar on which the buy was decided. */
  entryClose: number;
  /** Highest close seen since entry (for the trailing stop). */
  peakClose: number;
}

/** The three ways a position can end, for logging and loss tracking. */
export type ExitReason = "take-profit" | "trailing-stop" | "hard-stop";

/**
 * Should the open position be sold on this bar's close?
 * Returns the reason, or null to keep holding.
 */
export function shouldExit(position: OpenPosition, close: number): ExitReason | null {
  if (isUpByBps(close, position.entryClose, CONFIG.takeProfitBps)) return "take-profit";
  if (isDownByBps(close, position.peakClose, CONFIG.trailingStopBps)) return "trailing-stop";
  if (isDownByBps(close, position.entryClose, CONFIG.hardStopBps)) return "hard-stop";
  return null;
}

/** Track the peak close while a position is open (call on every new bar). */
export function trackPeak(position: OpenPosition, close: number): OpenPosition {
  return { entryClose: position.entryClose, peakClose: Math.max(position.peakClose, close) };
}

/**
 * Dip threshold in effect right now. After `maxConsecutiveLosses` losing
 * round trips in a row the bar rises to `deepDipBps`, so the bot only
 * re-enters on a deeper dip instead of bleeding into a downtrend.
 */
export function activeDipBps(consecutiveLosses: number): number {
  return consecutiveLosses >= CONFIG.maxConsecutiveLosses ? CONFIG.deepDipBps : CONFIG.dipBps;
}

/** Update the loss streak after a round trip closes. */
export function updateLossStreak(
  consecutiveLosses: number,
  entryClose: number,
  exitClose: number,
): number {
  const lost = isDownByBps(exitClose, entryClose, CONFIG.lossThresholdBps);
  return lost ? consecutiveLosses + 1 : 0;
}
