// Issue #124's journey fixture for criterion 9 (tests/acceptance/124/README.md, Criterion 9): three pages, each but
// the last with a "Next" button. Page 3 shows a "Publish" button and, in the same row, a "Promo banner" button drawn
// after it, so on top of it. With COVERED the banner sits right over Publish, 10 points wider, so Publish is drawn
// under its sibling; without it the banner sits beside Publish and covers nothing. "Hide banner" takes the banner away.
//
// The journey (ac9-journey-steps.test.ts) clicks Next at step 2 and step 3, so Publish comes up under the banner at
// step 3, and hides the banner at step 4: only the screen after step 3 has a node under a sibling. The banner is
// filled BANNER, an orange nothing else in the app draws, so a screenshot shows where it lies.
//
// The twin, ../journey-cover-twin/main.js, is this file with COVERED set to false and nothing else changed.
import { View, div, v_flex, Button } from "@deepbuild/panel";

const COVERED = false;
const BANNER = "#e8590c";

export default class JourneyCover extends View {
  init(_props, _cx) {
    this.page = 1;
    this.banner = true;
    this.published = false;
  }

  render(cx) {
    const colors = cx.theme().colors;
    const last = this.page === 3;
    return v_flex()
      .id("journey-cover")
      .size_full()
      .p(12)
      .gap(8)
      .bg(colors.background)
      .text_color(colors.foreground)
      .child(div().child(`Page ${this.page} of 3`))
      .child(
        last
          ? div()
              .id("publish-row")
              .relative()
              .w(240)
              .h(28)
              .flex_shrink_0()
              .child(
                Button.new("publish")
                  .accessibility_label("Publish")
                  .w(100)
                  .h(28)
                  .on_click((_event, cx) => {
                    this.published = true;
                    cx.notify();
                  })
                  .child("Publish"),
              )
              .child(
                this.banner
                  ? div()
                      .absolute()
                      .top(0)
                      .left(COVERED ? 0 : 120)
                      .child(
                        Button.new("banner")
                          .accessibility_label("Promo banner")
                          .w(110)
                          .h(28)
                          .bg(BANNER)
                          .text_color("#ffffff")
                          .child("Promo banner"),
                      )
                  : div(),
              )
          : Button.new("next")
              .accessibility_label("Next")
              .w(80)
              .h(28)
              .on_click((_event, cx) => {
                this.page += 1;
                cx.notify();
              })
              .child("Next"),
      )
      .child(
        last && this.banner
          ? Button.new("hide")
              .accessibility_label("Hide banner")
              .w(120)
              .h(28)
              .on_click((_event, cx) => {
                this.banner = false;
                cx.notify();
              })
              .child("Hide banner")
          : div(),
      )
      .child(div().child(this.published ? "Published" : "Not published"));
  }
}
