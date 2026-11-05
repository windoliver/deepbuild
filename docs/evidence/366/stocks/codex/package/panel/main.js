import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

const symbols = ["NVDA", "AAPL", "MSFT"];

function sparkline(points) {
  if (!points || points.length < 2) return "Chart builds as live quotes arrive";
  const values = points.map((p) => Number(p.value ?? p.price)).filter(Number.isFinite);
  if (values.length < 2) return "Chart builds as live quotes arrive";
  const bars = "▁▂▃▄▅▆▇█";
  const low = Math.min(...values), span = Math.max(...values) - low || 1;
  return values.map((value) => bars[Math.round((value - low) / span * 7)]).join("");
}

export default class Stocks extends View {
  init(props) {
    this.props = props || {};
    this.page = this.props.page || null;
  }

  render(cx) {
    const selected = this.page && this.page.params ? this.page.params.symbol : null;
    const visible = selected ? symbols.filter((symbol) => symbol === selected) : symbols;
    const readings = this.props.readings || {};
    const history = this.props.history || {};
    return v_flex().id("stocks").size_full().p(8).gap(4)
      .bg(cx.theme().colors.background).text_color(cx.theme().colors.foreground)
      .child(div().child(selected ? `${selected} stock` : "My watchlist"))
      .children(visible.map((symbol) => {
        const source = `ext.stocks.quote_${symbol.toLowerCase()}`;
        const reading = readings[source];
        const price = reading && reading.value != null ? `${reading.unit || "USD"} ${Number(reading.value).toFixed(2)}` : "Waiting for quote";
        return v_flex().id(`stock-${symbol.toLowerCase()}`).p(4).gap(2)
          .child(h_flex().gap(4).child(div().child(symbol)).child(div().child(price)))
          .child(div().child(sparkline(history[source])));
      }))
      .child(div().child("Set an above or below target with the price alert command."));
  }
}
