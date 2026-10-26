import { View, div } from "gpui-kit";
import { Button, h_flex, v_flex } from "gpui-base";
import { Canvas, CanvasScene } from "gpui-component";
import { quotes } from "deepbuild";

export default class StocksView extends View {
  init() {
    // The chart's line is the canvas's: its prices are an item of a retained scene (#380).
    this.scene = CanvasScene();
    this.recording = quotes();
    this.tick = 0;
    this.selected = this.recording.symbols[0]?.symbol ?? "";
    this.targets = Object.create(null);
    this.alert = null;
    this.plot();
  }

  /** The selected stock's prices so far, as the chart's line. */
  plot() {
    const stock = this.stock(this.selected);
    if (!stock) return;
    const prices = stock.prices.slice(0, this.tick + 1);
    this.scene.set("prices", prices.length === 1 ? [prices[0], prices[0]] : prices);
  }

  stock(symbol) {
    return this.recording.symbols.find((stock) => stock.symbol === symbol);
  }

  price(stock) {
    return stock.prices[this.tick];
  }

  advance(cx) {
    const lastTick = Math.max(
      0,
      ...this.recording.symbols.map((stock) => stock.prices.length - 1),
    );

    if (this.tick < lastTick) {
      this.tick += 1;

      for (const stock of this.recording.symbols) {
        const target = this.targets[stock.symbol];
        const price = stock.prices[this.tick];
        if (
          target?.armed &&
          this.tick > target.setAt &&
          price !== undefined &&
          price >= target.price
        ) {
          target.armed = false;
          this.alert = { symbol: stock.symbol, price: target.price };
        }
      }
    }

    this.plot();
    cx.notify();
  }

  setAlert(cx) {
    const stock = this.stock(this.selected);
    if (!stock) return;

    const targetPrice = this.price(stock) * 1.001;
    this.targets[stock.symbol] = {
      price: targetPrice,
      setAt: this.tick,
      armed: true,
    };

    if (this.alert?.symbol === stock.symbol) this.alert = null;
    cx.notify();
  }

  chart(color) {
    return div()
      .h(220)
      .w("100%")
      .rounded(8)
      .border(1)
      .border_color(color.border)
      .bg(color.surface)
      .child(new Canvas(this.scene).size_full());
  }

  watchRow(stock, color) {
    const price = this.price(stock);
    const change = ((price - stock.prices[0]) / stock.prices[0]) * 100;
    const changeText = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
    const isSelected = stock.symbol === this.selected;

    return Button.new(`row-${stock.symbol}`)
      .w("100%")
      .min_h(42)
      .px(12)
      .items_center()
      .justify_between()
      .rounded(6)
      .border(1)
      .border_color(isSelected ? color.primary : color.border)
      .bg(isSelected ? color.muted : color.surface)
      .text_color(color.foreground)
      .hover((style) => style.bg(color.muted))
      .on_click((_event, cx) => {
        this.selected = stock.symbol;
        this.plot();
        cx.notify();
      })
      .child(div().w(70).font_semibold().child(stock.symbol))
      .child(div().w(90).text_right().child(price.toFixed(2)))
      .child(
        div()
          .w(90)
          .text_right()
          .text_color(change >= 0 ? "#16803c" : color.destructive)
          .child(changeText),
      );
  }

  actionButton(id, label, color, onClick) {
    return Button.new(id)
      .h(34)
      .px(14)
      .items_center()
      .justify_center()
      .rounded(6)
      .border(1)
      .border_color(color.border)
      .bg(color.surface)
      .text_color(color.foreground)
      .hover((style) => style.bg(color.muted))
      .active((style) => style.opacity(0.75))
      .on_click(onClick)
      .child(label);
  }

  render(cx) {
    const color = cx.theme().colors;
    const selectedStock = this.stock(this.selected);
    const selectedTarget = this.targets[this.selected];

    return h_flex()
      .size_full()
      .gap(16)
      .p(16)
      .bg(color.background)
      .text_color(color.foreground)
      .child(
        v_flex()
          .w(360)
          .h("100%")
          .gap(8)
          .child(div().text_size(20).font_bold().child("Watchlist"))
          .children(this.recording.symbols.map((stock) => this.watchRow(stock, color))),
      )
      .child(
        v_flex()
          .flex_1()
          .h("100%")
          .gap(12)
          .child(div().text_size(20).font_bold().child(`Selected: ${this.selected}`))
          .when(Boolean(selectedStock), (element) =>
            element.child(this.chart(color)),
          )
          .child(
            h_flex()
              .items_center()
              .gap(10)
              .child(div().font_semibold().child(`Tick ${this.tick}`))
              .child(
                this.actionButton("next", "Next", color, (_event, cx) =>
                  this.advance(cx),
                ),
              )
              .child(
                this.actionButton("alert-above", "Alert above", color, (_event, cx) =>
                  this.setAlert(cx),
                ),
              ),
          )
          .when(Boolean(selectedTarget), (element) =>
            element.child(`Target ${this.selected} ${selectedTarget.price.toFixed(2)}`),
          )
          .when(Boolean(this.alert), (element) =>
            element.child(`Alert: ${this.alert.symbol} crossed ${this.alert.price.toFixed(2)}`),
          ),
      );
  }
}
