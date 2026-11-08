// A button whose one line runs past the panel's slot, so the slot's clip cuts it and GPUI paints only its first glyphs.
import { View, v_flex, Button } from "@deepbuild/panel";

const LINE = "feature/PLAT-48213-".repeat(12);

export default class CutLine extends View {
  render(cx) {
    return v_flex()
      .id("cut-line")
      .size_full()
      .p(12)
      .child(Button.new("cut").accessibility_label(LINE).w(120).h(28).child(LINE));
  }
}
