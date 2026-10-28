// #326 AC7: gpui-shell's registered Notification, from a panel in the sidebar slot. Its trigger is
// a 240 x 400 point button at the center of the panel; a click there pushes a notification that
// stays up, which the window draws in its top-right corner, inside the question card's rect
// unless the host keeps it off.
import { View } from "gpui-kit";
import { v_flex } from "gpui-base";
import { Notification } from "gpui-component";

export default class NotificationFixture extends View {
  render() {
    return v_flex()
      .size_full()
      .items_center()
      .justify_center()
      .bg("#f5f5f4")
      .child(
        new Notification("fixture-326-notification", "Notify", () => {})
          .title("Fixture notification")
          .message("A notification a panel pushed, drawn where the question card sits.")
          .type("error")
          .autohide(false)
          .w(240)
          .h(400),
      );
  }
}
