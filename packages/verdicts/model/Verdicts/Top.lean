import Verdicts.Model
/-!
# Lemmas: `top` is the highest by precedence; the reading of the records depends only on which are present
-/
namespace Verdicts

theorem rank_inj {a b : Result} (h : rank a = rank b) : a = b := by
  cases a <;> cases b <;> simp_all [rank]

theorem rank_eq_zero {a : Result} (h : rank a ≤ 0) : a = .PASS := by
  cases a <;> simp_all [rank]

theorem max_spec (a b : Result) :
    rank a ≤ rank (a.max b) ∧ rank b ≤ rank (a.max b) ∧ (a.max b = a ∨ a.max b = b) := by
  unfold Result.max
  split
  · exact ⟨by omega, Nat.le_refl _, Or.inr rfl⟩
  · exact ⟨Nat.le_refl _, by omega, Or.inl rfl⟩

theorem foldl_max_spec (a : Result) (l : List Result) :
    rank a ≤ rank (l.foldl Result.max a) ∧ (∀ r ∈ l, rank r ≤ rank (l.foldl Result.max a))
      ∧ (l.foldl Result.max a = a ∨ l.foldl Result.max a ∈ l) := by
  induction l generalizing a with
  | nil => simp
  | cons x l ih =>
    simp only [List.foldl]
    obtain ⟨h1, h2, h3⟩ := ih (a.max x)
    obtain ⟨m1, m2, m3⟩ := max_spec a x
    refine ⟨Nat.le_trans m1 h1, ?_, ?_⟩
    · intro r hr
      cases hr with
      | head => exact Nat.le_trans m2 h1
      | tail _ hr => exact h2 r hr
    · rcases h3 with h3 | h3
      · rw [h3]; rcases m3 with m3 | m3
        · exact Or.inl m3
        · rw [m3]; exact Or.inr (List.mem_cons_self ..)
      · exact Or.inr (List.mem_cons_of_mem _ h3)

theorem le_top {r : Result} {l : List Result} (h : r ∈ l) : rank r ≤ rank (top l) :=
  (foldl_max_spec .PASS l).2.1 r h

theorem top_mem (l : List Result) : top l = .PASS ∨ top l ∈ l :=
  (foldl_max_spec .PASS l).2.2

theorem top_le {l : List Result} {n : Nat} (h : ∀ r ∈ l, rank r ≤ n) : rank (top l) ≤ n := by
  rcases top_mem l with e | e
  · rw [e]; exact Nat.zero_le _
  · exact h _ e

/-- `top l` is the one result that is PASS or in `l` and ranks at least every result in `l`. -/
theorem top_eq {l : List Result} {t : Result} (h1 : ∀ r ∈ l, rank r ≤ rank t) (h2 : t = .PASS ∨ t ∈ l) :
    top l = t := by
  apply rank_inj
  apply Nat.le_antisymm (top_le h1)
  rcases h2 with h2 | h2
  · rw [h2]; exact Nat.zero_le _
  · exact le_top h2

theorem top_eq_pass {l : List Result} (h : top l = .PASS) : ∀ r ∈ l, r = .PASS := by
  intro r hr
  have := le_top hr
  rw [h] at this
  exact rank_eq_zero this

-- ---- dedup and the reading of the records

theorem mem_dedup {α} [DecidableEq α] {x : α} {l : List α} : x ∈ dedup l ↔ x ∈ l := by
  induction l with
  | nil => simp [dedup]
  | cons a l ih =>
    unfold dedup
    split
    · rw [ih]; constructor
      · exact List.mem_cons_of_mem _
      · intro h; cases h with
        | head => assumption
        | tail _ h => exact h
    · simp [ih]

theorem nodup_dedup {α} [DecidableEq α] (l : List α) : (dedup l).Nodup := by
  induction l with
  | nil => simp [dedup]
  | cons a l ih =>
    unfold dedup
    split
    · exact ih
    · rename_i h
      exact List.nodup_cons.mpr ⟨fun m => h (mem_dedup.mp m), ih⟩

theorem dedup_cons {α} [DecidableEq α] (a : α) (l : List α) :
    dedup (a :: l) = if a ∈ l then dedup l else a :: dedup l := rfl

theorem filter_dedup {α} [DecidableEq α] (p : α → Bool) (l : List α) :
    (dedup l).filter p = dedup (l.filter p) := by
  induction l with
  | nil => simp [dedup]
  | cons a l ih =>
    rw [dedup_cons]
    by_cases hp : p a = true
    · rw [List.filter_cons_of_pos hp, dedup_cons]
      have : (a ∈ List.filter p l) ↔ a ∈ l := by simp [List.mem_filter, hp]
      by_cases hm : a ∈ l
      · simp only [hm, ↓reduceIte, this, ih]
      · simp only [hm, ↓reduceIte, this, List.filter_cons_of_pos hp, ih]
    · rw [List.filter_cons_of_neg hp]
      by_cases hm : a ∈ l
      · simp only [hm, ↓reduceIte, ih]
      · simp only [hm, ↓reduceIte, List.filter_cons_of_neg hp, ih]

/-- How many distinct records pass a test depends only on which usable records that pass it are present. -/
theorem cnt_congr {l₁ l₂ : List Run} {p : Run → Bool}
    (h : ∀ r, p r = true → (r ∈ l₁ ∧ usable l₁ r = true ↔ r ∈ l₂ ∧ usable l₂ r = true)) :
    cnt l₁ p = cnt l₂ p := by
  simp only [cnt, List.countP_eq_length_filter, filter_dedup]
  apply List.Perm.length_eq
  apply (List.perm_ext_iff_of_nodup (nodup_dedup _) (nodup_dedup _)).mpr
  intro r
  simp only [mem_dedup, List.mem_filter, Bool.and_eq_true]
  constructor
  · intro ⟨m, hu, hp⟩; have := (h r hp).mp ⟨m, hu⟩; exact ⟨this.1, this.2, hp⟩
  · intro ⟨m, hu, hp⟩; have := (h r hp).mpr ⟨m, hu⟩; exact ⟨this.1, this.2, hp⟩

theorem cnt_pos {l : List Run} {p : Run → Bool} : 0 < cnt l p ↔ ∃ r ∈ l, usable l r = true ∧ p r = true := by
  simp only [cnt, List.countP_pos_iff, mem_dedup, Bool.and_eq_true]

theorem has_cnt {l : List Run} {s : Spec} {p : Run → Bool} :
    has (reading l) s p = true ↔ ∃ r ∈ l, usable l r = true ∧ mine s p r = true := by
  simp only [has, reading, decide_eq_true_eq, cnt_pos]

/-- A test over the records reads only which records are present. -/
theorem any_congr {l₁ l₂ : List Run} (h : ∀ r, r ∈ l₁ ↔ r ∈ l₂) (f : Run → Bool) : l₁.any f = l₂.any f := by
  apply Bool.eq_iff_iff.mpr
  simp only [List.any_eq_true, h]

theorem usable_congr {l₁ l₂ : List Run} (h : ∀ r, r ∈ l₁ ↔ r ∈ l₂) (r : Run) : usable l₁ r = usable l₂ r := by
  simp only [usable, conflicted, withdrawn, any_congr h]

/-- The whole reading of the records depends only on which records are present. -/
theorem reading_congr {l₁ l₂ : List Run} (h : ∀ r, r ∈ l₁ ↔ r ∈ l₂) : reading l₁ = reading l₂ := by
  have hk : cnt l₁ = cnt l₂ := funext fun _ => cnt_congr fun r _ => by rw [h r, usable_congr h r]
  have hc : ∀ r, conflicted l₁ r = conflicted l₂ r := fun r => by simp only [conflicted, any_congr h]
  have hw : ∀ r, withdrawn l₁ r = withdrawn l₂ r := fun r => by simp only [withdrawn, any_congr h]
  simp only [reading, hk, hc, hw, any_congr h]

end Verdicts
