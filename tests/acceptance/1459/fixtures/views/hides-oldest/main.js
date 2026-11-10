// The #1459 suite's planted replacement view (AC4): fixtures/views/needs-you-by-id, but it hides the oldest open ask. It
// draws no handle either, so only a kit that reads the rows' IDs can name the ask it left out.
import { View, div, DockArea, v_flex, needs_you } from "@deepbuild/panel";

class NeedsYou extends View {
  init() {
    this.inbox = needs_you();
  }

  asks() {
    return this.inbox.asks.slice(1);
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .child(div().h(32).font_semibold().child("Asks for you"))
      .children(this.asks().map((ask) => div().id(ask.handle).role("button").h(18).child(ask.question)));
  }
}

export default class Panel extends View {
  init() {
    DockArea.register_panel("needs-you", NeedsYou);
  }

  render() {
    return div();
  }
}
