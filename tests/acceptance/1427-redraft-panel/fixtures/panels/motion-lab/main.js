import { View, div, Button } from "@deepbuild/panel";

const LEFT = 10;
const JUMP_TO = 190;
const TARGET = 100;
const OVERSHOOT_PATH = [20, 30, 40, 50, 60, 70, 80, 90, 100, 145, 190, 145, 120, 100];
const FLICKER_3 = [0.52, 0.54, 0.56, 0.54, 0.52, 0.5, 0.52, 0.54, 0.56, 0.54, 0.52, 0.5];
const FLICKER_2 = [0.52, 0.54, 0.56, 0.54, 0.52, 0.5, 0.52, 0.54, 0.56];
const RAMP = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

const BUTTONS = [
  "Pop in", "Fade in", "Jump",
  "Fly", "Overshoot", "Spring",
  "Flicker 3", "Flicker 2", "Drift long",
  "Drift short", "Insert above", "Insert below",
];

export default class MotionLab extends View {
  init(_props, _cx) {
    this.pop = false;
    this.fade = null;
    this.jumpLeft = LEFT;
    this.flyLeft = LEFT;
    this.overLeft = LEFT;
    this.springLeft = LEFT;
    this.badge = 0.5;
    this.drift = LEFT;
    this.lines = [
      { id: "line-a", text: "Line A", opacity: 1 },
      { id: "line-b", text: "Line B", opacity: 1 },
      { id: "line-c", text: "Line C", opacity: 1 },
    ];
  }

  play(cx, ms, frames, apply) {
    let i = 0;
    const task = cx.timer.every(ms, (cx) => {
      if (i >= frames.length) {
        task.cancel();
        return;
      }
      apply(frames[i++]);
      cx.notify();
    });
  }

  drifts(cx, ticks) {
    this.play(cx, 24, Array.from({ length: ticks }, (_, i) => LEFT + 0.5 * (i + 1)), (left) => {
      this.drift = left;
    });
  }

  stream(cx, index) {
    const line = { id: "line-new", text: "Streaming", opacity: 0.1 };
    this.lines.splice(index, 0, line);
    cx.notify();
    this.play(cx, 24, RAMP, (opacity) => {
      line.opacity = opacity;
      line.text = `${line.text}.`;
    });
  }

  press(name, cx) {
    switch (name) {
      case "Pop in":
        this.pop = true;
        break;
      case "Fade in":
        this.play(cx, 24, RAMP, (opacity) => {
          this.fade = opacity;
        });
        break;
      case "Jump":
        this.jumpLeft = JUMP_TO;
        break;
      case "Fly":
        this.flyLeft = JUMP_TO;
        break;
      case "Overshoot":
        this.play(cx, 24, OVERSHOOT_PATH, (left) => {
          this.overLeft = left;
        });
        break;
      case "Spring":
        this.springLeft = TARGET;
        break;
      case "Flicker 3":
        this.play(cx, 8, FLICKER_3, (opacity) => {
          this.badge = opacity;
        });
        break;
      case "Flicker 2":
        this.play(cx, 8, FLICKER_2, (opacity) => {
          this.badge = opacity;
        });
        break;
      case "Drift long":
        this.drifts(cx, 150);
        break;
      case "Drift short":
        this.drifts(cx, 30);
        break;
      case "Insert above":
        this.stream(cx, 1);
        break;
      case "Insert below":
        this.stream(cx, 2);
        break;
      default:
        break;
    }
    cx.notify();
  }

  lane(id, top, left, opacity) {
    return div()
      .id(id)
      .absolute()
      .top(top)
      .left(left)
      .w(60)
      .h(20)
      .opacity(opacity)
      .child(id);
  }

  render(cx) {
    const colors = cx.theme().colors;
    let page = div()
      .id("motion-lab")
      .relative()
      .size_full()
      .bg(colors.background)
      .text_color(colors.foreground);
    BUTTONS.forEach((name, i) => {
      page = page.child(
        Button.new(`press-${i}`)
          .accessibility_label(name)
          .absolute()
          .top(8 + Math.floor(i / 3) * 28)
          .left(8 + (i % 3) * 84)
          .w(80)
          .h(24)
          .rounded(4)
          .bg(colors.primary)
          .text_color(colors.primary_foreground)
          .on_click((_event, cx) => this.press(name, cx))
          .child(name),
      );
    });
    if (this.pop) page = page.child(this.lane("pop-row", 130, LEFT, 1));
    if (this.fade !== null) page = page.child(this.lane("fade-row", 160, LEFT, this.fade));
    page = page.child(this.lane("jumper", 190, this.jumpLeft, 1));
    page = page.child(this.lane("flyer", 220, this.flyLeft, 1).transition("left", { duration: 400, easing: "ease-in-out" }));
    page = page.child(this.lane("overshooter", 250, this.overLeft, 1));
    page = page.child(
      this.lane("springer", 280, this.springLeft, 1).spring("left", { response: 400, damping: 0.25 }),
    );
    page = page.child(this.lane("badge", 310, LEFT, this.badge));
    page = page.child(this.lane("drifter", 340, this.drift, 1));
    this.lines.forEach((line, i) => {
      page = page.child(
        div()
          .id(line.id)
          .absolute()
          .top(380 + i * 20)
          .left(LEFT)
          .w(200)
          .h(20)
          .opacity(line.opacity)
          .child(line.text),
      );
    });
    return page;
  }
}
