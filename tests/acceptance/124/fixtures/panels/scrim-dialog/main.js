// Issue #124's scrim fixture (tests/acceptance/124/README.md, Fixtures): a panel with a draft and a Save button, and a
// dialog open over them. The dialog's scrim is a transparent button named "Scrim", placed over the whole panel; a button
// because a script's plain div gets no accessibility node, and the hit test has to name it. It draws nothing over Save,
// so Save stays visible, enabled and still, and only a hit test can tell that a press at Save's box goes to the scrim.
//
// Pressing the scrim does what a dismissible dialog's scrim does: it closes the dialog and discards the draft. "Keep
// editing", the dialog's own button, closes it and keeps the draft. Both stop the event, so what lies under them never
// runs. "Scrim events <n>" counts every pointer event the scrim is sent, moves included, so a run can see that a refused
// action and a probe sent it nothing. "Ignores clicks" is a button with no handler: a click on it is delivered and
// nothing handles it.
import { View, div } from "gpui-kit";
import { v_flex, Button } from "gpui-base";

const DRAFT = "Release notes, second pass";

export default class ScrimDialog extends View {
  init(_props, _cx) {
    this.open = true;
    this.draft = DRAFT;
    this.saved = null;
    this.events = 0;
  }

  render(cx) {
    const colors = cx.theme().colors;
    const page = div()
      .id("scrim-dialog")
      .relative()
      .size_full()
      .bg(colors.background)
      .text_color(colors.foreground)
      .child(
        v_flex()
          .id("form")
          .p(12)
          .pt(160)
          .gap(8)
          .child(div().child(this.draft === null ? "Draft discarded" : `Draft: ${this.draft}`))
          .child(
            Button.new("save")
              .accessibility_label("Save")
              .w(80)
              .h(28)
              .rounded(4)
              .bg(colors.primary)
              .text_color(colors.primary_foreground)
              .on_click((_event, cx) => {
                this.saved = this.draft;
                cx.notify();
              })
              .child("Save"),
          )
          .child(
            Button.new("ignores").accessibility_label("Ignores clicks").w(120).h(28).child("Ignores clicks"),
          )
          .child(div().child(this.saved === null ? "Not saved" : `Saved ${this.saved}`))
          .child(div().child(`Scrim events ${this.events}`)),
      );
    if (!this.open) return page;
    return page
      .child(
        div()
          .id("scrim")
          .absolute()
          .inset(0)
          .on_mouse_move((_event, cx) => {
            this.events += 1;
            cx.notify();
          })
          .child(
            Button.new("scrim-surface")
              .accessibility_label("Scrim")
              .size_full()
              .bg("#00000000")
              .on_click((_event, cx) => {
                this.events += 1;
                this.open = false;
                this.draft = null;
                cx.stop_propagation();
                cx.notify();
              }),
          ),
      )
      .child(
        v_flex()
          .id("dialog")
          .absolute()
          .top(12)
          .left(12)
          .w(220)
          .h(120)
          .p(8)
          .gap(8)
          .bg(colors.muted)
          .child(div().child("Discard this draft?"))
          .child(
            Button.new("keep")
              .accessibility_label("Keep editing")
              .w(120)
              .h(28)
              .on_click((_event, cx) => {
                this.open = false;
                cx.stop_propagation();
                cx.notify();
              })
              .child("Keep editing"),
          ),
      );
  }
}
