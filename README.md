# DipHunter — a BTC trading bot for make.fun

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/dhnhatdng/btc-race-01/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/dhnhatdng/btc-race-01/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A bot that trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute, on a replay of on-chain prices. It starts with 1,000 USDC of paper money, long only, one full-size position at a time — and it only trades when the move is big enough to pay for itself.

**Dev-window result (v3): +$35.40 net PnL (+3.54%) on 3 entry cycles / 7 trades, 0.66% max drawdown, 100% win rate.** v3 takes v1's deep-dip entries back (v2's shallower dip only earned +$22.41 and ranked 602/2108 on dev) and adds a partial take-profit that banks a third of the position at +1.75%. See [Backtest](#backtest) for the full numbers and the v1-vs-v2-vs-v3 comparison.

## The idea

The dev window (24 hours of 1-minute bars) is nearly flat (+0.49% end to end) and choppy: one-minute noise is ~6 bps, while a full round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~11 bps price impact each way). A bot that trades every wiggle pays the market maker and bleeds — every 1-minute EMA, Donchian and RSI variant we swept lost $74–$164 on the dev window, and even buy-and-hold made only +$1.07.

So DipHunter waits. The market swings ±1–2% a few times a day; the bot buys only the deep dips and rides the recovery:

1. **Buy** when the close has fallen **≥ 1.5% below its 6-hour high** *and* has bounced **≥ 0.1% off its 10-bar low** — a dip that has started to turn up, not a falling knife mid-drop.
2. **Bank a third** at **+1.75% above the entry close** (partial take-profit, once per position) — profit is locked in early instead of risking giving it all back to the trailing stop.
3. **Sell the rest** at **+2% take-profit**, a **1.2% trailing stop** from the highest close since entry, or a **1.2% hard stop** below the entry close.
4. **Risk brake:** after 2 losing round trips in a row, only a **≥ 2.0% dip** re-enters, so the bot stops bleeding into a downtrend instead of catching every dip on the way down.

On the dev window that is 3 entry cycles, 5 sell fills and nothing else — no noise trading, no leverage, no shorts. v1 used the same entries without the partial take-profit (3 round trips, +$35.94); v3's partial costs ~$0.54 of dev PnL but adds 2 sell fills and cuts the drawdown to 0.66%. v2 used a shallower 1.0% dip off a 1-hour high plus a tighter 0.8% trail (4 round trips, +$22.41) — the extra cycle was a loser (−1.08%), and a ~5,000-combination sweep found no dip-buying variant that reaches 4 entry cycles AND $35+ on this window.

## Parameters

All of them live in one place, [`bot/config.ts`](bot/config.ts):

| Parameter | Value | Meaning |
|---|---|---|
| `dipBps` | 150 | Entry: dip below the 6-hour high (v2: 100) |
| `lookbackBars` | 360 | Bars of history for the recent high (6 h; v2: 60) |
| `bounceBps` | 10 | Entry: bounce above the 10-bar low |
| `bounceBars` | 10 | Bars of history for the bounce check |
| `takeProfitBps` | 200 | Exit: take profit above entry close |
| `trailingStopBps` | 120 | Exit: trailing stop below the peak close (v2: 80) |
| `hardStopBps` | 120 | Exit: hard stop below entry close |
| `partialTakeProfitBps` | 175 | Partial exit: bank a third at +1.75% (v3, new) |
| `partialTakeProfitShareBps` | 3300 | Share of the position sold at the partial exit (33%) |
| `maxConsecutiveLosses` | 2 | Losing round trips before the brake |
| `deepDipBps` | 200 | Dip threshold while the brake is active |
| `maxSlippageBps` | 150 | Max fill move allowed from the latest close |

The edge does not depend on one lucky number: a ~5,000-combination sweep around these values (dip 0.5–2.0%, lookback 30–480 bars, take-profit 0.8–3.0%, trailing 0.4–2.0%, RSI filters on/off, scale-in legs, partial take-profits) found no dip-buying variant that reaches 4 entry cycles AND $35+ on this window — the window only holds ~5 distinct dip-recovery events, and the 4th available cycle is a loser. The chosen set is positive in both halves of the day (+$24.29 / +$11.11) with the worst 6-hour window only −$1.00. Chasing 10+ trades is not possible on this window — every faster-cycling variant bleeds the ~30 bps round-trip cost and ends negative.

## Layout

```
main.ts                 Entrypoint: wires the SDK shim to the strategy (thin)
bot/
  config.ts             All parameters, with the reasoning behind each
  strategy.ts           DipHunter: history, entry/exit decisions per batch
  risk.ts               Position sizing, exits, loss-streak brake
  indicators.ts         Pure helpers: rolling high/low, bps comparisons
vendor/
  makefun-bars.ts       Byte-identical copy of the kit's bars-replay/v1 SDK shim
tools/
  replay.ts             Local replay: runs the real bot on the dev window
                        through the exact protocol and fill model, prints
                        PnL / trades / drawdown; --twice checks determinism
```

The bot speaks `agent-fun/bars-replay/v1` over stdin/stdout (newline-delimited JSON) via the SDK shim, which owns the wire. The strategy itself is pure functions of the bars it has seen: no clock, no environment, no randomness, no network — two runs produce byte-identical action logs, as the grader requires.

## Run it

Grade on the dev window exactly the way the server does (needs the kit next to the repo, at `../btc-race-01-kit/btc-race-24h-20261117-0603-kit`):

```sh
# Official local grade (process driver; no Docker needed)
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree

# Fast local replay with the same fill model (also checks determinism)
node tools/replay.ts --twice
```

## Backtest

Dev window: 1,440 one-minute CBBTC bars, 2026-11-16 06:04 → 2026-11-17 06:03 UTC. Official `grade-local --driver process`:

| Metric | v3 | v2 | v1 |
|---|---|---|---|
| Net PnL | **+$35.40 USDC (+3.54%)** | +$22.41 (+2.24%) | +$35.94 (+3.59%) |
| Net PnL at 2× fees | +$32.93 | +$19.15 | +$33.46 |
| Trades | 7 filled orders (3 entry cycles, 5 sells) | 7 filled orders (4 round trips) | 5 filled orders (3 round trips) |
| Win rate | 100% (3/3 cycles) | 75% (3/4) | 100% (3/3) |
| Max drawdown | 0.66% | 1.85% | 0.70% |
| Fees paid | $2.46 | $3.25 | $2.46 |
| Exposure | 52.2% of the window in the market | 62.6% | 52.8% |
| Rejected orders | 0 | 0 | 0 |
| Determinism | L1 regrade reproduced byte for byte | same | same |

Trades (decision bar → fill at next open; prices are fill prices):

| Buy | Sell | Gross |
|---|---|---|
| bar 372 @ $64,099 | bar 515 @ $65,303 | +1.88% |
| bar 554 @ $64,296 | bar 968 @ $65,411 | +1.73% |
| bar 1233 @ $64,524 | bar 1439 @ $64,689 (final flatten) | +0.26% |

A third of each of the first two positions was banked earlier at the partial take-profit (decision bars 512 and 940, +1.75% above entry); the table above shows each cycle's final exit.

For comparison on the same window (same fill model): buy-and-hold +$1.07, hold-cash $0.00, EMA(8/21) cross −$106.21, Donchian 20/10 −$131.74, RSI(30/65) −$80.35. The house EMA-cross bot loses money on this window; DipHunter is not a copy of any baseline — `grade-local` reports it as "not a baseline".

## Limits

- The race window (24 h starting 15 minutes after the deadline) is unseen: a strong downtrend can still cost ~1.6% per losing round trip, capped by the loss brake and the 1.2% stops. The dev gate only asks for PnL > 0 on the dev window, which v3 clears by $35.40 (v2 cleared it by $22.41 with one more entry cycle).
- The bot trades at most a few times a day by design — the dev window only holds ~5 distinct dip-recovery events, so no dip-buying variant trades much more. In a straight uptrend with no ≥ 1.5% dip it may sit in cash — that is the intended trade-off for not paying 30 bps per wiggle.
- Prices are replayed from one Orca pool; fills use that pool's open depth, so size is capped by the 100% position weight and the slippage guard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fs4ajvvm&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
