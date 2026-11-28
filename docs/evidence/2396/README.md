# #2396: a moving rest_on in either listing order, in the app

Pictures for PR #3084's visual check (canvas PRs: the real app, plain main against the PR head, same document and view).
Taken on the reference Mac (Mac18,1, macOS 27.2.1) on 2026-11-28, main `8748e5ca5` against PR head `fd3aaac02`, each tree
with its own hub, one registered session, `deep show` of the document and `deep open session/<id>`.

The documents are the issue's reproduction: a box table that the channel `lift` raises 0 → 0.25 m over 2 s, a sphere vase
`rest_on` the table, a slab flag apart at x = 3 (out of the camera's frame). They differ only in how the items are listed:

- `lifted-repro-order.json`: cam, table, vase, flag (the issue's order)
- `lifted-id-order.json`: cam, flag, table, vase (ID order)

| Tree | Document | `deep show` | Picture |
|---|---|---|---|
| main | repro order | refused, `no_support` | `app-main-repro-order.png`: the session page holds no canvas |
| main | ID order | presented | `app-main-id-order.png`: the vase on the table's top |
| PR | repro order | presented | `app-pr-repro-order.png`: the same picture as main's ID order |
| PR | ID order | presented | `app-pr-id-order.png`: the same picture |

The app plays a 3D layer from when its view opens and has no seek, so the window pictures show the resting state after
the lift. The core's own frames (`deep show --check --snap --size 640x480`) give exact times: `core-1s.png` and `core-2s.png`
are byte-identical across main's ID order and both of the PR's orders (sha256 `79fdaeea…` at 1 s, `95dcec85…` at 2 s), and
the table and vase rise together between them with the vase on the table's top.

Judged by the implementing session as the owner's delegation: no unexplained difference.
