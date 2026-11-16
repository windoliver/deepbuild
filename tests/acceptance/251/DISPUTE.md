# Disputes on this suite (design: Dogfooding)

Two first-draft tests fail on the work for reasons outside the criteria they cover. Each went to a fresh run of the
blind job, with the issue, the design, the base commit and the criterion, never the work, the diff or the dispute.
Both redrafts pass on the work, so per the design each dispute comes to you once, with both drafts and the failing
output. The first-draft files are unchanged.

## Criterion 2 (`#251.acf8ab9a`): the planted brake's stop

- **First draft:** `ac2-drive-and-brake.test.ts`, test "(twin: brake_whole_force_each_wheel)". It requires the planted
  brake to stop the car in 3.125 m within 5% (2.97 m to 3.28 m).
- **Failing output:** `AssertionError: the planted brake stops it in 3.36727 m, the issue's 3.125 m within 5%`. The
  twin is caught: the brake judge fails on it, naming `kart`.
- **Why it can't pass:** 3.125 m is m·v² ÷ 2F for a rigid car with 16,000 N on four wheels. The issue's car rides on
  2 Hz springs with damping ratio 0.3, with its centre of mass 0.69 m up. At 16 m/s² the load transfer overshoots the
  rear wheels' static load, and both rear rays leave the ground for 7 steps (read from `vehicles.kart[k].wheels`), so
  they brake for none of them. A brake that acts on wheels off the ground would break the design ("resists each
  touching braking wheel's rolling").
- **Redraft:** `tests/acceptance/251-redraft-ac2/` (blind, 4 tests). It takes 10% for the twin's 3.125 m and 2 cm for
  "never rolls backwards". It passes 4/4 on the work.
- **Ask:** swap the first draft's criterion-2 tests for the redraft's.

## Criterion 6 (`#251.2e102906`): "a ninth wheel"

- **First draft:** `ac6-refusals.test.ts`, tests "the car is admitted; in a 2D world, with a follow channel or with a
  ninth wheel it is refused at check, naming the field" and "(twin: check_counts_wheels_only)".
- **Failing output:** `the vehicle body with a ninth wheel isn't refused naming the body and the field
  bodies/kart/vehicle/wheels: []`, and the twin test's `the planted check still refuses the ninth wheel, which it
  counts`.
- **Why it can't pass:** its "ninth wheel" variant is `vehicleField({mid: …})`, the four wheels plus one: five
  wheels, which the issue allows ("on up to 8 wheels"). No right program refuses it.
- **Redraft:** `tests/acceptance/251-redraft-ac6/` (blind, 2 tests), with an eight-wheeled kart admitted and a ninth
  wheel added to it refused. It passes 2/2 on the work. The first draft's two other ac6 tests (caps, public items)
  pass and stay.
- **Ask:** swap those two first-draft ac6 tests for the redraft's.
