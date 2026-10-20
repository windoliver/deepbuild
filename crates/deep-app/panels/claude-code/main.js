import { View, div } from "gpui-kit";
import { v_flex, h_flex, Button } from "gpui-base";
import { quotes } from "deepbuild";

export default class Stocks extends View {
  init() {
    const q = quotes();
    this.symbols = q.symbols;
    this.lastTick = this.symbols[0].prices.length - 1;
    this.tick = 0;
    this.selected = this.symbols[0].symbol;
    this.targets = {};
    this.alerts = {};
  }

  symbolAt(symbol) {
    return this.symbols.find((s) => s.symbol === symbol);
  }

  advanceAlerts() {
    for (const s of this.symbols) {
      const target = this.targets[s.symbol];
      if (target === undefined) continue;
      if (this.alerts[s.symbol] !== undefined) continue;
      const price = s.prices[this.tick];
      if (price >= target) {
        this.alerts[s.symbol] = target;
      }
    }
  }

  formatPct(current, base) {
    const pct = ((current - base) / base) * 100;
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(2)}%`;
  }

  row(s, cx) {
    const price = s.prices[this.tick];
    const base = s.prices[0];
    return Button.new(`row-${s.symbol}`)
      .h(28)
      .px(10)
      .items_center()
      .justify_center()
      .border(1)
      .border_color(cx.theme().colors.border)
      .bg(cx.theme().colors.surface)
      .text_color(cx.theme().colors.foreground)
      .on_click((_event, cx) => {
        this.selected = s.symbol;
        cx.notify();
      })
      .child(s.symbol)
      .child(price.toFixed(2))
      .child(this.formatPct(price, base));
  }

  chart(s, cx) {
    const prices = s.prices.slice(0, this.tick + 1);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const span = max - min || 1;
    return v_flex()
      .gap(2)
      .child(`Selected: ${s.symbol}`)
      .child(
        h_flex()
          .gap(1)
          .items_end()
          .h(80)
          .children(
            prices.map((p) =>
              div()
                .w(2)
                .h(Math.max(1, Math.round(((p - min) / span) * 80)))
                .bg(cx.theme().colors.foreground),
            ),
          ),
      );
  }

  render(cx) {
    this.advanceAlerts();
    const sel = this.symbolAt(this.selected);
    const target = this.targets[sel.symbol];
    const alert = this.alerts[sel.symbol];

    return v_flex()
      .size_full()
      .gap(8)
      .p(10)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(
        v_flex()
          .gap(4)
          .children(this.symbols.map((s) => this.row(s, cx))),
      )
      .child(this.chart(sel, cx))
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            Button.new("next")
              .h(28)
              .px(12)
              .items_center()
              .justify_center()
              .border(1)
              .border_color(cx.theme().colors.border)
              .bg(cx.theme().colors.surface)
              .text_color(cx.theme().colors.foreground)
              .on_click((_event, cx) => {
                if (this.tick < this.lastTick) {
                  this.tick += 1;
                  cx.notify();
                }
              })
              .child("next"),
          )
          .child(`Tick ${this.tick}`),
      )
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(
            Button.new("alert-above")
              .h(28)
              .px(12)
              .items_center()
              .justify_center()
              .border(1)
              .border_color(cx.theme().colors.border)
              .bg(cx.theme().colors.surface)
              .text_color(cx.theme().colors.foreground)
              .on_click((_event, cx) => {
                const current = sel.prices[this.tick];
                const t = current * 1.001;
                this.targets[sel.symbol] = t;
                delete this.alerts[sel.symbol];
                cx.notify();
              })
              .child("alert-above"),
          )
          .when(target !== undefined, (el) =>
            el.child(`Target ${sel.symbol} ${target.toFixed(2)}`),
          )
          .when(alert !== undefined, (el) =>
            el.child(`Alert: ${sel.symbol} crossed ${alert.toFixed(2)}`),
          ),
      );
  }
}
