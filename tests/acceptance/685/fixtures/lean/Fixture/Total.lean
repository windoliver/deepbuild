/-- The total of a list of readings. -/
def total : List Nat → Nat
  | [] => 0
  | x :: xs => x + total xs
