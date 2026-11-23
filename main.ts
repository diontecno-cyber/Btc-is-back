// TrendHold — a long-only cbBTC trend bot for make.fun btc-race-24h-20261123-0511.
//
// Idea: 1-minute bars are mostly noise (about 8 bps of jitter a minute, while a
// full round trip costs roughly 13-26 bps), so fast signals whipsaw and bleed
// fees. This bot only trades slow, sustained trends and otherwise sits in cash:
//
//   - Trend: EMA(20) vs EMA(60) on closes, each seeded as the mean of its first
//     span of closes, then moving 2 / (span + 1) of the way to each new close.
//   - Hysteresis: enter only when the fast EMA is more than 0.1% above the slow
//     one, exit only when it is more than 0.1% below it. The band keeps the bot
//     from flipping on every small cross.
//   - Trailing stop: once in, exit if the close falls 2% below the highest
//     close since entry. This caps the loss if a trend turns into a rout.
//   - Size: the whole cash balance on entry (capped by caps.max_weight_bps of
//     equity), the whole position on exit. One symbol (CBBTC), long only.
//
// Everything is deterministic float64 arithmetic on the bars themselves: no
// clock, no randomness, no network, no files outside the repository. The same
// bars give the same orders on every run.
//
// Chosen from offline backtests on the kit's dev window (and on an inverted,
// falling copy of it and block-bootstrapped copies): fast EMA crosses lose
// heavily to fees on this window, buy-and-hold makes the most on the rising
// dev window but loses the most if the race window falls, while this slow
// trend rule stays profitable on the dev window with far smaller losses on
// falling windows. The dev gate only needs net PnL above $0; this rule clears
// it with margin while keeping the drawdown small.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_BARS = 20;
const SLOW_BARS = 60;
/** Hysteresis band: 0.1% either side of the slow EMA. */
const BAND_BPS = 10;
/** Trailing stop: 2% below the highest close since entry. */
const TRAIL_BPS = 200;
const MAX_SLIPPAGE_BPS = 100;

const SYMBOL = 'CBBTC';

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

const fast: Ema = { span: FAST_BARS, warm: [], value: null };
const slow: Ema = { span: SLOW_BARS, warm: [], value: null };
/** Highest close since the current entry, in raw price units; null while flat. */
let peak: number | null = null;

function step(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
}

function push(bar: Bar): void {
  const c = Number(bar.c);
  step(fast, c);
  step(slow, c);
}

/** Whether the trend is up (enter) or down (exit) at the hysteresis band. */
function trend(): 'up' | 'down' | null {
  if (fast.value === null || slow.value === null) return null;
  if (fast.value > slow.value * (1 + BAND_BPS / 10_000)) return 'up';
  if (fast.value < slow.value * (1 - BAND_BPS / 10_000)) return 'down';
  return null;
}

await runBars({
  onBatch(state, batch) {
    for (const bar of batch.bars) if (bar.symbol === SYMBOL) push(bar);
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const held = state.positions.get(SYMBOL);
    const close = state.close(SYMBOL);
    if (close === null) return [];

    if (held !== undefined) {
      const c = Number(close);
      if (peak === null || c > peak) peak = c;
      const stopped = c * 10_000 < peak * (10_000 - TRAIL_BPS);
      if (trend() === 'down' || stopped) {
        peak = null;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    if (trend() !== 'up') return [];
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let slice = state.cash < byWeight ? state.cash : byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    peak = Number(close);
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
