/**
 * DipHunter — entrypoint for make.fun's btc-race-24h-20261117-0603.
 *
 * A bot that trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by
 * minute, on a replay of on-chain prices. It starts with 1,000 USDC of
 * paper money, long only, one full-size position at a time:
 *
 *   - Buy when the close has fallen >= 1.5% below its 6-hour high and has
 *     bounced >= 0.1% off its 10-bar low (buy the dip, after it turns).
 *   - Sell at +2% take-profit, a 1.2% trailing stop, or a 1.2% hard stop.
 *   - After 2 losing round trips in a row, only a >= 2.0% dip re-enters.
 *
 * Run by the grader as `node /bot/main.ts` (Node 22 type stripping, so
 * this file uses erasable TypeScript only and imports with `.ts`
 * extensions). It speaks agent-fun/bars-replay/v1 over stdin/stdout via
 * the kit's SDK shim in vendor/ — the shim owns the wire, this file owns
 * the decisions. See bot/strategy.ts, bot/risk.ts, bot/indicators.ts and
 * bot/config.ts for the logic, and README.md for the full story.
 */
import { runBars } from "./vendor/makefun-bars.ts";
import { DipHunter } from "./bot/strategy.ts";

const hunter = new DipHunter();

await runBars({
  onBatch(state, batch) {
    return hunter.decide(state, batch.bars);
  },
});
