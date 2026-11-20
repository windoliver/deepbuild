# Dispute: #194 criterion 11's first draft (`tests/acceptance/194/ac11-budgets.test.ts`)

The first draft's "no work per frame" part presents two films in one `deep-show run`, the one naming the fixture
catalog and the same film naming none, and requires each of their 60 frames to run as many nodes (`ran`). Frame 0
can't match on any program: the scheduler is shared by every document a run presents, and a node whose content another
document's identical item already computed is reused, not run again. Both films carry the same 2D camera item `cam`, so
whichever film is framed first runs its four nodes (`core.lower`, `core.fields`, `core.transform`, `core.world` of
`cam`) and the other reuses them. On the work, the catalog film framed first ran 9 nodes at frame 0 and the film naming
none 5; with the two presented the other way round, the film naming none ran 11 and the catalog film 6 (eval at t 0,
`nodes` filtered to `run: "ran"`). Every later frame ran 1 node in both. The rest of the first draft (what the
budgets time, the record, the timed line) passed on the work.

The blind redraft beside this file, written from the same issue, design and base commit, plays each film in a
deep-show process of its own and compares the frames after the first. It runs in the first draft's place in
`scripts/lanes.mjs` (`alone` and `timed`), with the first draft moved to `byHand`. Whether to keep the swap is the
owner's ruling; neither draft was edited.
