// #326 AC7: gpui-shell's registered DropdownMenu, from a panel in the sidebar slot. Its trigger is
// a 240 x 400 point button at the center of the panel; a click there opens a menu whose items are
// long enough to run to the right of the panel, into the question card's rect unless the host
// keeps it off.
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { DropdownMenu } from "gpui-component";

const LONG = "an item long enough to run well past the sidebar slot it opened from, over the card";

export default class DropdownFixture extends View {
  render() {
    let menu = new DropdownMenu("fixture-326-dropdown", "Open menu").w(240).h(400);
    for (let index = 0; index < 24; index += 1) menu = menu.item(`${index + 1}: ${LONG}`, () => {});
    return v_flex().size_full().items_center().justify_center().bg("#f5f5f4").child(menu);
  }
}
