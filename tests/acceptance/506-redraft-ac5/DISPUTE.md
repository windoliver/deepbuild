# Dispute: criterion 5's close button in the first draft (`506/ac5-lamp-card.test.ts`, third test)

**The test as written can't pass on any build.** Its room sends the card's background in the paint role
`card` to `deep-show run`. `deep-show` checks and draws a document in its shipped look unless the document
names its own (Document envelope: `look: {asset}`), and the room names none. The shipped look holds no
`card` role, so the document check refuses the room before any key reaches it:

```
"the room is presented": {"outcome": "refused", "issues": [
  {"check": "document.validate", "code": "ref_unresolved", "path": "items/card-bg/params/paint/fill/role"},
  {"check": "document.validate", "code": "role_unresolved", "path": "items/card-bg/params/paint/fill/role: card"}]}
```

The role `card` exists only in the look the suite hands `deep-gpu` (`view3d`'s `look`), which the other two
tests of the file use and which pass.

**The redraft.** A fresh run of the blind job, given the issue, the design, the base commit and criterion 5's
clause (never this dispute, the work or the diff), wrote `ac5-close.test.ts` in this folder. It sends the
same card through the same surfaces in a role the shipped look holds (`accent`). It fails at the base
(`BASE-FAILURE.txt`) and passes on the work (one run, Nov 14 2026, Mac at the change's head).

**Ruling:** the owner said "Yes, swap it" on Nov 14, 2026. The first draft's file
(`506/ac5-lamp-card.test.ts`) moves to `byHand` in `scripts/lanes.mjs`, since lanes take whole files: its
orbit and fly-through tests, which pass, run by hand with it. This redraft covers the close-button clause in
the alone lane. Owed: the signed approval tag on that lanes commit (the owner's touch key).
