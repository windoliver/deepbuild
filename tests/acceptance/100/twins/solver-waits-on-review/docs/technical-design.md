# Technical design (a planted stand-in)

Planted wrong program for tests/acceptance/100: the Decided table records the decision, and the physics module below
still makes our own solver wait.

### The physics module

Ropes and cloth run live on Rapier's soft bodies. Heavier cloth bakes through asset jobs on our own solver by vertex
block descent, which is held back until a patent and licensing review clears it.

### Decided

| Question | Decision | Reopens if |
|---|---|---|
| Our own solver for ropes and cloth | Build first, with no licensing or patent review gating it. | A cross-machine golden fails |
