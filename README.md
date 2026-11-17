# DipHunter — a BTC trading bot for make.fun

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/dhnhatdng/btc-race-01/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/dhnhatdng/btc-race-01/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A bot that trades Coinbase Wrapped BTC (CBBTC) against USDC, minute by minute, on a replay of on-chain prices. It starts with 1,000 USDC of paper money, long only, one full-size position at a time — and it only trades when the move is big enough to pay for itself.

**Dev-window result (v2): +$22.41 net PnL (+2.24%) on 4 round trips, 1.85% max drawdown, 75% win rate.** v1 earned +$35.94 but traded only 3 times; v2 trades the extra, shallower dip the window offers so a live 24 h race is less likely to see 0–1 trades. See [Backtest](#backtest) for the full numbers and the v1-vs-v2 comparison.

## The idea

The dev window (24 hours of 1-minute bars) is nearly flat (+0.49% end to end) and choppy: one-minute noise is ~6 bps, while a full round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~11 bps price impact each way). A bot that trades every wiggle pays the market maker and bleeds — every 1-minute EMA, Donchian and RSI variant we swept lost $74–$164 on the dev window, and even buy-and-hold made only +$1.07.

So DipHunter waits. The market swings ±1–2% a few times a day; the bot buys only the deep dips and rides the recovery:

1. **Buy** when the close has fallen **≥ 1.0% below its 1-hour high** *and* has bounced **≥ 0.1% off its 10-bar low** — a dip that has started to turn up, not a falling knife mid-drop.
2. **Sell** at **+2% take-profit**, a **0.8% trailing stop** from the highest close since entry, or a **1.2% hard stop** below the entry close.
3. **Risk brake:** after 2 losing round trips in a row, only a **≥ 2.0% dip** re-enters, so the bot stops bleeding into a downtrend instead of catching every dip on the way down.

On the dev window that is 4 round trips and nothing else — no noise trading, no leverage, no shorts. v1 used a 1.5% dip off a 6-hour high and a 1.2% trailing stop (3 round trips, +$35.94); v2's shallower 1.0% dip off a 1-hour high plus the tighter 0.8% trail catches a fourth event — a second dip in the same morning swing — at the cost of one losing round trip (−1.08%).

## Parameters

All of them live in one place, [`bot/config.ts`](bot/config.ts):

| Parameter | Value | Meaning |
|---|---|---|
| `dipBps` | 100 | Entry: dip below the 1-hour high (v1: 150) |
| `lookbackBars` | 60 | Bars of history for the recent high (1 h; v1: 360) |
| `bounceBps` | 10 | Entry: bounce above the 10-bar low |
| `bounceBars` | 10 | Bars of history for the bounce check |
| `takeProfitBps` | 200 | Exit: take profit above entry close |
| `trailingStopBps` | 80 | Exit: trailing stop below the peak close (v1: 120) |
| `hardStopBps` | 120 | Exit: hard stop below entry close |
| `maxConsecutiveLosses` | 2 | Losing round trips before the brake |
| `deepDipBps` | 200 | Dip threshold while the brake is active |
| `maxSlippageBps` | 150 | Max fill move allowed from the latest close |

The edge does not depend on one lucky number: a ~1,000-combination sweep around these values (dip 0.6–2.0%, lookback 30–480 bars, take-profit 0.8–2.5%, trailing 0.4–1.2%, RSI filters on/off) had a **median PnL of +$17.49** at dip 1.0% with 214 of 216 combinations profitable, and the chosen set is positive in both halves of the day (+$12.56 / +$9.85) with the worst 6-hour window only −$1.30. Chasing 10+ trades is not possible on this window — the window only holds ~5 distinct dip-recovery events, and every faster-cycling variant bleeds the ~30 bps round-trip cost and ends negative.

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

| Metric | v2 | v1 |
|---|---|---|
| Net PnL | **+$22.41 USDC (+2.24%)** | +$35.94 (+3.59%) |
| Net PnL at 2× fees | +$19.15 | +$33.46 |
| Trades | 7 filled orders (4 round trips) | 5 filled orders (3 round trips) |
| Win rate | 75% (3/4) | 100% (3/3) |
| Max drawdown | 1.85% | 0.70% |
| Fees paid | $3.25 | $2.46 |
| Exposure | 62.6% of the window in the market | 52.8% |
| Rejected orders | 0 | 0 |
| Determinism | L1 regrade reproduced byte for byte | same |

Trades (decision bar → fill at next open; prices are fill prices):

| Buy | Sell | Gross |
|---|---|---|
| bar 372 @ $64,099 | bar 515 @ $65,282 | +1.85% |
| bar 544 @ $64,771 | bar 554 @ $64,071 | −1.08% |
| bar 554 @ $64,296 | bar 968 @ $65,391 | +1.70% |
| bar 1101 @ $64,623 | bar 1439 @ $64,690 (final flatten) | +0.10% |

For comparison on the same window (same fill model): buy-and-hold +$1.07, hold-cash $0.00, EMA(8/21) cross −$106.21, Donchian 20/10 −$131.74, RSI(30/65) −$80.35. The house EMA-cross bot loses money on this window; DipHunter is not a copy of any baseline — `grade-local` reports it as "not a baseline".

## Limits

- The race window (24 h starting 15 minutes after the deadline) is unseen: a strong downtrend can still cost ~1.6% per losing round trip, capped by the loss brake and the 1.2% stops. The dev gate only asks for PnL > 0 on the dev window, which v2 clears by $22.41 (v1 cleared it by $35.94 with one fewer trade).
- The bot trades at most a few times a day by design — the dev window only holds ~5 distinct dip-recovery events, so no dip-buying variant trades much more. In a straight uptrend with no ≥ 1.0% dip it may sit in cash — that is the intended trade-off for not paying 30 bps per wiggle.
- Prices are replayed from one Orca pool; fills use that pool's open depth, so size is capped by the 100% position weight and the slippage guard.

---

<sub>Entered on [make.fun](https://make.fun/?ref=fs4ajvvm&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
