# Pictures for #2371: the inputs past #522 and the forces a channel or an input sets

`stills.png` is each film's last frame (2 s); `films.apng` is the six films, 2 s at 30 fps. `shoot.mjs` draws them and
`check.json` is what its check read. Each film poses flat marks from `deep-physics`'s own bake of the acceptance
suite's worlds (`tests/acceptance/2371/README.md`: The worlds), one frame every 4 steps, drawn by `deep-gpu run`'s
`view3d`. A film "from above" puts world x across and world z down. The grey disc is a blast's radius.

| Film | What it shows |
|---|---|
| activate, set, deactivate: from the front | `sleeper` (sand, left) stays until its `activate` at step 70, then falls out of view; `faller` (sand) falls and stops at its `deactivate` at step 90; `puck` (teal) rests until the `set` at step 80, then runs right |
| set and blast (radius 1 m): from above | `chip` (sand), 0.9 m from the blast, leaves the disc's edge after step 100; `puck` runs right |
| blast, radius 1 m | `near` (teal, 0.9 m) moves; `far` (sand, 1.1 m) never does |
| blast, radius 1.2 m | both move |
| poke: by address, at the point, at the centre | the two sand crates, poked by `address: "crate#rim"` and at `point: [0.25, 0, 0]`, rise and turn alike; the teal one, poked at its centre, rises and doesn't turn |
| medium, point and strength: from above | `leaf` (sand) is carried by the wind's keys at steps 33 and 153; `bob` (teal) follows its spring's point at steps 45 and 165; `puck` (sand) takes the sets at steps 40 and 190 |

## What the check read

Every frame's pixels, each body's middle against its bake at that frame's step: the most any body is off is 0.88 px
(of 907 body-frames; a frame counts while the whole body is in view). Off the frames alone:

- radius 1 m: the bead 1.1 m away is the same pixels in all 61 frames, and the bead 0.9 m away moves 28.7 px (0.19 m)
- radius 1.2 m: the bead 1.1 m away moves 28.7 px
- the crate poked by address and the crate poked at the point have the same middle in every frame, 0 px apart; the
  crate poked at its centre covers other pixels
- the deactivated body is the same pixels from frame 23 (step 92) on

## What these don't show

The marks are posed from `deep-physics`'s bake; `view3d` doesn't step these worlds itself here. The pictures show
that bodies move where the bake says and when the track says. They don't judge a blast's size or direction, a
`falloff`, or `impulse_per_length`, which no criterion states. No criterion of #2371 is a taste call.

```sh
cargo build --locked --bin deep-gpu --bin deep-physics
node docs/evidence/2371/shoot.mjs    # exits 1 when a frame is off its bake or a claim doesn't read
```
