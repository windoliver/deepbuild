// The #1459 suite's panel for AC5. Any panel may call deepbuild.needs_you(); this one draws what the call gives it each
// time it draws: how many open asks, and each ask's question. When the call fails it says what the call said, so the
// failure shows on the window.
import { View, div, v_flex, needs_you } from "@deepbuild/panel";

export default class Panel extends View {
  render() {
    let inbox;
    try {
      inbox = needs_you();
    } catch (error) {
      return div().size_full().p(8).child(`Panel got no asks: ${String(error)}`);
    }
    const asks = inbox.asks || [];
    return v_flex()
      .size_full()
      .p(8)
      .child(div().child(`Panel reads ${inbox.rows.length} open asks`))
      .children(asks.map((ask) => div().child(ask.question)));
  }
}
