// The #1459 suite's replacement Needs you view (AC4): one row per open ask, oldest first, each row's element keyed by its
// ask's handle and drawing its question. It draws no handle. Written in the form #338's fixture view has
// (crates/deep-app/panels/338-needs-you), the form `needs-you@1` mounts.
import { View, div, DockArea, v_flex, needs_you } from "@deepbuild/panel";

class NeedsYou extends View {
  init() {
    this.inbox = needs_you();
  }

  asks() {
    return this.inbox.asks;
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
