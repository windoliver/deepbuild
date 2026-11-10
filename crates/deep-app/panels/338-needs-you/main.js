// Issue #338, the fixture panel: a Needs you view written against the registry, one row per
// open ask in the inbox projection's order. The kit `needs-you@1` passes it. Each row is keyed
// by its ask's handle and draws its question, never the handle (#1459).
import { View, div, DockArea, v_flex, needs_you } from "@deepbuild/panel";

class NeedsYou extends View {
  init() {
    this.inbox = needs_you();
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .child(div().h(32).font_semibold().child("Needs you"))
      .children(this.inbox.asks.map((ask) => div().id(ask.handle).h(18).child(ask.question)));
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
