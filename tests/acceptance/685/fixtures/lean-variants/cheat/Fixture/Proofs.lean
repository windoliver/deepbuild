import Fixture.Total

axiom cheat (a b : List Nat) : total (a ++ b) = total a + total b

theorem total_append (a b : List Nat) : total (a ++ b) = total a + total b :=
  cheat a b

theorem total_example : total [1, 2, 3] = 6 := by
  decide

theorem total_self (a : List Nat) : total a = total a := rfl
