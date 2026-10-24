import Fixture.Total

theorem total_append (a b : List Nat) : total (a ++ b) = total a + total b := by
  induction a with
  | nil => simp [total]
  | cons x xs ih => simp [total, ih, Nat.add_assoc]

theorem total_example : total [1, 2, 3] = 6 := by
  decide

theorem total_self (a : List Nat) : total a = total a := rfl
