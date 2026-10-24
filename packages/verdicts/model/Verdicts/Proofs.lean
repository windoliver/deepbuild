import Verdicts.Model
import Verdicts.Top
/-!
# The properties of One table, one reference, proved for the model

`verdict_closed`, `verdict_highest`, `verdict_never_pass`, `verdict_set_only` and `verdict_rises`, then
`late_read_stale`: a late run whose reads withdraw a carry. No declaration refers to these six, so each stands alone.
-/
namespace Verdicts

theorem mem_row {x : Row} {b : Bool} {r : Row} : x ∈ row b r ↔ b = true ∧ x = r := by
  unfold row; split <;> simp_all

/-- A row whose result isn't PASS is absent when every row passes. -/
theorem row_absent {b : Bool} {r : Row} (h : ∀ x ∈ row b r, x.result = .PASS) (hr : r.result ≠ .PASS) :
    b = false := by
  cases hb : b
  · rfl
  · exact absurd (h r (mem_row.mpr ⟨hb, rfl⟩)) hr

/-- The verdict is one of the five or pending. -/
theorem verdict_closed (cl : Claim) :
    verdict cl ∈ [Result.PASS, .FAIL, .INVALID, .BLOCKED, .INCONCLUSIVE, .pending] := by
  cases verdict cl <;> simp

theorem checkOutcome_le {reqs : List Req} {k : Counter} {c : Check} {n : Nat}
    (h : ∀ x ∈ checkRows reqs k c, rank x.result ≤ n) : rank (checkOutcome reqs k c) ≤ n := by
  apply top_le
  intro r hr
  obtain ⟨x, hx, rfl⟩ := List.mem_map.mp hr
  exact h x hx

/-- The roll-up per check, per requirement and for the claim is the highest row that applies anywhere. -/
theorem verdictWith_top (cl : Claim) (k : Counter) :
    verdictWith cl k = top ((allRows cl k).map Row.result) := by
  obtain ⟨T, hTdef⟩ : ∃ T, T = top ((allRows cl k).map Row.result) := ⟨_, rfl⟩
  rw [← hTdef]
  have hT : ∀ x ∈ allRows cl k, rank x.result ≤ rank T :=
    fun x hx => hTdef ▸ le_top (List.mem_map.mpr ⟨x, hx, rfl⟩)
  have hc : ∀ c ∈ cl.checks, rank (checkOutcome cl.reqs k c) ≤ rank T := by
    intro c hc
    apply checkOutcome_le
    intro x hx
    apply hT
    simp only [allRows, List.mem_append, List.mem_flatMap]
    exact Or.inl (Or.inl ⟨c, hc, hx⟩)
  have hrq : ∀ q ∈ cl.reqs, rank (reqRow (cl.checks.map (·.spec)) q).result ≤ rank T := by
    intro q hq
    apply hT
    simp only [allRows, List.mem_append, List.mem_map]
    exact Or.inl (Or.inr ⟨q, hq, rfl⟩)
  have hq : ∀ q ∈ cl.reqs, rank (reqOutcome cl k q) ≤ rank T := by
    intro q hq
    apply top_le
    intro r hr
    rcases List.mem_cons.mp hr with rfl | hr
    · exact hrq q hq
    · obtain ⟨c, hc', rfl⟩ := List.mem_map.mp hr
      exact hc c (List.mem_filter.mp hc').1
  unfold verdictWith
  apply top_eq
  · intro r hr
    simp only [List.mem_append, List.mem_map] at hr
    rcases hr with (⟨c, hc', rfl⟩ | ⟨q, hq', rfl⟩) | ⟨x, hx, rfl⟩
    · exact hc c hc'
    · exact hq q hq'
    · exact hT x (by simp only [allRows, List.mem_append]; exact Or.inr hx)
  · rcases top_mem ((allRows cl k).map Row.result) with e | e
    · exact Or.inl (hTdef ▸ e)
    · right
      rw [← hTdef] at e
      obtain ⟨x, hx, hxT⟩ := List.mem_map.mp e
      simp only [allRows, List.mem_append, List.mem_flatMap, List.mem_map] at hx
      simp only [List.mem_append, List.mem_map]
      rcases hx with (⟨c, hc', hx⟩ | ⟨q, hq', rfl⟩) | hx
      · refine Or.inl (Or.inl ⟨c, hc', rank_inj (Nat.le_antisymm (hc c hc') ?_)⟩)
        rw [← hxT]
        exact le_top (List.mem_map.mpr ⟨x, hx, rfl⟩)
      · refine Or.inl (Or.inr ⟨q, hq', rank_inj (Nat.le_antisymm (hq q hq') ?_)⟩)
        rw [← hxT]
        exact le_top (List.mem_cons_self ..)
      · exact Or.inr ⟨x, hx, hxT⟩

/-- The verdict, rolled up per check, per requirement and for the claim as the engine does, is the highest by
precedence of every row that applies anywhere in the claim, for any reading of the runs. -/
theorem verdict_highest (cl : Claim) (k : Counter) :
    verdictWith cl k = top ((allRows cl k).map Row.result) :=
  verdictWith_top cl k

/-- The verdict reads only which run records are present: not their order, nor how often one arrives. -/
theorem verdict_set_only (cl : Claim) (l : List Run) (h : ∀ r, r ∈ cl.runs ↔ r ∈ l) :
    verdict { cl with runs := l } = verdict cl := by
  have e : reading l = reading cl.runs := reading_congr (fun r => (h r).symm)
  simp only [verdict, e]
  -- The roll-up reads the records only through the reading.
  rfl

theorem rows_pass_of_verdict {cl : Claim} (h : verdict cl = .PASS) :
    ∀ x ∈ allRows cl (reading cl.runs), x.result = .PASS := by
  rw [verdict, verdictWith_top] at h
  intro x hx
  exact top_eq_pass h _ (List.mem_map.mpr ⟨x, hx, rfl⟩)

theorem checkOutcome_pass {reqs : List Req} {k : Counter} {c : Check}
    (h : ∀ x ∈ checkRows reqs k c, x.result = .PASS) : checkOutcome reqs k c = .PASS :=
  rank_eq_zero (checkOutcome_le (fun x hx => by rw [h x hx]; exact Nat.le_refl _))

/-- What every check of a passing claim satisfies. -/
theorem check_pass_requires {reqs : List Req} {k : Counter} {c : Check}
    (h : ∀ x ∈ checkRows reqs k c, x.result = .PASS) :
    c.state ≠ .neverStarted ∧ running k c = false ∧ c.spec.cantFail = false
    ∧ k.conflict c.spec.id = false
    ∧ has k c.spec (fun r => r.outcome == .ranNothing || (r.outcome == .passed && r.tests == 0)) = false
    ∧ has k c.spec (·.outcome == .missing) = false
    ∧ has k c.spec isFail = false
    ∧ (isFix reqs c.spec = true → baseProves c.spec.base = true)
    ∧ ∃ n, c.spec.need = some n ∧ n ≤ count k c.spec isPass := by
  have hs : c.state ≠ .neverStarted := by
    intro hs
    have := h .never_started (by simp [checkRows, hs])
    simp [Row.result] at this
  have hr : running k c = false := by
    cases hr : running k c
    · rfl
    · have := h .runs_to_come (by simp [checkRows, hs, hr])
      simp [Row.result] at this
  simp only [checkRows, hs, hr, ↓reduceIte, staticRows, runRows, endedRows, List.forall_mem_append,
    Bool.false_eq_true, and_assoc] at h
  obtain ⟨h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12, h13, h14, h15, h16, h17, h18⟩ := h
  have e1 := row_absent h1 (by decide)
  have e2 := row_absent h2 (by decide)
  have e3 := row_absent h3 (by decide)
  have e4 := row_absent h4 (by decide)
  have e5 := row_absent h5 (by decide)
  have e6 := row_absent h6 (by decide)
  have e9 := row_absent h9 (by decide)
  have e10 := row_absent h10 (by decide)
  have e11 := row_absent h11 (by decide)
  have e12 := row_absent h12 (by decide)
  have e13 := row_absent h13 (by decide)
  have e14 := row_absent h14 (by decide)
  have hfail : has k c.spec isFail = false := by
    cases hf : has k c.spec isFail
    · rfl
    · rw [hf] at e9 e10 e11
      cases hp : (count k c.spec isPass == 0) <;>
        cases hi : (!has k c.spec (fun r => isFail r && !onBase c.spec (isFix reqs c.spec) r)) <;>
        simp_all
  refine ⟨hs, hr, e2, e6, e5, e4, hfail, ?_, ?_⟩
  · intro hfix
    cases hb : baseProves c.spec.base
    · simp [hfix, hb] at e3
    · rfl
  · cases hn : c.spec.need with
    | none => simp [hn] at e1
    | some n =>
      refine ⟨n, rfl, ?_⟩
      rw [hn] at e14
      simp only [hfail, Bool.not_false, Bool.and_true] at e13
      simp only [hfail, Bool.false_and, Bool.not_false, e12, e13, Bool.true_and] at e14
      simpa using e14

/-- A claim never passes while any check is pending, never started, ran nothing, can't fail, failed, is
missing something, holds two records of one run ID that differ, or has fewer clean runs than it needs; while a code
requirement has no check at its depth that isn't the agent's own; while a person's answer is anything but PASS;
or with no check at all. -/
theorem verdict_never_pass (cl : Claim) (h : verdict cl = .PASS) :
    cl.checks ≠ []
    ∧ (∀ c ∈ cl.checks,
        checkOutcome cl.reqs (reading cl.runs) c = .PASS
        ∧ c.state ≠ .neverStarted ∧ running (reading cl.runs) c = false ∧ c.spec.cantFail = false
        ∧ (¬ ∃ r ∈ cl.runs, r.check = c.spec.id ∧ conflicted cl.runs r = true)
        ∧ (¬ ∃ r ∈ cl.runs, usable cl.runs r = true
            ∧ mine c.spec (fun r => r.outcome == .ranNothing || (r.outcome == .passed && r.tests == 0)) r)
        ∧ (¬ ∃ r ∈ cl.runs, usable cl.runs r = true ∧ mine c.spec (·.outcome == .missing) r)
        ∧ (¬ ∃ r ∈ cl.runs, usable cl.runs r = true ∧ mine c.spec isFail r)
        ∧ (isFix cl.reqs c.spec = true → baseProves c.spec.base = true)
        ∧ ∃ n, c.spec.need = some n ∧ n ≤ count (reading cl.runs) c.spec isPass)
    ∧ (∀ q ∈ cl.reqs, q.person = none →
        ∃ c ∈ cl.checks, c.spec.covers.contains q.id = true ∧ q.depth ≤ c.spec.depth
          ∧ (q.numbers = true → c.spec.contract = true) ∧ c.spec.own = false)
    ∧ (∀ q ∈ cl.reqs, q.person ≠ none → q.person = some .pass)
    ∧ (cl.reqs = [] → ∃ c ∈ cl.checks, c.spec.own = false) := by
  have hrow := rows_pass_of_verdict h
  have hcl : ∀ x ∈ claimRows cl, x.result = .PASS :=
    fun x hx => hrow x (by simp only [allRows, List.mem_append]; exact Or.inr hx)
  have hreq : ∀ q ∈ cl.reqs, (reqRow (cl.checks.map (·.spec)) q).result = .PASS :=
    fun q hq => hrow _ (by simp only [allRows, List.mem_append, List.mem_map]; exact Or.inl (Or.inr ⟨q, hq, rfl⟩))
  simp only [claimRows, List.forall_mem_append] at hcl
  obtain ⟨⟨_, c2⟩, c3⟩ := hcl
  have ne : cl.checks.isEmpty = false := row_absent c2 (by decide)
  have own := row_absent c3 (by decide)
  refine ⟨?_, ?_, ?_, ?_, ?_⟩
  · intro e; simp [e] at ne
  · intro c hc
    have hrows : ∀ x ∈ checkRows cl.reqs (reading cl.runs) c, x.result = .PASS :=
      fun x hx => hrow x (by simp only [allRows, List.mem_append, List.mem_flatMap]; exact Or.inl (Or.inl ⟨c, hc, hx⟩))
    obtain ⟨p1, p2, p3, p4, p5, p6, p7, p8, p9⟩ := check_pass_requires hrows
    have nx : ∀ {p}, has (reading cl.runs) c.spec p = false →
        ¬ ∃ r ∈ cl.runs, usable cl.runs r = true ∧ mine c.spec p r = true := by
      intro p e ex; rw [← has_cnt, e] at ex; simp at ex
    have nc : ¬ ∃ r ∈ cl.runs, r.check = c.spec.id ∧ conflicted cl.runs r = true := by
      rintro ⟨r, hr, hc, hx⟩
      have : (reading cl.runs).conflict c.spec.id = true := by
        simp only [reading, List.any_eq_true, Bool.and_eq_true, beq_iff_eq]; exact ⟨r, hr, hc, hx⟩
      rw [p4] at this; simp at this
    exact ⟨checkOutcome_pass hrows, p1, p2, p3, nc, nx p5, nx p6, nx p7, p8, p9⟩
  · intro q hq hp
    have e := hreq q hq
    simp only [reqRow, hp] at e
    split at e
    · simp [Row.result] at e
    · split at e
      · simp [Row.result] at e
      · rename_i h2
        simp only [Bool.not_eq_true, List.all_eq_false, List.mem_filter] at h2
        obtain ⟨s, ⟨hs, hcond⟩, hown⟩ := h2
        obtain ⟨c, hc, rfl⟩ := List.mem_map.mp hs
        simp only [Bool.and_eq_true, decide_eq_true_eq, Bool.or_eq_true, Bool.not_eq_true'] at hcond
        obtain ⟨⟨hcov, hdep⟩, hnum⟩ := hcond
        refine ⟨c, hc, hcov, hdep, ?_, by simpa using hown⟩
        intro hn; rcases hnum with hnum | hnum
        · simp [hn] at hnum
        · exact hnum
  · intro q hq hp
    have e := hreq q hq
    cases hq' : q.person with
    | none => exact absurd hq' hp
    | some a => cases a <;> simp_all [reqRow, Row.result]
  · intro e
    simp only [e, List.isEmpty_nil, ne, Bool.not_false, Bool.true_and] at own
    simp only [List.all_eq_false] at own
    obtain ⟨c, hc, ho⟩ := own
    exact ⟨c, hc, by simpa using ho⟩

-- ---- Landing

inductive Forall2 {α β} (R : α → β → Prop) : List α → List β → Prop
  | nil : Forall2 R [] []
  | cons {a b l l'} : R a b → Forall2 R l l' → Forall2 R (a :: l) (b :: l')

theorem Forall2.exists_of_mem {α β} {R : α → β → Prop} {l : List α} {l' : List β} (h : Forall2 R l l') :
    ∀ a ∈ l, ∃ b ∈ l', R a b := by
  induction h with
  | nil => simp
  | cons hab _ ih =>
    intro a ha
    rcases List.mem_cons.mp ha with rfl | ha
    · exact ⟨_, List.mem_cons_self .., hab⟩
    · obtain ⟨b, hb, r⟩ := ih a ha
      exact ⟨b, List.mem_cons_of_mem _ hb, r⟩

/-- An open ask may get its answer; nothing else about a requirement changes. -/
def ReqLands (q q' : Req) : Prop := q' = q ∨ (q.person = some .open ∧ ∃ a, q' = { q with person := some a })

/-- Only a check with runs still to come may change, and only its state, to anything but never started. -/
def CheckLands (k : Counter) (c c' : Check) : Prop :=
  c'.spec = c.spec ∧ (c' = c ∨ (running k c = true ∧ c'.state ≠ .neverStarted))

/-- `cl'` is `cl` after pending results land while the checks' inputs stay the same: runs already counted stay;
every new record is a new run, with an ID no earlier record holds, of a check with runs still to come, and
reads no path a change touched; such a check may end, and an open ask may be answered. -/
structure Lands (cl cl' : Claim) : Prop where
  reqs : Forall2 ReqLands cl.reqs cl'.reqs
  checks : Forall2 (CheckLands (reading cl.runs)) cl.checks cl'.checks
  badState : cl'.badState = cl.badState
  kept : ∀ r ∈ cl.runs, r ∈ cl'.runs
  fresh : ∀ r ∈ cl'.runs, r ∉ cl.runs → ∀ c ∈ cl.checks, c.spec.id = r.check → running (reading cl.runs) c = true
  newId : ∀ r ∈ cl'.runs, r ∉ cl.runs → ∀ r₀ ∈ cl.runs, r₀.id ≠ r.id
  sameInputs : ∀ r ∈ cl'.runs, r ∉ cl.runs → r.readsChanged = false

theorem specs_eq {k : Counter} {l l' : List Check} (h : Forall2 (CheckLands k) l l') :
    l'.map (·.spec) = l.map (·.spec) := by
  induction h with
  | nil => rfl
  | cons hab _ ih => simp only [List.map_cons, hab.1, ih]

theorem isFix_eq {l l' : List Req} (h : Forall2 ReqLands l l') (s : Spec) : isFix l' s = isFix l s := by
  induction h with
  | nil => rfl
  | cons hab _ ih =>
    simp only [isFix, List.any_cons] at ih ⊢
    rcases hab with rfl | ⟨_, a, rfl⟩
    · rw [ih]
    · rw [ih]

theorem checkRows_congr (reqs : List Req) {k k' : Counter} (c : Check)
    (h : ∀ p, k.k (mine c.spec p) = k'.k (mine c.spec p))
    (hc : k.conflict c.spec.id = k'.conflict c.spec.id) :
    checkRows reqs k c = checkRows reqs k' c := by
  have hh : has k c.spec = has k' c.spec := funext fun p => by simp only [has, h]
  have hn : count k c.spec = count k' c.spec := funext fun p => by simp only [count, h]
  have hm : moreRuns k c.spec = moreRuns k' c.spec := by simp only [moreRuns, hh, hn]
  have hr : running k c = running k' c := by simp only [running, hm]
  simp only [checkRows, runRows, endedRows, hh, hn, hr, hc]

theorem runRows_mono {k k' : Counter} (s : Spec) (h : ∀ p, has k s p = true → has k' s p = true)
    (hc : k.conflict s.id = true → k'.conflict s.id = true) :
    ∀ x ∈ runRows k s, x ∈ runRows k' s := by
  intro x hx
  simp only [runRows, List.mem_append, mem_row] at hx ⊢
  rcases hx with (((⟨e, rfl⟩ | ⟨e, rfl⟩) | ⟨e, rfl⟩) | ⟨e, rfl⟩) | ⟨e, rfl⟩
  · exact Or.inl (Or.inl (Or.inl (Or.inl ⟨h _ e, rfl⟩)))
  · exact Or.inl (Or.inl (Or.inl (Or.inr ⟨h _ e, rfl⟩)))
  · exact Or.inl (Or.inl (Or.inr ⟨hc e, rfl⟩))
  · exact Or.inl (Or.inr ⟨h _ e, rfl⟩)
  · simp only [Bool.and_eq_true] at e
    exact Or.inr ⟨by simp [e.1, h _ e.2], rfl⟩

section Landing
variable {cl cl' : Claim} (L : Lands cl cl')
include L

/-- An earlier record is in conflict after landing exactly when it was before: new records bring new IDs. -/
theorem conflicted_kept : ∀ r ∈ cl.runs, conflicted cl'.runs r = conflicted cl.runs r := by
  intro r hr
  apply Bool.eq_iff_iff.mpr
  simp only [conflicted, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, bne_iff_ne, ne_eq]
  constructor
  · rintro ⟨r', hr', hid, hne⟩
    by_cases ho : r' ∈ cl.runs
    · exact ⟨r', ho, hid, hne⟩
    · exact absurd hid.symm (L.newId r' hr' ho r hr)
  · rintro ⟨r', hr', hid, hne⟩
    exact ⟨r', L.kept r' hr', hid, hne⟩

/-- Landing withdraws nothing: new records read no path a change touched. -/
theorem withdrawn_kept : ∀ r, withdrawn cl'.runs r = withdrawn cl.runs r := by
  intro r
  apply Bool.eq_iff_iff.mpr
  simp only [withdrawn, Bool.and_eq_true, List.any_eq_true, beq_iff_eq]
  constructor
  · rintro ⟨h0, r', hr', ⟨⟨hc, hm⟩, hrd⟩⟩
    by_cases ho : r' ∈ cl.runs
    · exact ⟨h0, r', ho, ⟨hc, hm⟩, hrd⟩
    · rw [L.sameInputs r' hr' ho] at hrd; exact absurd hrd (by decide)
  · rintro ⟨h0, r', hr', hx⟩
    exact ⟨h0, r', L.kept r' hr', hx⟩

theorem usable_kept : ∀ r ∈ cl.runs, usable cl'.runs r = usable cl.runs r := by
  intro r hr
  simp only [usable, conflicted_kept L r hr, withdrawn_kept L r]

theorem has_mono : ∀ s p, has (reading cl.runs) s p = true → has (reading cl'.runs) s p = true := by
  intro s p e
  obtain ⟨r, hr, hu, m⟩ := has_cnt.mp e
  exact has_cnt.mpr ⟨r, L.kept r hr, by rw [usable_kept L r hr]; exact hu, m⟩

theorem conflict_mono : ∀ i, (reading cl.runs).conflict i = true → (reading cl'.runs).conflict i = true := by
  intro i e
  simp only [reading, List.any_eq_true, Bool.and_eq_true] at e ⊢
  obtain ⟨r, hr, hi, hx⟩ := e
  exact ⟨r, L.kept r hr, hi, by rw [conflicted_kept L r hr]; exact hx⟩

/-- A check with no results to come reads the same records after landing. -/
theorem checkRows_settled {c : Check} (hc : c ∈ cl.checks) (hr : running (reading cl.runs) c = false) :
    checkRows cl'.reqs (reading cl'.runs) c = checkRows cl.reqs (reading cl.runs) c := by
  have old : ∀ r ∈ cl'.runs, r.check = c.spec.id → r ∈ cl.runs := by
    intro r hr' hi
    apply Classical.byContradiction
    intro hn
    have := L.fresh r hr' hn c hc hi.symm
    rw [hr] at this; exact absurd this (by decide)
  have hk : ∀ p, (reading cl.runs).k (mine c.spec p) = (reading cl'.runs).k (mine c.spec p) := by
    intro p
    apply cnt_congr
    intro r m
    have hi : r.check = c.spec.id := by
      simp only [mine, Bool.and_eq_true, beq_iff_eq] at m; exact m.1.1.1
    constructor
    · rintro ⟨h1, h2⟩; exact ⟨L.kept r h1, by rw [usable_kept L r h1]; exact h2⟩
    · rintro ⟨h1, h2⟩
      have h1' := old r h1 hi
      exact ⟨h1', by rw [← usable_kept L r h1']; exact h2⟩
  have hcf : (reading cl.runs).conflict c.spec.id = (reading cl'.runs).conflict c.spec.id := by
    apply Bool.eq_iff_iff.mpr
    refine ⟨conflict_mono L _, fun e => ?_⟩
    simp only [reading, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at e ⊢
    obtain ⟨r, hr', hi, hx⟩ := e
    have h1 := old r hr' hi
    exact ⟨r, h1, hi, by rw [← conflicted_kept L r h1]; exact hx⟩
  rw [← checkRows_congr _ c hk hcf]
  have hfix : ∀ s, isFix cl'.reqs s = isFix cl.reqs s := isFix_eq L.reqs
  simp only [checkRows, staticRows, endedRows, hfix]

/-- Every row other than pending that applies before results land still applies after. -/
theorem rows_persist :
    ∀ x ∈ allRows cl (reading cl.runs), x.result ≠ .pending → x ∈ allRows cl' (reading cl'.runs) := by
  have hspecs := specs_eq L.checks
  intro x hx hp
  simp only [allRows, List.mem_append, List.mem_flatMap, List.mem_map] at hx ⊢
  rcases hx with (⟨c, hc, hx⟩ | ⟨q, hq, rfl⟩) | hx
  · -- a check's row
    obtain ⟨c', hc', ⟨hspec, hland⟩⟩ := L.checks.exists_of_mem c hc
    refine Or.inl (Or.inl ⟨c', hc', ?_⟩)
    by_cases hr : running (reading cl.runs) c = true
    · have hs : c.state ≠ .neverStarted := by
        intro e
        simp only [checkRows, e, ↓reduceIte, List.mem_cons, List.not_mem_nil, or_false] at hx
        exact hp (by rw [hx]; rfl)
      have hs' : c'.state ≠ .neverStarted := by
        rcases hland with rfl | ⟨_, h'⟩
        · exact hs
        · exact h'
      simp only [checkRows, hs, ↓reduceIte, List.mem_append] at hx
      have hst : staticRows cl'.reqs c.spec = staticRows cl.reqs c.spec := by
        simp only [staticRows, isFix_eq L.reqs]
      simp only [checkRows, hs', ↓reduceIte, List.mem_append, hspec, hst]
      rcases hx with (hx | hx) | hx
      · exact Or.inl (Or.inl hx)
      · exact Or.inl (Or.inr (runRows_mono c.spec (has_mono L c.spec) (conflict_mono L c.spec.id) x hx))
      · exfalso
        simp only [hr, ↓reduceIte, List.mem_cons, List.not_mem_nil, or_false] at hx
        exact hp (by rw [hx]; rfl)
    · rcases hland with rfl | ⟨h', _⟩
      · rw [checkRows_settled L hc (by simpa using hr)]
        exact hx
      · exact absurd h' hr
  · -- a requirement's own row
    obtain ⟨q', hq', hl⟩ := L.reqs.exists_of_mem q hq
    rcases hl with rfl | ⟨ho, _⟩
    · exact Or.inl (Or.inr ⟨q', hq', by rw [hspecs]⟩)
    · exact absurd (by simp [reqRow, ho, Row.result]) hp
  · -- a claim row
    refine Or.inr ?_
    have hlen : cl'.checks.isEmpty = cl.checks.isEmpty := by
      rw [← List.isEmpty_map (f := (·.spec)), hspecs, List.isEmpty_map]
    have hown : cl'.checks.all (·.spec.own) = cl.checks.all (·.spec.own) := by
      have := congrArg (fun l => l.all (·.own)) hspecs
      simpa [List.all_map, Function.comp_def] using this
    have hreqs : cl'.reqs.isEmpty = cl.reqs.isEmpty := by
      have : ∀ {l l'}, Forall2 ReqLands l l' → l'.isEmpty = l.isEmpty := by
        intro l l' h; cases h <;> rfl
      exact this L.reqs
    simp only [claimRows, L.badState, hlen, hown, hreqs] at hx ⊢
    exact hx

end Landing

/-- Once a verdict other than PASS or pending is made, results that land while the checks' inputs stay the same
only raise it. -/
theorem verdict_rises {cl cl' : Claim} (L : Lands cl cl') (h1 : verdict cl ≠ .PASS) (h2 : verdict cl ≠ .pending) :
    rank (verdict cl) ≤ rank (verdict cl') := by
  simp only [verdict, verdictWith_top] at h1 h2 ⊢
  rcases top_mem ((allRows cl (reading cl.runs)).map Row.result) with e | e
  · exact absurd e h1
  · obtain ⟨x, hx, hxv⟩ := List.mem_map.mp e
    rw [← hxv]
    exact le_top (List.mem_map.mpr ⟨x, rows_persist L x hx (hxv ▸ h2), rfl⟩)

/-- A late run of a check on an earlier commit, whose reads include a path the change from that commit touched,
withdraws the result carried from there. That changes the check's inputs, so it isn't a landing: the check is
marked stale and counts no run of that commit, the late run included. When that carry was all the check counted,
it counts no run at all, and neither the check nor the claim passes. -/
theorem late_read_stale (cl : Claim) (c : Check) (hc : c ∈ cl.checks) (hns : c.state ≠ .neverStarted)
    (hneed : c.spec.need ≠ some 0)
    (r₀ : Run) (h₀ : r₀ ∈ cl.runs) (hm : mine c.spec (fun _ => true) r₀ = true) (hat : r₀.commit ≠ 0)
    (hu : conflicted cl.runs r₀ = false)
    (honly : has (reading cl.runs) c.spec (fun r => r.commit != r₀.commit) = false)
    (late : Run) (hcheck : late.check = c.spec.id) (hcommit : late.commit = r₀.commit)
    (hreads : late.readsChanged = true) (hid : ∀ r ∈ cl.runs, r.id ≠ late.id) :
    isStale (reading (cl.runs ++ [late])) c.spec = true
    ∧ has (reading (cl.runs ++ [late])) c.spec (fun _ => true) = false
    ∧ checkOutcome cl.reqs (reading (cl.runs ++ [late])) c ≠ .PASS
    ∧ verdict { cl with runs := cl.runs ++ [late] } ≠ .PASS := by
  have hm' := hm
  simp only [mine, Bool.and_eq_true, beq_iff_eq, bne_iff_ne, ne_eq, and_true] at hm'
  obtain ⟨⟨h0c, h0n⟩, h0o⟩ := hm'
  -- An earlier record keeps its conflicts: the late run brings a new ID.
  have hconf : ∀ r ∈ cl.runs, conflicted (cl.runs ++ [late]) r = conflicted cl.runs r := by
    intro r hr
    apply Bool.eq_iff_iff.mpr
    simp only [conflicted, List.any_append, List.any_cons, List.any_nil, Bool.or_false, Bool.or_eq_true,
      Bool.and_eq_true, beq_iff_eq, bne_iff_ne, ne_eq]
    constructor
    · rintro (h | ⟨hid', _⟩)
      · exact h
      · exact absurd hid'.symm (hid r hr)
    · intro h; exact Or.inl h
  -- The late run withdraws every run of the check on r₀'s commit, and nothing on another.
  have hwd : ∀ r, r.check = c.spec.id → r.commit = r₀.commit → withdrawn (cl.runs ++ [late]) r = true := by
    intro r hrc hcm
    simp only [withdrawn, List.any_append, List.any_cons, List.any_nil, Bool.or_false, Bool.and_eq_true,
      Bool.or_eq_true, bne_iff_ne, ne_eq, beq_iff_eq]
    exact ⟨by rw [hcm]; exact hat, Or.inr ⟨⟨by rw [hcheck, hrc], by rw [hcommit, hcm]⟩, hreads⟩⟩
  have hwo : ∀ r, r.commit ≠ r₀.commit → withdrawn (cl.runs ++ [late]) r = withdrawn cl.runs r := by
    intro r hcm
    have hl : (late.check == r.check && late.commit == r.commit && late.readsChanged) = false := by
      have : (late.commit == r.commit) = false := by
        rw [hcommit]; exact beq_eq_false_iff_ne.mpr (Ne.symm hcm)
      simp [this]
    simp only [withdrawn, List.any_append, List.any_cons, List.any_nil, Bool.or_false, hl]
  -- Nothing of the check counts any more.
  have hall : ∀ p, has (reading (cl.runs ++ [late])) c.spec p = false := by
    intro p
    cases e : has (reading (cl.runs ++ [late])) c.spec p
    · rfl
    · exfalso
      obtain ⟨r, hr, hus, hmr⟩ := has_cnt.mp e
      simp only [mine, Bool.and_eq_true, beq_iff_eq] at hmr
      obtain ⟨⟨⟨hrc, hcnt⟩, hro⟩, _⟩ := hmr
      by_cases hcm : r.commit = r₀.commit
      · simp [usable, hwd r hrc hcm] at hus
      · have hr' : r ∈ cl.runs := by
          rcases List.mem_append.mp hr with h | h
          · exact h
          · simp only [List.mem_singleton] at h; subst h; exact absurd hcommit hcm
        have hus' : usable cl.runs r = true := by
          simp only [usable, Bool.and_eq_true, Bool.not_eq_true'] at hus ⊢
          exact ⟨by rw [← hconf r hr']; exact hus.1, by rw [← hwo r hcm]; exact hus.2⟩
        have : has (reading cl.runs) c.spec (fun r => r.commit != r₀.commit) = true :=
          has_cnt.mpr ⟨r, hr', hus', by simp [mine, hrc, hcnt, hro, hcm]⟩
        rw [honly] at this; exact absurd this (by decide)
  have hst : isStale (reading (cl.runs ++ [late])) c.spec = true := by
    simp only [isStale, hall, Bool.not_false, Bool.and_true]
    simp only [reading, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, bne_iff_ne, ne_eq, Bool.not_eq_true']
    exact ⟨r₀, List.mem_append_left _ h₀, ⟨⟨⟨⟨h0c, h0n⟩, h0o⟩, by rw [hconf r₀ h₀]; exact hu⟩, hwd r₀ h0c rfl⟩⟩
  -- A row that isn't PASS: runs to come, too few clean runs, or runs needed unreadable.
  have hk : ∀ p, (reading (cl.runs ++ [late])).k (mine c.spec p) = 0 := by
    intro p
    have := hall p
    simp only [has, decide_eq_false_iff_not, Nat.not_lt] at this
    omega
  have hrow : ∃ x ∈ checkRows cl.reqs (reading (cl.runs ++ [late])) c, x.result ≠ .PASS := by
    cases hn : c.spec.need with
    | none =>
      refine ⟨.runs_needed_unreadable, ?_, by decide⟩
      simp [checkRows, hns, staticRows, hn, row]
    | some n =>
      have hn0 : 0 < n := by
        cases n with
        | zero => exact absurd hn hneed
        | succ => omega
      by_cases hr : running (reading (cl.runs ++ [late])) c = true
      · exact ⟨.runs_to_come, by simp [checkRows, hns, hr], by decide⟩
      · have hr' : running (reading (cl.runs ++ [late])) c = false := by simpa using hr
        refine ⟨.too_few_clean_runs, ?_, by decide⟩
        simp [checkRows, hns, hr', endedRows, count, has, hk, hn, hn0, row]
  obtain ⟨x, hx, hxr⟩ := hrow
  refine ⟨hst, hall _, fun hp => ?_, fun hp => ?_⟩
  · have hp' : top ((checkRows cl.reqs (reading (cl.runs ++ [late])) c).map Row.result) = .PASS := hp
    exact hxr (top_eq_pass hp' _ (List.mem_map.mpr ⟨x, hx, rfl⟩))
  · exact hxr (rows_pass_of_verdict hp x
      (by simp only [allRows, List.mem_append, List.mem_flatMap]; exact Or.inl (Or.inl ⟨c, hc, hx⟩)))

end Verdicts
