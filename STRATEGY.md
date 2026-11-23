# Strategy — TrendHold

Long-only cbBTC (CBBTC) trend bot, one-minute bars, $1,000 paper USDC.

## Rules

- **Trend:** EMA(20) vs EMA(60) on closes, each seeded as the mean of its
  first span of closes.
- **Entry:** buy the whole cash balance (capped by `max_weight_bps` of equity)
  when the fast EMA is more than 0.1% above the slow EMA.
- **Exit:** sell the whole position when the fast EMA falls more than 0.1%
  below the slow EMA (hysteresis band, so noise does not flip the bot), or
  when the close falls 2% below the highest close since entry (trailing stop).
- **Otherwise:** hold the position, or stay in cash.

## Why

One-minute cbBTC bars move about 8 bps a minute, while a round trip costs
roughly 13–26 bps in fees, slippage and price impact, so fast signals trade
far too often and lose to fees. The kit's fast baselines confirm it on the dev
window: EMA(8/21) cross loses $114.83, RSI/Bollinger loses $9.32, ADX
momentum loses $11.20. Slow trend rules with a hysteresis band stay invested
through noise, trade only a handful of times, and keep the drawdown small.
Buy-and-hold makes the most on the rising dev window ($32.17) but has no
protection if the race window falls; the trailing stop and trend exit are
what keep this bot's losses small on a falling market.

## Dev-window grade (local, `grade-local --driver process`)

- Net PnL: **+$10.34**, 7 trades, max drawdown 2.86%, fees $3.24, 0 rejected
  orders — above the $0 dev gate with margin. Result sha256
  `08474fea56a7c0730327a406f29934ff63236f107496b9d325518dd87f22de54`
  (process driver; the server grades in its docker sandbox).
