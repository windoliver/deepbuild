// Issue #124's device fixture for the Scope line's other two findings (tests/acceptance/124/README.md, Criterion 9):
// a panel that ignores a device's system bar and on-screen keyboard. "Account" sits 4 points from the panel's top, so
// a 24-point system bar over the window's top edge covers it. A "Message" field (labelled by the text drawn before it)
// sits mid-panel, and "Send" is pinned 12 points above the panel's bottom, so the on-screen keyboard that rises when
// the field takes focus covers Send and not the field.
//
// The twin, ../device-insets-twin/main.js, is this file with SAFE set to true and nothing else changed: Account 48
// points down and Send just under the field, clear of the bar and of a 300-point keyboard.
import { View, div } from "gpui-kit";
import { v_flex, Button, Input, InputState } from "gpui-base";

const SAFE = false;

export default class DeviceInsets extends View {
  init(_props, _cx) {
    this.message = InputState.new({ placeholder: "" });
    this.message.on("change", (_event, cx) => cx.notify());
    this.sent = false;
  }

  render(cx) {
    const colors = cx.theme().colors;
    const top = SAFE ? 48 : 4;
    const send = Button.new("send")
      .accessibility_label("Send")
      .w(80)
      .h(28)
      .on_click((_event, cx) => {
        this.sent = true;
        cx.notify();
      })
      .child("Send");
    return div()
      .id("device-insets")
      .relative()
      .size_full()
      .bg(colors.background)
      .text_color(colors.foreground)
      .child(
        div()
          .absolute()
          .top(top)
          .left(12)
          .child(Button.new("account").accessibility_label("Account").w(100).h(28).child("Account")),
      )
      .child(
        v_flex()
          .absolute()
          .top(top + 80)
          .left(12)
          .gap(8)
          .child(div().child("Compose a message"))
          .child(
            v_flex()
              .gap(4)
              .child(div().child("Message"))
              .child(Input.new(this.message).w(220).h(28).px(6)),
          )
          .child(div().child(this.sent ? "Sent" : "Not sent")),
      )
      .child(SAFE ? div().absolute().top(top + 200).left(12).child(send) : div().absolute().bottom(12).left(12).child(send));
  }
}
