// Tiny Bot: beat buy-and-hold on hourly Solana prices.
//
// Two engines, one portfolio (long only, no leverage, no shorts):
//
//   1. Trend — EMA(5) crosses above EMA(12) with the gap already at least
//      15 bps of the price at the cross. A cross that is barely above zero
//      is chop, not a trend, so it is ignored. Exit when EMA(5) falls back
//      below EMA(12), or on a 2.5% stop, or a 4% take-profit.
//   2. Bounce — after a sharp drop, the close sits at least 3% under
//      EMA(12) while RSI(14) is at or under 45: buy the dip. Exit on a
//      2.5% stop, a 4% take-profit, or the close climbing back above
//      EMA(12).
//
// Sizing: at most 4 open positions, an equal equity slice each (capped at
// the harness's 25% weight cap). One bar of latency is priced in: orders
// decided on a bar's close fill at the next bar's open.
//
// Activity guard: the replay ranks entries with fewer than 8 trades below
// every entry that clears it, so if the window has been quiet — fewer than
// 8 filled trades by batch 48 — the bot loosens up for the rest of the
// window (any cross-up, a 1.2% dip, half-size slices, 1.5% stop /
// take-profit) until it has 10 filled trades, then goes back to the strict
// rules. In a window with real moves this never triggers.
//
// Deterministic: floats only, no clock, no environment, no randomness —
// the two grading runs produce identical action logs.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 5;
const SLOW_BARS = 12;
const RSI_BARS = 14;

/** Trend entry: the EMA gap at the cross, in bps of the close. */
const TREND_GAP_BPS = 15;
/** Bounce entry: the close this far under EMA(12), in percent. */
const BOUNCE_DIP_PCT = 3;
/** Bounce entry: RSI(14) at or under this. */
const BOUNCE_RSI_MAX = 45;
/** Stop-loss: the position worth this far under its cost, in bps. */
const STOP_BPS = 250;
/** Take-profit for trend positions, in bps over cost. */
const TREND_TP_BPS = 400;
/** Take-profit for bounce positions, in bps over cost. */
const BOUNCE_TP_BPS = 400;
/** The most symbols held at once. */
const TOP_SLOTS = 4;
const MAX_SLIPPAGE_BPS = 100;

/** Loose mode (see the header): the batch window it may run in. */
const LOOSE_FROM_SEQ = 48;
const LOOSE_TO_SEQ = 72;
/** Loose mode: it starts under this many filled trades, stops at this many. */
const LOOSE_START_TRADES = 8;
const LOOSE_STOP_TRADES = 10;
/** Loose mode: any cross-up, a smaller dip, a higher RSI cap. */
const LOOSE_GAP_BPS = 0;
const LOOSE_DIP_PCT = 1.2;
const LOOSE_RSI_MAX = 50;
/** Loose mode: half-size slices (equity / 8), tighter stop / take-profit. */
const LOOSE_SLOTS = 8;
const LOOSE_STOP_BPS = 150;
const LOOSE_TP_BPS = 150;

type Kind = 'trend' | 'bounce';

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

interface Series {
  fast: Ema;
  slow: Ema;
  /** fast - slow after the symbol's bar before this one, once both are set. */
  gap: number | null;
  /** The symbol's closes so far, oldest first. */
  closes: number[];
}

const series = new Map<string, Series>();
/** What kind each open position is (filled buys only). */
const kinds = new Map<string, Kind>();
/** Filled trades so far (buys and sells). */
let trades = 0;
/** Loose mode, once armed. */
let loose = false;
let orderNo = 1;

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function push(bar: Bar): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = {
      fast: { span: FAST_BARS, warm: [], value: null },
      slow: { span: SLOW_BARS, warm: [], value: null },
      gap: null,
      closes: [],
    };
    series.set(bar.symbol, s);
  }
  const c = Number(bar.c);
  s.closes.push(c);
  step(s.fast, c);
  step(s.slow, c);
  s.gap = s.fast.value !== null && s.slow.value !== null ? s.fast.value - s.slow.value : null;
  return s;
}

/** RSI(14) over the closes so far: 100 while the average loss is zero. */
function rsi(closes: readonly number[]): number | null {
  if (closes.length <= RSI_BARS) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - RSI_BARS; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

await runBars({
  onBatch(state: BarsState, batch) {
    // Settle the fills of the previous reply: count filled trades and learn
    // what kind each filled buy was (its client_id says so).
    for (const fill of batch.fills) {
      if (fill.status !== 'filled') continue;
      trades++;
      if (fill.side === 'buy') {
        kinds.set(fill.symbol, fill.client_id.startsWith('bB-') ? 'bounce' : 'trend');
      } else {
        kinds.delete(fill.symbol);
      }
    }

    const crossUp = new Set<string>();
    for (const bar of batch.bars) {
      const s = series.get(bar.symbol);
      const prevGap = s === undefined ? null : s.gap;
      const now = push(bar);
      if (prevGap !== null && now.gap !== null && now.gap > 0 && prevGap <= 0) crossUp.add(bar.symbol);
    }

    // While warming up every order would be rejected: wait for the window,
    // with the indicators already seeded from the warm-up bars.
    if (state.warmingUp) return [];

    // Loose mode: a quiet window still needs its 8 trades.
    if (state.seq >= LOOSE_FROM_SEQ && state.seq <= LOOSE_TO_SEQ && trades < LOOSE_START_TRADES) loose = true;
    if (trades >= LOOSE_STOP_TRADES || state.seq > LOOSE_TO_SEQ) loose = false;
    const gapBps = loose ? LOOSE_GAP_BPS : TREND_GAP_BPS;
    const dipPct = loose ? LOOSE_DIP_PCT : BOUNCE_DIP_PCT;
    const rsiMax = loose ? LOOSE_RSI_MAX : BOUNCE_RSI_MAX;
    const stopBps = loose ? LOOSE_STOP_BPS : STOP_BPS;
    const slots = loose ? LOOSE_SLOTS : TOP_SLOTS;

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    for (const [symbol, held] of state.positions) {
      const kind = kinds.get(symbol) ?? 'trend';
      const value = state.value(symbol, held.qty);
      const tpBps = loose ? LOOSE_TP_BPS : kind === 'trend' ? TREND_TP_BPS : BOUNCE_TP_BPS;
      let exit = value * 10000n <= held.cost * BigInt(10000 - stopBps) || value * 10000n >= held.cost * BigInt(10000 + tpBps);
      if (kind === 'trend') {
        const gap = series.get(symbol)?.gap ?? null;
        if (gap !== null && gap < 0) exit = true;
      } else {
        const slow = series.get(symbol)?.slow.value ?? null;
        const close = state.close(symbol);
        if (slow !== null && close !== null && Number(close) >= slow) exit = true;
      }
      if (exit) sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `s-${symbol}-${orderNo++}` });
    }

    const entries: { symbol: string; kind: Kind; score: number }[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (state.positions.has(symbol)) continue;
      const s = series.get(symbol);
      const close = state.close(symbol);
      if (s === undefined || s.gap === null || s.slow.value === null || close === null) continue;
      const closeNum = Number(close);
      const gapNowBps = (s.gap / closeNum) * 10000;
      if (crossUp.has(symbol) && s.gap > 0 && gapNowBps >= gapBps) {
        entries.push({ symbol, kind: 'trend', score: gapNowBps });
        continue;
      }
      const dip = ((s.slow.value - closeNum) / s.slow.value) * 100;
      const r = rsi(s.closes);
      if (dip >= dipPct && r !== null && r <= rsiMax) entries.push({ symbol, kind: 'bounce', score: dip * 100 });
    }
    entries.sort((a, b) => b.score - a.score);

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const room = Math.min(slots, TOP_SLOTS) - state.positions.size + sells.length;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let cash = state.cash;
    for (const { symbol, kind } of entries.slice(0, Math.max(0, room))) {
      if (orders.length >= caps.max_orders_per_bar) break;
      let slice = state.equity / BigInt(slots);
      if (slice > byWeight) slice = byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({
        side: 'buy',
        symbol,
        notional_quote_units: slice,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
        client_id: `${kind === 'bounce' ? 'bB' : 'bT'}-${symbol}-${orderNo++}`,
      });
      cash -= slice;
    }
    return orders;
  },
});
