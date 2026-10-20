import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { quotes } from "deepbuild";

export default class Stocks extends View {
  init() {
    const q = quotes();
    this.symbols = q.symbols;
    this.tick = 0;
    this.maxTick = this.symbols[0].prices.length - 1;
    this.selected = this.symbols[0].symbol;
    this.targets = {};
    this.alerts = {};
  }

  stockBy(sym) {
    return this.symbols.find((s) => s.symbol === sym);
  }

  checkAlerts() {
    for (const s of this.symbols) {
      const t = this.targets[s.symbol];
      if (!t) continue;
      if (this.alerts[s.symbol] !== undefined) continue;
      for (let i = t.setTick + 1; i <= this.tick; i++) {
        if (s.prices[i] >= t.price) {
          this.alerts[s.symbol] = t.price;
          break;
        }
      }
    }
  }

  render(cx) {
    const theme = cx.theme();
    const selStock = this.stockBy(this.selected);

    const rows = this.symbols.map((s) => {
      const p0 = s.prices[0];
      const p = s.prices[this.tick];
      const pct = ((p - p0) / p0) * 100;
      const sign = pct >= 0 ? "+" : "";
      return Button.new(`row-${s.symbol}`)
        .h(28)
        .px(10)
        .bg(theme.colors.surface)
        .text_color(theme.colors.foreground)
        .border(1)
        .border_color(theme.colors.border)
        .rounded(4)
        .on_click((_e, cx) => {
          this.selected = s.symbol;
          cx.notify();
        })
        .child(s.symbol)
        .child(" ")
        .child(p.toFixed(2))
        .child(" ")
        .child(`${sign}${pct.toFixed(2)}%`);
    });

    const target = this.targets[this.selected];

    const alertRows = this.symbols
      .filter((s) => this.alerts[s.symbol] !== undefined)
      .map((s) =>
        div()
          .text_color(theme.colors.foreground)
          .child(`Alert: ${s.symbol} crossed ${this.alerts[s.symbol].toFixed(2)}`),
      );

    return v_flex()
      .size_full()
      .gap(6)
      .p(10)
      .bg(theme.colors.background)
      .child(v_flex().gap(4).children(rows))
      .child(
        div().text_color(theme.colors.foreground).child(`Selected: ${this.selected}`),
      )
      .child(
        h_flex()
          .gap(2)
          .children(
            selStock.prices
              .slice(0, this.tick + 1)
              .map((_v, i) =>
                div()
                  .w(2)
                  .h(2)
                  .bg(theme.colors.primary),
              ),
          ),
      )
      .child(div().text_color(theme.colors.foreground).child(`Tick ${this.tick}`))
      .child(
        Button.new("next")
          .h(28)
          .px(10)
          .bg(theme.colors.primary)
          .text_color(theme.colors.primary_foreground)
          .border(1)
          .border_color(theme.colors.border)
          .rounded(4)
          .on_click((_e, cx) => {
            if (this.tick < this.maxTick) {
              this.tick += 1;
              this.checkAlerts();
            }
            cx.notify();
          })
          .child("Next"),
      )
      .child(
        Button.new("alert-above")
          .h(28)
          .px(10)
          .bg(theme.colors.primary)
          .text_color(theme.colors.primary_foreground)
          .border(1)
          .border_color(theme.colors.border)
          .rounded(4)
          .on_click((_e, cx) => {
            const p = this.stockBy(this.selected).prices[this.tick];
            const t = p * 1.001;
            this.targets[this.selected] = { price: t, setTick: this.tick };
            delete this.alerts[this.selected];
            cx.notify();
          })
          .child("Alert above"),
      )
      .when(target !== undefined, (el) =>
        el.child(
          div()
            .text_color(theme.colors.foreground)
            .child(`Target ${this.selected} ${target.price.toFixed(2)}`),
        ),
      )
      .child(v_flex().gap(2).children(alertRows));
  }
}
