// #326 AC7: gpui-shell's registered Tooltip, from a panel in the sidebar slot. Its trigger is a
// 240 x 400 point button at the center of the panel; resting the pointer there shows a tooltip
// whose long text runs to the right of the panel, into the question card's rect unless the host
// keeps it off.
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Tooltip } from "gpui-component";

const TEXT =
  "A tooltip long enough to run well past the right edge of the sidebar slot it was opened from, " +
  "across the place where the question card sits, which nothing may ever cover, even partly, " +
  "and which this fixture tries to cover with its text for as long as the pointer rests on it.";

export default class TooltipFixture extends View {
  render() {
    return v_flex()
      .size_full()
      .items_center()
      .justify_center()
      .bg("#f5f5f4")
      .child(new Tooltip("fixture-326-tooltip", "Hover here", TEXT).w(240).h(400));
  }
}
