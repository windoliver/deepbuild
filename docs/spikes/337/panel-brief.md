# Panel brief: the stocks view

This is the whole task an agent gets for issue #337. The other inputs are gpui-shell's own docs (`docs/` in the bundle) and the `gpui-kit.d.ts` the runtime generates. Write one file, `main.js`, and nothing else.

## What it runs in

The panel is a gpui-shell application: `main.js` default-exports a class extending `View` from `"gpui-kit"`. It runs under an empty policy, so it has no network, files, programs, storage or timers you didn't get from the docs. It may import `"gpui-kit"`, `"gpui-base"`, `"gpui-component"` and DeepBuild's module `"deepbuild"`.

`"deepbuild"` exports one function:

```js
import { quotes } from "deepbuild";
const q = quotes();
// q.interval_s: seconds between ticks (60)
// q.symbols: [{ symbol: "AAPL", name: "Apple", prices: [228.31, ...] }, ...] — 120 prices each
```

The quotes are a recording. The panel replays them: it starts at tick 0, and only the `next` button moves time.

## What it shows

1. **Watchlist.** One row per symbol, in the order `quotes()` gives them. Each row is clickable with the id `row-<SYMBOL>` (for example `row-NVDA`) and shows the symbol, the price at the current tick with two decimals, and the change from tick 0 in percent with two decimals and a sign, for example `+0.42%`.
2. **Chart.** The selected stock (the first symbol until a row is clicked) has a line chart of its prices from tick 0 through the current tick, and the text `Selected: <SYMBOL>`.
3. **Time.** A button with the id `next` advances one tick, stopping at the last one. The text `Tick <n>` shows the current tick.
4. **Alert.** A button with the id `alert-above` sets the selected stock's target to its current price plus 0.1%, and shows `Target <SYMBOL> <price>` with two decimals. The first time a later tick's price is at or above the target, the panel shows `Alert: <SYMBOL> crossed <target>` with two decimals, and that alert stays shown. One target per symbol; setting it again replaces it and rearms it.

Every text above is a child string of an element, so it can be found in the rendered element tree. Make each clickable a `Button` (from `"gpui-base"` or `"gpui-component"`) created with exactly its id, and give it a size and a visible style; a headless test finds the ids and clicks them where they are drawn.

## How it is checked

A headless test loads `main.js`, renders it with no display and clicks the ids above, then compares the texts with values it computes from the same recording. Nothing in the panel is mocked. If it fails, you get the failure output and may fix `main.js`; two rounds of fixes are allowed.
