# tiny-bot-sol-redevv

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/Diest34/tiny-bot-sol-redevv/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/Diest34/tiny-bot-sol-redevv/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny paper-trading bot for hourly Solana prices: it rides confirmed EMA(5)/EMA(12) uptrends, buys sharp dips when RSI(14) is oversold, and sits in USDC the rest of the time. Two engines, one portfolio — long only, no leverage, no shorts, no network. On the dev window it nets +$64.63 over 29 trades (buy-and-hold: −$869.34), with a 3.9% maximum drawdown.

## Run it

```sh
node main.ts
```

`main.ts` speaks the `agent-fun/bars-replay/v1` line protocol on stdin/stdout (see `vendor/makefun-bars.ts`); the harness feeds it hourly bars and it answers with orders, one reply per bar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=y12bs3e6&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
