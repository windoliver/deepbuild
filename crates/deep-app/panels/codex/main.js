// @ts-check

import { View, div } from "gpui-kit";
import { Button, h_flex, v_flex } from "gpui-base";
import { LineChart } from "gpui-component";
// The task-provided host module is intentionally not part of gpui-kit.d.ts.
// @ts-ignore
import { quotes } from "deepbuild";

/** @typedef {{ symbol: string, name: string, prices: number[] }} Stock */
/** @typedef {{ price: number, setTick: number, armed: boolean }} Target */

export default class StocksView extends View {
  init() {
    /** @type {{ interval_s: number, symbols: Stock[] }} */
    const recording = quotes();

    this.symbols = recording.symbols;
    this.tick = 0;
    this.selectedSymbol = this.symbols[0].symbol;
    /** @type {Map<string, Target>} */
    this.targets = new Map();
    /** @type {Map<string, number>} */
    this.alerts = new Map();
  }

  selectedStock() {
    return this.symbols.find((stock) => stock.symbol === this.selectedSymbol);
  }

  advance() {
    const lastTick = Math.max(0, ...this.symbols.map((stock) => stock.prices.length - 1));
    if (this.tick >= lastTick) return;

    this.tick += 1;

    for (const stock of this.symbols) {
      const target = this.targets.get(stock.symbol);
      if (
        target &&
        target.armed &&
        this.tick > target.setTick &&
        this.tick < stock.prices.length &&
        stock.prices[this.tick] >= target.price
      ) {
        target.armed = false;
        this.alerts.set(stock.symbol, target.price);
      }
    }
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    const colors = cx.theme().colors;
    const selected = this.selectedStock();
    const selectedTarget = this.targets.get(selected.symbol);
    const chartRows = selected.prices.slice(0, this.tick + 1).map((value, index) => ({
      label: String(index),
      value,
    }));

    const watchlist = v_flex()
      .w(280)
      .h_full()
      .gap(6)
      .p(12)
      .overflow_y_scroll()
      .children(
        this.symbols.map((stock) => {
          const price = stock.prices[Math.min(this.tick, stock.prices.length - 1)];
          const change = ((price - stock.prices[0]) / stock.prices[0]) * 100;

          return Button.new(`row-${stock.symbol}`)
            .w_full()
            .h(44)
            .px(12)
            .items_center()
            .justify_between()
            .rounded(6)
            .border(1)
            .border_color(
              stock.symbol === this.selectedSymbol ? colors.primary : colors.border,
            )
            .bg(stock.symbol === this.selectedSymbol ? colors.accent : colors.surface)
            .text_color(colors.foreground)
            .hover((style) => style.bg(colors.muted))
            .on_click((_event, eventCx) => {
              this.selectedSymbol = stock.symbol;
              eventCx.notify();
            })
            .child(div().w(64).font_semibold().child(stock.symbol))
            .child(div().w(80).text_right().child(price.toFixed(2)))
            .child(
              div()
                .w(72)
                .text_right()
                .child(`${change >= 0 ? "+" : ""}${change.toFixed(2)}%`),
            );
        }),
      );

    const nextButton = Button.new("next")
      .h(36)
      .px(16)
      .items_center()
      .justify_center()
      .rounded(6)
      .border(1)
      .border_color(colors.border)
      .bg(colors.surface)
      .text_color(colors.foreground)
      .hover((style) => style.bg(colors.muted))
      .on_click((_event, eventCx) => {
        this.advance();
        eventCx.notify();
      })
      .child("Next");

    const alertButton = Button.new("alert-above")
      .h(36)
      .px(16)
      .items_center()
      .justify_center()
      .rounded(6)
      .border(1)
      .border_color(colors.border)
      .bg(colors.primary)
      .text_color(colors.primary_foreground)
      .hover((style) => style.opacity(0.85))
      .on_click((_event, eventCx) => {
        const stock = this.selectedStock();
        const price = stock.prices[Math.min(this.tick, stock.prices.length - 1)];
        this.targets.set(stock.symbol, {
          price: price * 1.001,
          setTick: this.tick,
          armed: true,
        });
        this.alerts.delete(stock.symbol);
        eventCx.notify();
      })
      .child("Alert above");

    const content = v_flex()
      .flex_1()
      .h_full()
      .gap(14)
      .p(16)
      .child(
        h_flex()
          .items_center()
          .justify_between()
          .child(div().text_size(20).font_semibold().child(`Selected: ${selected.symbol}`))
          .child(div().child(`Tick ${this.tick}`)),
      )
      .child(
        LineChart.new(() => chartRows)
          .w_full()
          .h(280)
          .grid(true)
          .x_axis(true)
          .linear(),
      )
      .child(h_flex().gap(10).child(nextButton).child(alertButton))
      .when(Boolean(selectedTarget), (element) =>
        element.child(`Target ${selected.symbol} ${selectedTarget.price.toFixed(2)}`),
      )
      .children(
        [...this.alerts].map(
          ([symbol, price]) => `Alert: ${symbol} crossed ${price.toFixed(2)}`,
        ),
      );

    return h_flex()
      .size_full()
      .bg(colors.background)
      .text_color(colors.foreground)
      .child(watchlist)
      .child(content);
  }
}
