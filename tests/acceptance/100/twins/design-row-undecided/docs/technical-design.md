# Technical design (a planted stand-in)

Planted wrong program for tests/acceptance/100: the Decided table has a row for ropes and cloth that asks the question
and decides nothing. Its words "build first" are in the question and in what would reopen it, never in the decision.

### Decided

| Question | Decision | Reopens if |
|---|---|---|
| Rapier's soft bodies | Used for live ropes and cloth from 0.36, which added them, behind the backend interface. | A cross-machine golden fails |
| Our own solver for ropes and cloth: build first? | Not yet. Ropes and cloth run live on Rapier's soft bodies, and the solver is written later. | We choose to build first |
