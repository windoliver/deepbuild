import VerdictProofs.Model
import VerdictProofs.Top
/-!
# The properties of One table, one reference, proved for the model

(a) `verdict_one_of_six`  (b) `verdict_is_highest_row`  (c) `pass_requires`
(d) `verdict_depends_on_set`, `verdict_perm`, `verdict_dup`  (e) `verdict_only_rises`
-/
namespace Verdict

theorem mem_row {x : Row} {b : Bool} {t : String} {r : Result} : x ∈ row b t r ↔ b = true ∧ x = ⟨t, r⟩ := by
  unfold row; split <;> simp_all

/-- A row whose result isn't PASS is absent when every row passes. -/
theorem row_absent {b : Bool} {t : String} {r : Result} (h : ∀ x ∈ row b t r, x.result = .PASS) (hr : r ≠ .PASS) :
    b = false := by
  cases hb : b
  · rfl
  · exact absurd (h ⟨t, r⟩ (mem_row.mpr ⟨hb, rfl⟩)) hr

-- ---- (a)

/-- (a) The verdict is one of the five or pending. -/
theorem verdict_one_of_six (cl : Claim) :
    verdict cl ∈ [Result.PASS, .FAIL, .INVALID, .BLOCKED, .INCONCLUSIVE, .pending] := by
  cases verdict cl <;> simp

-- ---- (b)

theorem checkOutcome_le {reqs : List Req} {k : Counter} {c : Check} {n : Nat}
    (h : ∀ x ∈ checkRows reqs k c, x.result.rank ≤ n) : (checkOutcome reqs k c).rank ≤ n := by
  apply top_le
  intro r hr
  obtain ⟨x, hx, rfl⟩ := List.mem_map.mp hr
  exact h x hx

/-- (b) The verdict, rolled up per check, per requirement and for the claim as the engine does, is the
highest by precedence of every row that applies anywhere in the claim, for any reading of the runs. -/
theorem verdict_is_highest_row (cl : Claim) (k : Counter) :
    verdictWith cl k = top ((allRows cl k).map (·.result)) := by
  obtain ⟨T, hTdef⟩ : ∃ T, T = top ((allRows cl k).map (·.result)) := ⟨_, rfl⟩
  rw [← hTdef]
  have hT : ∀ x ∈ allRows cl k, x.result.rank ≤ T.rank :=
    fun x hx => hTdef ▸ le_top (List.mem_map.mpr ⟨x, hx, rfl⟩)
  have hc : ∀ c ∈ cl.checks, (checkOutcome cl.reqs k c).rank ≤ T.rank := by
    intro c hc
    apply checkOutcome_le
    intro x hx
    apply hT
    simp only [allRows, List.mem_append, List.mem_flatMap]
    exact Or.inl (Or.inl ⟨c, hc, hx⟩)
  have hrq : ∀ q ∈ cl.reqs, (reqRow (cl.checks.map (·.spec)) q).result.rank ≤ T.rank := by
    intro q hq
    apply hT
    simp only [allRows, List.mem_append, List.mem_map]
    exact Or.inl (Or.inr ⟨q, hq, rfl⟩)
  have hq : ∀ q ∈ cl.reqs, (reqOutcome cl k q).rank ≤ T.rank := by
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
  · rcases top_mem ((allRows cl k).map (·.result)) with e | e
    · exact Or.inl (hTdef ▸ e)
    · right
      rw [← hTdef] at e
      obtain ⟨x, hx, hxT⟩ := List.mem_map.mp e
      simp only [allRows, List.mem_append, List.mem_flatMap, List.mem_map] at hx
      simp only [List.mem_append, List.mem_map]
      rcases hx with (⟨c, hc', hx⟩ | ⟨q, hq', rfl⟩) | hx
      · refine Or.inl (Or.inl ⟨c, hc', Result.rank_inj (Nat.le_antisymm (hc c hc') ?_)⟩)
        rw [← hxT]
        exact le_top (List.mem_map.mpr ⟨x, hx, rfl⟩)
      · refine Or.inl (Or.inr ⟨q, hq', Result.rank_inj (Nat.le_antisymm (hq q hq') ?_)⟩)
        rw [← hxT]
        exact le_top (List.mem_cons_self ..)
      · exact Or.inr ⟨x, hx, hxT⟩

-- ---- (d)

theorem verdictWith_runs (cl : Claim) (l : List Run) (k : Counter) :
    verdictWith { cl with runs := l } k = verdictWith cl k := rfl

/-- (d) The verdict reads only which run records are present: not their order, nor how often one arrives. -/
theorem verdict_depends_on_set (cl : Claim) (l : List Run) (h : ∀ r, r ∈ cl.runs ↔ r ∈ l) :
    verdict { cl with runs := l } = verdict cl := by
  have e : cnt l = cnt cl.runs := funext fun _ => cnt_congr (fun r _ => (h r).symm)
  simp only [verdict, e, verdictWith_runs]

theorem verdict_perm (cl : Claim) (l : List Run) (h : cl.runs.Perm l) :
    verdict { cl with runs := l } = verdict cl :=
  verdict_depends_on_set cl l (fun _ => h.mem_iff)

theorem verdict_dup (cl : Claim) (l₁ l₂ : List Run) (r : Run) (e : cl.runs = l₁ ++ l₂) (hr : r ∈ cl.runs) :
    verdict { cl with runs := l₁ ++ r :: l₂ } = verdict cl := by
  apply verdict_depends_on_set
  intro x
  rw [e] at hr ⊢
  simp only [List.mem_append, List.mem_cons]
  constructor
  · rintro (h | h)
    · exact Or.inl h
    · exact Or.inr (Or.inr h)
  · rintro (h | rfl | h)
    · exact Or.inl h
    · simpa using hr
    · exact Or.inr h

-- ---- (c)

theorem rows_pass_of_verdict {cl : Claim} (h : verdict cl = .PASS) :
    ∀ x ∈ allRows cl (cnt cl.runs), x.result = .PASS := by
  rw [verdict, verdict_is_highest_row] at h
  intro x hx
  exact top_eq_pass h _ (List.mem_map.mpr ⟨x, hx, rfl⟩)

theorem checkOutcome_pass {reqs : List Req} {k : Counter} {c : Check}
    (h : ∀ x ∈ checkRows reqs k c, x.result = .PASS) : checkOutcome reqs k c = .PASS :=
  Result.rank_eq_zero (checkOutcome_le (fun x hx => by rw [h x hx]; exact Nat.le_refl _))

/-- What every check of a passing claim satisfies. -/
theorem check_pass_requires {reqs : List Req} {k : Counter} {c : Check}
    (h : ∀ x ∈ checkRows reqs k c, x.result = .PASS) :
    c.state ≠ .neverStarted ∧ running k c = false ∧ c.spec.cantFail = false
    ∧ has k c.spec (fun r => r.outcome == .ranNothing || (r.outcome == .passed && r.tests == 0)) = false
    ∧ has k c.spec (·.outcome == .missing) = false
    ∧ has k c.spec isFail = false
    ∧ (isFix reqs c.spec = true → baseProves c.spec.base = true)
    ∧ ∃ n, c.spec.need = some n ∧ n ≤ count k c.spec isPass := by
  have hs : c.state ≠ .neverStarted := by
    intro hs
    have := h ⟨"never started", .pending⟩ (by simp [checkRows, hs])
    simp at this
  have hr : running k c = false := by
    cases hr : running k c
    · rfl
    · have := h ⟨"runs still to come", .pending⟩ (by simp [checkRows, hs, hr])
      simp at this
  simp only [checkRows, hs, hr, ↓reduceIte, staticRows, runRows, endedRows, List.forall_mem_append,
    Bool.false_eq_true, and_assoc] at h
  obtain ⟨h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, h11, h12, h13, h14, h15, h16, h17⟩ := h
  have e1 := row_absent h1 (by decide)
  have e2 := row_absent h2 (by decide)
  have e3 := row_absent h3 (by decide)
  have e4 := row_absent h4 (by decide)
  have e5 := row_absent h5 (by decide)
  have e8 := row_absent h8 (by decide)
  have e9 := row_absent h9 (by decide)
  have e10 := row_absent h10 (by decide)
  have e11 := row_absent h11 (by decide)
  have e12 := row_absent h12 (by decide)
  have e13 := row_absent h13 (by decide)
  have hfail : has k c.spec isFail = false := by
    cases hf : has k c.spec isFail
    · rfl
    · rw [hf] at e8 e9 e10
      cases hp : (count k c.spec isPass == 0) <;>
        cases hi : (!has k c.spec (fun r => isFail r && !onBase c.spec (isFix reqs c.spec) r)) <;>
        simp_all
  refine ⟨hs, hr, e2, e5, e4, hfail, ?_, ?_⟩
  · intro hfix
    cases hb : baseProves c.spec.base
    · simp [hfix, hb] at e3
    · rfl
  · cases hn : c.spec.need with
    | none => simp [hn] at e1
    | some n =>
      refine ⟨n, rfl, ?_⟩
      rw [hn] at e13
      simp only [hfail, Bool.not_false, Bool.and_true] at e12
      simp only [hfail, Bool.false_and, Bool.not_false, e11, e12, Bool.true_and] at e13
      simpa using e13

/-- (c) A claim never passes while any check is pending, never started, ran nothing, can't fail, failed,
is missing something, or has fewer clean runs than it needs; while a code requirement has no check at its
depth that isn't the agent's own; while a person's answer is anything but PASS; or with no check at all. -/
theorem pass_requires (cl : Claim) (h : verdict cl = .PASS) :
    cl.checks ≠ []
    ∧ (∀ c ∈ cl.checks,
        checkOutcome cl.reqs (cnt cl.runs) c = .PASS
        ∧ c.state ≠ .neverStarted ∧ running (cnt cl.runs) c = false ∧ c.spec.cantFail = false
        ∧ (¬ ∃ r ∈ cl.runs, mine c.spec (fun r => r.outcome == .ranNothing || (r.outcome == .passed && r.tests == 0)) r)
        ∧ (¬ ∃ r ∈ cl.runs, mine c.spec (·.outcome == .missing) r)
        ∧ (¬ ∃ r ∈ cl.runs, mine c.spec isFail r)
        ∧ (isFix cl.reqs c.spec = true → baseProves c.spec.base = true)
        ∧ ∃ n, c.spec.need = some n ∧ n ≤ count (cnt cl.runs) c.spec isPass)
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
    have hrows : ∀ x ∈ checkRows cl.reqs (cnt cl.runs) c, x.result = .PASS :=
      fun x hx => hrow x (by simp only [allRows, List.mem_append, List.mem_flatMap]; exact Or.inl (Or.inl ⟨c, hc, hx⟩))
    obtain ⟨p1, p2, p3, p4, p5, p6, p7, p8⟩ := check_pass_requires hrows
    have nx : ∀ {p}, has (cnt cl.runs) c.spec p = false → ¬ ∃ r ∈ cl.runs, mine c.spec p r = true := by
      intro p e ex; rw [← has_cnt, e] at ex; simp at ex
    exact ⟨checkOutcome_pass hrows, p1, p2, p3, nx p4, nx p5, nx p6, p7, p8⟩
  · intro q hq hp
    have e := hreq q hq
    simp only [reqRow, hp] at e
    split at e
    · simp at e
    · split at e
      · simp at e
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
    | some a => cases a <;> simp_all [reqRow]
  · intro e
    simp only [e, List.isEmpty_nil, ne, Bool.not_false, Bool.true_and] at own
    simp only [List.all_eq_false] at own
    obtain ⟨c, hc, ho⟩ := own
    exact ⟨c, hc, by simpa using ho⟩

-- ---- (e)

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

/-- `cl'` is `cl` after pending results land: runs already counted stay, every new record belongs to a check
with runs still to come, such a check may end, and an open ask may be answered. -/
structure Lands (cl cl' : Claim) : Prop where
  reqs : Forall2 ReqLands cl.reqs cl'.reqs
  checks : Forall2 (CheckLands (cnt cl.runs)) cl.checks cl'.checks
  badState : cl'.badState = cl.badState
  kept : ∀ r ∈ cl.runs, r ∈ cl'.runs
  fresh : ∀ r ∈ cl'.runs, r ∉ cl.runs → ∀ c ∈ cl.checks, c.spec.id = r.check → running (cnt cl.runs) c = true

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
    (h : ∀ p, k (mine c.spec p) = k' (mine c.spec p)) : checkRows reqs k c = checkRows reqs k' c := by
  have hh : has k c.spec = has k' c.spec := funext fun p => by simp only [has, h]
  have hc : count k c.spec = count k' c.spec := funext fun p => by simp only [count, h]
  have hm : moreRuns k c.spec = moreRuns k' c.spec := by simp only [moreRuns, hh, hc]
  have hr : running k c = running k' c := by simp only [running, hm]
  simp only [checkRows, runRows, endedRows, hh, hc, hr]

theorem runRows_mono {k k' : Counter} (s : Spec) (h : ∀ p, has k s p = true → has k' s p = true) :
    ∀ x ∈ runRows k s, x ∈ runRows k' s := by
  intro x hx
  simp only [runRows, List.mem_append, mem_row] at hx ⊢
  rcases hx with ((⟨e, rfl⟩ | ⟨e, rfl⟩) | ⟨e, rfl⟩) | ⟨e, rfl⟩
  · exact Or.inl (Or.inl (Or.inl ⟨h _ e, rfl⟩))
  · exact Or.inl (Or.inl (Or.inr ⟨h _ e, rfl⟩))
  · exact Or.inl (Or.inr ⟨h _ e, rfl⟩)
  · simp only [Bool.and_eq_true] at e
    exact Or.inr ⟨by simp [e.1, h _ e.2], rfl⟩

/-- Every row other than pending that applies before results land still applies after. -/
theorem rows_persist {cl cl' : Claim} (L : Lands cl cl') :
    ∀ x ∈ allRows cl (cnt cl.runs), x.result ≠ .pending → x ∈ allRows cl' (cnt cl'.runs) := by
  have hspecs := specs_eq L.checks
  have hmono : ∀ s p, has (cnt cl.runs) s p = true → has (cnt cl'.runs) s p = true := by
    intro s p e
    obtain ⟨r, hr, m⟩ := has_cnt.mp e
    exact has_cnt.mpr ⟨r, L.kept r hr, m⟩
  intro x hx hp
  simp only [allRows, List.mem_append, List.mem_flatMap, List.mem_map] at hx ⊢
  rcases hx with (⟨c, hc, hx⟩ | ⟨q, hq, rfl⟩) | hx
  · -- a check's row
    obtain ⟨c', hc', ⟨hspec, hland⟩⟩ := L.checks.exists_of_mem c hc
    refine Or.inl (Or.inl ⟨c', hc', ?_⟩)
    by_cases hr : running (cnt cl.runs) c = true
    · have hs : c.state ≠ .neverStarted := by
        intro e; simp [running, e] at hr
      have hs' : c'.state ≠ .neverStarted := by
        rcases hland with rfl | ⟨_, h'⟩
        · exact hs
        · exact h'
      simp only [checkRows, hs, ↓reduceIte, hr, List.mem_append, List.mem_cons, List.not_mem_nil, or_false] at hx
      have hst : staticRows cl'.reqs c.spec = staticRows cl.reqs c.spec := by
        simp only [staticRows, isFix_eq L.reqs]
      simp only [checkRows, hs', ↓reduceIte, List.mem_append, hspec, hst]
      rcases hx with (hx | hx) | rfl
      · exact Or.inl (Or.inl hx)
      · exact Or.inl (Or.inr (runRows_mono c.spec (hmono c.spec) x hx))
      · exact absurd rfl hp
    · rcases hland with rfl | ⟨h', _⟩
      · have hk : ∀ p, cnt cl.runs (mine c'.spec p) = cnt cl'.runs (mine c'.spec p) := by
          intro p
          apply cnt_congr
          intro r m
          refine ⟨L.kept r, fun hr' => ?_⟩
          apply Classical.byContradiction
          intro hn
          have : c'.spec.id = r.check := by
            simp only [mine, Bool.and_eq_true, beq_iff_eq] at m; exact m.1.1.1.symm
          exact hr (L.fresh r hr' hn c' hc this)
        rw [← checkRows_congr _ c' hk]
        have hfix : ∀ s, isFix cl'.reqs s = isFix cl.reqs s := isFix_eq L.reqs
        simp only [checkRows, staticRows, endedRows, hfix] at hx ⊢
        exact hx
      · exact absurd h' hr
  · -- a requirement's own row
    obtain ⟨q', hq', hl⟩ := L.reqs.exists_of_mem q hq
    rcases hl with rfl | ⟨ho, _⟩
    · exact Or.inl (Or.inr ⟨q', hq', by rw [hspecs]⟩)
    · exact absurd (by simp [reqRow, ho]) hp
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

/-- (e) Once a verdict other than PASS or pending is made, results that land only raise it. -/
theorem verdict_only_rises {cl cl' : Claim} (L : Lands cl cl') (h1 : verdict cl ≠ .PASS) (h2 : verdict cl ≠ .pending) :
    (verdict cl).rank ≤ (verdict cl').rank := by
  simp only [verdict, verdict_is_highest_row] at h1 h2 ⊢
  rcases top_mem ((allRows cl (cnt cl.runs)).map (·.result)) with e | e
  · exact absurd e h1
  · obtain ⟨x, hx, hxv⟩ := List.mem_map.mp e
    rw [← hxv]
    exact le_top (List.mem_map.mpr ⟨x, rows_persist L x hx (hxv ▸ h2), rfl⟩)

end Verdict
