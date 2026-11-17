/**
 * Local replay runner for DipHunter (dev tool, not part of grading).
 *
 * Spawns the real entrypoint (`node main.ts`) as a child process and feeds
 * it the dev window exactly the way the grader does: one `hello`, then one
 * `batch` per 1-minute bar, then `done`. Orders decided on a batch fill at
 * the next bar's open, priced with the market model from RULES.txt:
 *
 *   - fee 4 bps on every fill, modelled slippage 2 bps,
 *   - constant-product impact against the bar's open depth:
 *     a buy pays open * (1 + slip) * (1 + a / D), a sell receives
 *     open * (1 - slip) / (1 + a / D), where a is the trade's size in USDC
 *     (a buy's notional less its fee, a sell's quantity valued at open),
 *   - fills past the order's max_slippage_bps from the latest close are
 *     rejected, as are orders on the last batch (after_end).
 *
 * Everything still held at the end is sold at the last close, same costs.
 * Prints net PnL, trades, maximum drawdown and the trade list, and — with
 * `--twice` — runs the bot a second time and compares the two action logs
 * byte for byte (the grader requires identical logs).
 *
 * Usage:
 *   node tools/replay.ts [--bot main.ts] [--twice]
 *   (paths are relative to the repository root; bars come from the kit at
 *   ../btc-race-01-kit/btc-race-24h-20261117-0603-kit/dataset)
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(ROOT, "..", "btc-race-01-kit", "btc-race-24h-20261117-0603-kit");
const PRICE_SCALE = 1e5; // CBBTC price_scale 5
const QTY_SCALE = 1e8; // CBBTC qty_scale 8
const START_CASH = 1000; // USDC
const FEE_BPS = 4;
const SLIP_BPS = 2;
const MIN_NOTIONAL = 1; // USDC

interface RawBar {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  o_depth: string[];
  c_depth: string[];
}

interface Fill {
  client_id: string;
  side: "buy" | "sell";
  status: "filled" | "rejected";
  reason: string | null;
  price: number;
  qty: number;
  notional: number;
  fee: number;
}

interface Trade {
  entryBar: number;
  exitBar: number;
  entryPrice: number;
  exitPrice: number;
  grossPct: number;
}

/** Read the dev window's bars (1440 one-minute CBBTC bars). */
function readBars(): RawBar[] {
  const gz = readFileSync(join(KIT, "dataset", "bars", "CBBTC.ndjson.gz"));
  const text = gunzipSync(gz).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RawBar);
}

const HELLO = {
  type: "hello",
  protocol: "agent-fun/bars-replay/v1",
  seed: "1794808980000",
  symbols: [
    {
      symbol: "CBBTC",
      mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
      price_scale: 5,
      qty_scale: 8,
    },
  ],
  capital: { quote: "USDC", quote_scale: 6, quote_units: "1000000000" },
  bar_interval: "1m",
  first_close_ms: 1794809040000,
  caps: { max_open_positions: 1, max_orders_per_bar: 16, max_weight_bps: 10000, shorts: false, leverage: false },
  fees: { fee_bps: FEE_BPS, slippage_bps: SLIP_BPS, min_notional_quote_units: "1000000" },
  latency_bars: 1,
};

/** Price the fills of one reply's orders at the next bar's open. */
function applyOrders(
  orders: Record<string, unknown>[],
  open: number,
  depth: number,
  latestClose: number,
  cash: number,
  qty: number,
): { cash: number; qty: number; cost: number; fills: Fill[] } {
  const fills: Fill[] = [];
  let newCash = cash;
  let newQty = qty;
  let cost = 0;
  for (const o of orders) {
    const side = o.side as string;
    const maxSlip = (o.max_slippage_bps as number) / 10_000;
    if (side === "buy") {
      const notional = Number(o.notional_quote_units) / 1e6;
      if (notional < MIN_NOTIONAL) {
        fills.push({ client_id: String(o.client_id), side: "buy", status: "rejected", reason: "below_min_notional", price: 0, qty: 0, notional: 0, fee: 0 });
        continue;
      }
      // The account rounds cash to whole micro-USDC, so a buy for exactly
      // the reported cash can exceed the float cash by < 1 micro-USDC:
      // clamp instead of rejecting on rounding dust.
      if (notional > newCash + 1e-6) {
        fills.push({ client_id: String(o.client_id), side: "buy", status: "rejected", reason: "insufficient_cash", price: 0, qty: 0, notional: 0, fee: 0 });
        continue;
      }
      const spendable = Math.min(notional, newCash);
      const spend = spendable * (1 - FEE_BPS / 10_000);
      const fillPrice = open * (1 + SLIP_BPS / 10_000) * (1 + spend / depth);
      if (fillPrice > latestClose * (1 + maxSlip)) {
        fills.push({ client_id: String(o.client_id), side: "buy", status: "rejected", reason: "max_slippage", price: 0, qty: 0, notional: 0, fee: 0 });
        continue;
      }
      const bought = spend / fillPrice;
      newQty += bought;
      newCash -= spendable;
      cost += spendable;
      fills.push({ client_id: String(o.client_id), side: "buy", status: "filled", reason: null, price: fillPrice, qty: bought, notional: spendable, fee: spendable * (FEE_BPS / 10_000) });
    } else {
      // The account rounds quantity to whole raw units (1e-8 BTC), so a
      // sell of the full reported position can exceed the float quantity
      // by rounding dust: clamp instead of rejecting.
      let sellQty = Number(o.qty) / QTY_SCALE;
      if (sellQty > newQty + 1e-6) {
        fills.push({ client_id: String(o.client_id), side: "sell", status: "rejected", reason: "insufficient_position", price: 0, qty: 0, notional: 0, fee: 0 });
        continue;
      }
      sellQty = Math.min(sellQty, newQty);
      const gross = sellQty * open;
      if (gross < MIN_NOTIONAL && sellQty < newQty - 1e-9) {
        fills.push({ client_id: String(o.client_id), side: "sell", status: "rejected", reason: "below_min_notional", price: 0, qty: 0, notional: 0, fee: 0 });
        continue;
      }
      const fillPrice = (open * (1 - SLIP_BPS / 10_000)) / (1 + gross / depth);
      if (fillPrice < latestClose * (1 - maxSlip)) {
        fills.push({ client_id: String(o.client_id), side: "sell", status: "rejected", reason: "max_slippage", price: 0, qty: 0, notional: 0, fee: 0 });
        continue;
      }
      const proceeds = sellQty * fillPrice * (1 - FEE_BPS / 10_000);
      newQty -= sellQty;
      newCash += proceeds;
      fills.push({ client_id: String(o.client_id), side: "sell", status: "filled", reason: null, price: fillPrice, qty: sellQty, notional: sellQty * fillPrice, fee: sellQty * fillPrice * (FEE_BPS / 10_000) });
    }
  }
  return { cash: newCash, qty: newQty, cost, fills };
}

/** Run the bot once over the dev window; returns the report + action log. */
async function runOnce(botPath: string, bars: RawBar[], debug: boolean): Promise<{ pnl: number; trades: number; maxDd: number; tradeList: Trade[]; actionLog: string }> {
  const bot: ChildProcessWithoutNullStreams = spawn("node", [botPath], { stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: bot.stdout });
  const replies: string[] = [];
  let resolveReply: ((line: string) => void) | null = null;
  lines.on("line", (line) => {
    replies.push(line);
    if (resolveReply !== null) {
      const r = resolveReply;
      resolveReply = null;
      r(line);
    }
  });
  const waitReply = (): Promise<string> =>
    new Promise((resolve) => {
      resolveReply = resolve;
    });

  const send = (msg: unknown): Promise<string> => {
    const p = waitReply();
    bot.stdin.write(`${JSON.stringify(msg)}\n`);
    return p;
  };

  let cash = START_CASH;
  let qty = 0;
  let cost = 0;
  let trades = 0;
  let peak = START_CASH;
  let maxDd = 0;
  const tradeList: Trade[] = [];
  let entryBar = -1;
  let entryPrice = 0;
  let pendingOrders: Record<string, unknown>[] = [];
  let pendingSeq = -1;

  // `hello` gets no reply: the bot only answers batches. Send it without
  // waiting, or the first wait would hang forever.
  bot.stdin.write(`${JSON.stringify(HELLO)}\n`);
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const close = Number(bar.c) / PRICE_SCALE;
    const open = Number(bar.o) / PRICE_SCALE;
    // Fills for the previous batch's orders, priced at this bar's open.
    let fills: Fill[] = [];
    if (pendingOrders.length > 0) {
      const depth = Number(bar.o_depth[0]) / 1e6;
      const prevClose = Number(bars[i - 1].c) / PRICE_SCALE;
      const res = applyOrders(pendingOrders, open, depth, prevClose, cash, qty);
      cash = res.cash;
      const beforeQty = qty;
      // Snap dust to zero: float residue below half a raw unit (1e-8 BTC)
      // would otherwise be reported to the bot as a ghost position of 0.
      qty = res.qty < 1e-8 ? 0 : res.qty;
      cost = qty > 0 ? cost + res.cost : 0;
      fills = res.fills;
      if (debug) {
        for (const f of fills) {
          console.error(`bar ${i}: fill ${f.side} ${f.status} ${f.reason ?? ""} qty=${f.qty.toFixed(8)} price=${f.price.toFixed(0)} cash=${cash.toFixed(2)} qtyHeld=${qty.toFixed(8)}`);
        }
      }
      for (const f of fills) {
        if (f.status !== "filled") continue;
        trades++;
        if (beforeQty === 0 && qty > 0) {
          entryBar = pendingSeq;
          entryPrice = f.price;
        } else if (beforeQty > 0 && qty === 0) {
          tradeList.push({ entryBar, exitBar: i, entryPrice, exitPrice: f.price, grossPct: (f.price / entryPrice - 1) * 100 });
        }
      }
    }
    const equity = cash + qty * close;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / START_CASH);
    const account = {
      cash_quote_units: String(Math.round(cash * 1e6)),
      positions:
        qty > 0
          ? [{ symbol: "CBBTC", qty: String(Math.round(qty * QTY_SCALE)), cost_quote_units: String(Math.round(cost * 1e6)) }]
          : [],
      equity_quote_units: String(Math.round(equity * 1e6)),
    };
    const batch = {
      type: "batch",
      seq: i,
      t: bar.t,
      bars: [{ symbol: "CBBTC", t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: null, o_depth: bar.o_depth, c_depth: bar.c_depth }],
      fills: fills.map((f) => ({
        client_id: f.client_id,
        symbol: "CBBTC",
        side: f.side,
        status: f.status,
        reason: f.reason,
        decided_bar: pendingSeq,
        fill_bar: i,
        price: String(Math.round(f.price * PRICE_SCALE)),
        qty: String(Math.round(f.qty * QTY_SCALE)),
        notional_quote_units: String(Math.round(f.notional * 1e6)),
        fee_quote_units: String(Math.round(f.fee * 1e6)),
      })),
      account,
    };
    // Every batch gets exactly one reply, including the last: the harness
    // rejects orders decided on it (after_end), it never skips the reply.
    const replyText = await send(batch);
    const reply = JSON.parse(replyText) as { seq: number; orders: Record<string, unknown>[] };
    pendingOrders = reply.orders;
    pendingSeq = i;
  }
  // Final flatten at the last close (harness rule, same costs): the
  // proceeds ADD to the cash already held, they do not replace it.
  if (qty > 0) {
    const lastClose = Number(bars[bars.length - 1].c) / PRICE_SCALE;
    const depth = Number(bars[bars.length - 1].c_depth[0]) / 1e6;
    const gross = qty * lastClose;
    const fillPrice = (lastClose * (1 - SLIP_BPS / 10_000)) / (1 + gross / depth);
    cash += qty * fillPrice * (1 - FEE_BPS / 10_000);
    tradeList.push({ entryBar, exitBar: bars.length - 1, entryPrice, exitPrice: fillPrice, grossPct: (fillPrice / entryPrice - 1) * 100 });
    trades++;
    qty = 0;
  }
  bot.stdin.write(JSON.stringify({ type: "done", seq: bars.length, reason: "end_of_data", account: { cash_quote_units: String(Math.round(cash * 1e6)), positions: [], equity_quote_units: String(Math.round(cash * 1e6)) } }) + "\n");
  bot.stdin.end();
  await new Promise<void>((resolve) => bot.on("exit", () => resolve()));
  return { pnl: cash - START_CASH, trades, maxDd, tradeList, actionLog: replies.join("\n") };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const botPath = join(ROOT, args.includes("--bot") ? args[args.indexOf("--bot") + 1] : "main.ts");
  const twice = args.includes("--twice");
  const debug = args.includes("--debug");
  const bars = readBars();
  console.log(`dev window: ${bars.length} bars, ${new Date(bars[0].t).toISOString()} -> ${new Date(bars[bars.length - 1].t).toISOString()}`);
  const first = await runOnce(botPath, bars, debug);
  console.log(`run 1: net PnL $${first.pnl.toFixed(2)}  trades ${first.trades}  max drawdown ${(first.maxDd * 100).toFixed(2)}%`);
  for (const t of first.tradeList) {
    console.log(`  buy bar ${t.entryBar} @ $${t.entryPrice.toFixed(0)} -> sell bar ${t.exitBar} @ $${t.exitPrice.toFixed(0)}: ${t.grossPct >= 0 ? "+" : ""}${t.grossPct.toFixed(2)}% gross`);
  }
  if (twice) {
    const second = await runOnce(botPath, bars, debug);
    console.log(`run 2: net PnL $${second.pnl.toFixed(2)}  trades ${second.trades}  max drawdown ${(second.maxDd * 100).toFixed(2)}%`);
    console.log(second.actionLog === first.actionLog ? "deterministic: action logs identical" : "NON-DETERMINISTIC: action logs differ");
  }
}

await main();
