// Issue #124's fixture panel (tests/acceptance/124/README.md, Fixtures): a form with one email field, labelled
// "Email" by the text drawn just before it in its own container, and a Save button (accessible name "Save") that is
// enabled once the field holds an email address. Saving shows "Saved <email>"; before that the line reads
// "Not saved". 300 points of space sit above the field and 1,200 below it, kept from shrinking in the scrolling
// column (flex_shrink_0), so the field starts 300 points down and the form scrolls.
//
// The field is filled with FIELD, a green nothing else in the app draws, so a recording's mask can be checked
// pixel by pixel against an unmasked recording of the same run. A counter redraws every 4 ms of the replica's
// clock, so a run on a real clock never draws the same frames twice, and one on the virtual clock always does.
//
// The twin, ../save-form-twin/main.js, is this file with SAVE_STAYS_DISABLED set to true and nothing else changed.
import { View, div } from "gpui-kit";
import { v_flex, Button, Input, InputState } from "gpui-base";

const SAVE_STAYS_DISABLED = false;
const FIELD = "#36d399";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default class SaveForm extends View {
  init(_props, cx) {
    this.email = InputState.new({ placeholder: "" });
    this.email.on("change", (_event, cx) => cx.notify());
    this.saved = null;
    this.ticks = 0;
    this.timer = cx.timer.every(4, (cx) => {
      this.ticks += 1;
      cx.notify();
    });
  }

  render(cx) {
    const enabled = !SAVE_STAYS_DISABLED && EMAIL.test(this.email.value());
    return v_flex()
      .id("save-form")
      .size_full()
      .overflow_y_scroll()
      .role("scroll_view")
      .p(12)
      .gap(8)
      .bg(cx.theme().colors.background)
      .text_color(cx.theme().colors.foreground)
      .child(div().child(`Ticks ${this.ticks}`))
      .child(div().h(300).flex_shrink_0())
      .child(
        v_flex()
          .gap(4)
          .child(div().child("Email"))
          .child(Input.new(this.email).w(220).h(28).px(6).bg(FIELD)),
      )
      .child(
        Button.new("save")
          .accessibility_label("Save")
          .disabled(!enabled)
          .w(80)
          .h(28)
          .rounded(4)
          .bg(enabled ? cx.theme().colors.primary : cx.theme().colors.muted)
          .text_color(cx.theme().colors.primary_foreground)
          .on_click((_event, cx) => {
            this.saved = this.email.value();
            cx.notify();
          })
          .child("Save"),
      )
      .child(div().child(this.saved === null ? "Not saved" : `Saved ${this.saved}`))
      .child(div().h(1200).flex_shrink_0());
  }
}
