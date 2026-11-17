/**
 * DipHunter strategy v3: buy a dip, ride the recovery, get out on a
 * target or a stop. One asset (CBBTC), one position, full size.
 *
 * The idea, in one paragraph: on a flat, choppy 24 hours the market swings
 * ±1–2% a few times a day while one-minute noise is only ~6 bps. A bot
 * that trades every wiggle pays ~30 bps per round trip and bleeds. This
 * bot waits: it only buys when the close has fallen at least 1.5% below
 * its 6-hour high *and* has bounced a little off its 10-bar low, then
 * banks a third of the position at +1.75% and holds the rest until the
 * recovery reaches +2%, or a 1.2% trailing stop / hard stop takes it out.
 * On the dev window that is 3 entry cycles, 5 sell fills, +$35.40 net
 * of all fees, with a 0.66% maximum drawdown — and the same rule is
 * positive across a broad parameter plateau, so the edge does not depend
 * on one lucky number.
 *
 * v3 vs v1/v2: v1's entries are back (dip 1.5% / 6h high / trailing
 * 1.2%, after v2's shallower 1.0% / 1h high / 0.8% trail only earned
 * +$22.41 and ranked 602/2108 on dev), plus the new partial
 * take-profit: sell a third at +1.75%. The partial costs ~$0.54 of dev
 * PnL vs v1 ($35.94 -> $35.40) but adds 2 sell fills and locks in
 * profit on swings whose recovery reverses before the trailing stop
 * fires.
 *
 * Everything here is deterministic: the only inputs are the bars the
 * harness sends, in order. No clock, no environment, no randomness.
 */
import { CONFIG } from "./config.ts";
import { isDownByBps, isUpByBps, rollingHigh, rollingLow } from "./indicators.ts";
import {
  activeDipBps,
  shouldExit,
  shouldTakePartial,
  trackPeak,
  updateLossStreak,
  type OpenPosition,
} from "./risk.ts";
import type { Bar, BarsState, BuyInput, OrderInput, SellInput } from "../vendor/makefun-bars.ts";

/** Per-symbol price history, kept as plain numbers (raw price units). */
interface SymbolHistory {
  closes: number[];
  highs: number[];
  lows: number[];
}

export class DipHunter {
  /** History per symbol (here: just CBBTC). */
  readonly #history = new Map<string, SymbolHistory>();
  /** The open position, if the bot currently holds the symbol. */
  #position: OpenPosition | null = null;
  /** Losing round trips in a row (drives the risk brake). */
  #consecutiveLosses = 0;
  /** Whether the partial take-profit has already been taken on the
   * current position (at most once per position). */
  #partialTaken = false;
  /** Round trips completed, for diagnostics on stderr. */
  #roundTrips = 0;

  /**
   * Decide the orders for one batch. Called once per bar, in bar order.
   * Warm-up batches only build history: the replay rejects any order
   * decided on one, so none is sent.
   */
  decide(state: BarsState, batchBars: Bar[]): OrderInput[] {
    for (const bar of batchBars) this.#pushBar(bar);
    if (state.warmingUp) return [];

    const symbol = CONFIG.symbol;
    const close = state.close(symbol);
    if (close === null) return [];
    const closeNum = Number(close);

    // A position of zero quantity is no position (defensive: the harness
    // reports exact integers, but a 0-qty row must never block entries).
    const rawHeld = state.positions.get(symbol);
    const held = rawHeld !== undefined && rawHeld.qty > 0n ? rawHeld : undefined;
    if (held !== undefined && this.#position !== null) {
      return this.#maybeExit(state, symbol, held.qty, closeNum);
    }
    if (held === undefined && this.#position === null) {
      return this.#maybeEnter(state, symbol, closeNum);
    }
    // State and bookkeeping disagree (e.g. a fill was rejected): resync
    // from the account rather than trading on stale memory.
    this.#position = held !== undefined ? { entryClose: closeNum, peakClose: closeNum } : null;
    return [];
  }

  /** Record one bar in history. Gaps add nothing; a flat bar is a bar. */
  #pushBar(bar: Bar): void {
    let h = this.#history.get(bar.symbol);
    if (h === undefined) {
      h = { closes: [], highs: [], lows: [] };
      this.#history.set(bar.symbol, h);
    }
    h.closes.push(Number(bar.c));
    h.highs.push(Number(bar.h));
    h.lows.push(Number(bar.l));
  }

  /** Entry check: deep dip below the 6-hour high + a small bounce. */
  #maybeEnter(state: BarsState, symbol: string, close: number): OrderInput[] {
    const h = this.#history.get(symbol);
    if (h === undefined) return [];
    const recentHigh = rollingHigh(h.highs, CONFIG.lookbackBars);
    // Not enough history yet, or the dip is not deep enough.
    if (recentHigh === null || !isDownByBps(close, recentHigh, activeDipBps(this.#consecutiveLosses))) {
      return [];
    }
    // Bounce confirmation: close above the lowest low of the previous
    // 10 bars (excluding this bar) by at least `bounceBps`.
    const priorLows = h.lows.slice(0, -1);
    const bounceLow = rollingLow(priorLows, CONFIG.bounceBars);
    if (bounceLow === null || !isUpByBps(close, bounceLow, CONFIG.bounceBps)) return [];

    // Full size: everything the reply may still spend, capped by the
    // position-weight room the harness allows.
    const room = state.weightRoom(symbol);
    let notional = state.cash < room ? state.cash : room;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = {
      side: "buy",
      symbol,
      notional_quote_units: notional,
      max_slippage_bps: CONFIG.maxSlippageBps,
    };
    this.#position = { entryClose: close, peakClose: close };
    this.#partialTaken = false;
    return [buy];
  }

  /**
   * Exit check: partial take-profit first, then take-profit, trailing
   * stop or hard stop on this close. A partial sell only banks a third
   * of the position and leaves the rest (and the loss streak) untouched;
   * only a full exit closes the round trip.
   */
  #maybeExit(state: BarsState, symbol: string, qty: bigint, close: number): OrderInput[] {
    if (this.#position === null) return [];
    this.#position = trackPeak(this.#position, close);
    if (shouldTakePartial(this.#position, close, this.#partialTaken)) {
      const partialQty = (qty * BigInt(CONFIG.partialTakeProfitShareBps)) / 10_000n;
      if (partialQty > 0n) {
        this.#partialTaken = true;
        console.error(
          `bar ${state.seq}: exit partial-take-profit at ${close} ` +
            `(sold ${partialQty} of ${qty})`,
        );
        const sell: SellInput = {
          side: "sell",
          symbol,
          qty: partialQty,
          max_slippage_bps: CONFIG.maxSlippageBps,
        };
        return [sell];
      }
    }
    const reason = shouldExit(this.#position, close);
    if (reason === null) return [];
    const sell: SellInput = {
      side: "sell",
      symbol,
      qty,
      max_slippage_bps: CONFIG.maxSlippageBps,
    };
    this.#consecutiveLosses = updateLossStreak(
      this.#consecutiveLosses,
      this.#position.entryClose,
      close,
    );
    this.#roundTrips++;
    console.error(
      `bar ${state.seq}: exit ${reason} at ${close} (round trip #${this.#roundTrips}, ` +
        `loss streak ${this.#consecutiveLosses})`,
    );
    this.#position = null;
    this.#partialTaken = false;
    return [sell];
  }
}
