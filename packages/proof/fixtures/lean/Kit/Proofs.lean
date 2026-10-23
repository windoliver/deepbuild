import Kit.Code

namespace Kit

theorem twice_eq (n : Nat) : twice n = 2 * n := by
  unfold twice
  omega

theorem twice_sorry (n : Nat) : twice n = 2 * n := by
  sorry

end Kit
