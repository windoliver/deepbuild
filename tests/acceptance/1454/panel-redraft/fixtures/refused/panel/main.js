// `panel@1` refuses this panel: it imports Dialog, which draws outside its parent, where it could cover the question
// card (crates/deep-replica/src/kit.rs, OVERLAYS). Everything else here is a good panel, so mounted anyway it loads and
// draws its one line.
//
// Dialog comes from "gpui-component", gpui-shell's component catalog. "gpui-base" has no such export, so a script that
// imports it from there never links: it draws nothing, whoever mounts it (README: What a refused panel may import).
// The constructor's three arguments and the one content slot are what the catalog's Dialog requires to materialize.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Dialog } from "gpui-component";

export default class Refused extends View {
  render() {
    return v_flex()
      .id("refused")
      .size_full()
      .p(8)
      .gap(8)
      .bg("#fef3c7")
      .child(div().text_color("#7c2d12").child("Refused overlay panel"))
      .child(
        new Dialog("refused-dialog", "Open", () => {})
          .title("Overlay")
          .content(div().w(1400).h(900).bg("#ff00ff")),
      );
  }
}
