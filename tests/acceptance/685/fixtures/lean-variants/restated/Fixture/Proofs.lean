import Fixture.Total

theorem total_append (a b : List Nat) : total (a ++ b) = total (a ++ b) := rfl

theorem total_example : total [1, 2, 3] = 6 := by
  decide

theorem total_self (a : List Nat) : total a = total a := rfl
