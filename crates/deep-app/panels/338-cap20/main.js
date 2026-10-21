// Issue #338, a planted fault: the view caps the list at 20 rows. The kit names the 21st.
import { View, div } from "gpui-kit";
import { DockArea, v_flex } from "gpui-base";
import { needs_you } from "deepbuild";

class NeedsYou extends View {
  init() {
    this.inbox = needs_you();
  }

  rows() {
    return this.inbox.rows.slice(0, 20);
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
