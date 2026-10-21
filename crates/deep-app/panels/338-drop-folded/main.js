// Issue #338, a planted fault: the view drops the asks a session's fold tucks away. The kit
// names a folded ask.
import { View, div } from "gpui-kit";
import { DockArea, v_flex } from "gpui-base";
import { needs_you } from "deepbuild";

class NeedsYou extends View {
  init() {
    this.inbox = needs_you();
  }

  rows() {
    return this.inbox.rows.filter((handle) => !this.inbox.folded.includes(handle));
  }

  render() {
    return v_flex()
      .size_full()
      .p(8)
      .child(div().h(32).font_semibold().child("Needs you"))
      .children(this.rows().map((handle) => div().h(18).child(handle)));
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
