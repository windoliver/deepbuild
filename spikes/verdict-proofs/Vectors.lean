import VerdictProofs
/-!
# Test vectors from the proved model

`lake exe vectors <seed> <count>` prints one JSON line per generated abstract claim: the claim, the model's
verdict, each check's and each requirement's outcome, and the tags of the rows that applied. The TS test
(`agree.test.ts`) builds a concrete claim from each line and requires the engine to agree.
-/
namespace Verdict

deriving instance Inhabited for Answer, State, Evidence, Report, Outcome, Failure, Run

/-- splitmix64. -/
structure Rng where
  s : UInt64

def Rng.next (g : Rng) : UInt64 × Rng :=
  let s := g.s + 0x9E3779B97F4A7C15
  let z := (s ^^^ (s >>> 30)) * 0xBF58476D1CE4E5B9
  let z := (z ^^^ (z >>> 27)) * 0x94D049BB133111EB
  (z ^^^ (z >>> 31), ⟨s⟩)

abbrev Gen := StateM Rng

/-- A whole number below `n`. -/
def below (n : Nat) : Gen Nat := do
  let (x, g) := (← get).next
  set g
  return x.toNat % n

/-- True with probability `p` percent. -/
def chance (p : Nat) : Gen Bool := return (← below 100) < p

def pick {α} [Inhabited α] (l : List α) : Gen α := return l[← below l.length]!

def genAnswer : Gen Answer := pick [.open, .unanswered, .pass, .fail]

def genReq (clean : Bool) (id : Nat) : Gen Req := do
  let depth ← if clean then below 2 else below 4
  let person ← if ← chance (if clean then 5 else 15) then some <$> genAnswer else pure none
  return { id, depth, person, numbers := ← chance (if clean then 3 else 15), fix := ← chance 40 }

def subset (l : List Nat) (p : Nat) : Gen (List Nat) := l.filterM fun _ => chance p

def genBase (clean : Bool) : Gen Base := do
  let r ← below 100
  if r < (if clean then 3 else 30) then return .none
  if r < (if clean then 6 else 45) then return .passed
  return .failed (← chance (if clean then 97 else 85)) (← subset [0, 1, 2] 45)

def genSpec (clean : Bool) (id : Nat) (reqIds : List Nat) : Gen Spec := do
  let covers ← subset reqIds (if clean then 90 else 60)
  let covers := if ← chance 5 then covers ++ [99] else covers
  let need ← if ← chance (if clean then 1 else 8) then pure none else (if ← chance 50 then pure (some 1) else some <$> (· + 1) <$> below 3)
  return { id, own := ← chance (if clean then 10 else 25), depth := ← (if clean then (· + 1) <$> below 3 else below 4), covers, need,
           cantFail := ← chance (if clean then 1 else 6), base := ← genBase clean,
           contract := ← chance 15 }

def genEvidence (clean : Bool) : Gen Evidence := do
  let r ← below 100
  if r < (if clean then 96 else 75) then return .captured
  if r < 80 then return .notRequested
  if r < 84 then return .noDigest
  if r < 89 then return .missingOutside
  if r < 94 then return .missingInside
  return .truncated

def genOutcome (clean : Bool) : Gen Outcome := do
  let r ← below 100
  if r < (if clean then 88 else 40) then return .passed
  if r < 65 then return .failed
  if r < 70 then return .ranNothing
  if r < 76 then return .missing
  if r < 82 then return .overran
  if r < 88 then return .stopped
  return .uncounted

def genFailures (n : Nat) : Gen (List Failure) := do
  let mut out := []
  for _ in [0:n] do
    out := out ++ [{ test := ← below 3, waived := ← chance 25 }]
  return out

def genRun (clean : Bool) (id check : Nat) (contract : Bool) : Gen Run := do
  let outcome ← genOutcome clean
  let tests ← match outcome with
    | .passed => do if ← chance (if clean then 1 else 10) then pure 0 else (· + 1) <$> below 20
    | .failed => (· + 1) <$> below 20
    | _ => pure 0
  let failures ← match outcome with
    | .failed => do
      let n ← if ← chance 10 then pure 0 else (· + 1) <$> below 2
      genFailures n
    | .overran => do genFailures (← below 2)
    | _ => pure []
  let evidence ← if ← chance 10 then pure [← genEvidence clean, ← genEvidence clean] else pure [← genEvidence clean]
  let report ← if contract then pick [Report.none, .counts, .counts, .counts, .counts, .counts, .counts, .counts, .invalid, .invalid]
    else (do if ← chance 4 then pure Report.invalid else pure Report.none)
  return { id, check, counts := ← chance 85, outcome, tests, failures, evidence, contract := report }


def genClaim : Gen Claim := do
  let clean ← chance 40
  let nReq ← if ← chance 10 then pure 0 else (· + 1) <$> below 3
  let reqs ← (List.range nReq).mapM (genReq clean)
  let nCheck ← if ← chance 6 then pure 0 else (· + 1) <$> below 4
  let mut checks := []
  let mut runs := []
  let mut id := 0
  for j in [0:nCheck] do
    let spec ← genSpec clean j (reqs.map (·.id))
    let state ← if clean then pick [State.auto, .auto, .auto, .auto, .auto, .ended, .ended, .ended, .ended, .running]
      else pick [State.auto, .auto, .auto, .auto, .running, .running, .ended, .ended, .ended, .neverStarted]
    checks := checks ++ [{ spec, state }]
    if state != .neverStarted then
      for _ in [0:(← below 6)] do
        runs := runs ++ [← genRun clean id j spec.contract]
        id := id + 1
  if ← chance 5 then
    runs := runs ++ [← genRun clean id 9 false]
  if !runs.isEmpty && (← chance 15) then
    let r := runs[← below runs.length]!
    runs := runs.insertIdx (← below (runs.length + 1)) r
  return { reqs, checks, runs, badState := ← chance 4 }

-- ---- JSON

def jstr (s : String) : String := "\"" ++ s ++ "\""
def jbool (b : Bool) : String := if b then "true" else "false"
def jarr {α} (f : α → String) (l : List α) : String := "[" ++ ",".intercalate (l.map f) ++ "]"
def jobj (kv : List (String × String)) : String := "{" ++ ",".intercalate (kv.map fun (k, v) => jstr k ++ ":" ++ v) ++ "}"

def Result.name : Result → String
  | .PASS => "PASS" | .pending => "pending" | .INCONCLUSIVE => "INCONCLUSIVE" | .BLOCKED => "BLOCKED"
  | .INVALID => "INVALID" | .FAIL => "FAIL"
def Outcome.name : Outcome → String
  | .passed => "passed" | .failed => "failed" | .ranNothing => "ran_nothing" | .missing => "missing"
  | .overran => "overran" | .stopped => "stopped" | .uncounted => "uncounted"
def Evidence.name : Evidence → String
  | .captured => "captured" | .notRequested => "not_requested" | .noDigest => "no_digest"
  | .missingOutside => "missing_outside" | .missingInside => "missing" | .truncated => "truncated"
def Report.name : Report → String
  | .none => "none" | .counts => "counts" | .invalid => "INVALID"
def State.name : State → String
  | .auto => "auto" | .running => "running" | .ended => "ended" | .neverStarted => "never_started"
def Answer.name : Answer → String
  | .open => "open" | .unanswered => "unanswered" | .pass => "PASS" | .fail => "FAIL"

def Base.json : Base → String
  | .none => "null"
  | .passed => jobj [("outcome", jstr "passed")]
  | .failed a ts => jobj [("outcome", jstr "failed"), ("on_assertion", jbool a), ("tests", jarr toString ts)]

def Req.json (q : Req) : String :=
  jobj [("id", toString q.id), ("depth", toString q.depth),
        ("person", match q.person with | none => "null" | some a => jstr a.name),
        ("numbers", jbool q.numbers), ("fix", jbool q.fix)]

def Check.json (c : Check) : String :=
  let s := c.spec
  jobj [("id", toString s.id), ("own", jbool s.own), ("depth", toString s.depth), ("covers", jarr toString s.covers),
        ("need", match s.need with | none => "null" | some n => toString n), ("cant_fail", jbool s.cantFail),
        ("base", s.base.json), ("contract", jbool s.contract), ("state", jstr c.state.name)]

def Run.json (r : Run) : String :=
  jobj [("id", toString r.id), ("check", toString r.check), ("counts", jbool r.counts), ("outcome", jstr r.outcome.name),
        ("tests", toString r.tests),
        ("failures", jarr (fun f => jobj [("test", toString f.test), ("waived", jbool f.waived)]) r.failures),
        ("evidence", jarr (fun e => jstr e.name) r.evidence), ("contract", jstr r.contract.name)]

def vector (seed : Nat) (cl : Claim) : String :=
  let k := cnt cl.runs
  jobj [("seed", toString seed),
        ("claim", jobj [("reqs", jarr Req.json cl.reqs), ("checks", jarr Check.json cl.checks),
                        ("runs", jarr Run.json cl.runs), ("bad_state", jbool cl.badState)]),
        ("verdict", jstr (verdict cl).name),
        ("checks", jarr (fun c => jstr (checkOutcome cl.reqs k c).name) cl.checks),
        ("reqs", jarr (fun q => jstr (reqOutcome cl k q).name) cl.reqs),
        ("rows", jarr (fun r => jstr r.tag) (dedup (allRows cl k)))]

end Verdict

open Verdict in
def main (args : List String) : IO Unit := do
  let seed := (args[0]? >>= String.toNat?).getD 0x2827
  let n := (args[1]? >>= String.toNat?).getD 10000
  let out ← IO.getStdout
  for i in [0:n] do
    let s := seed * 1000003 + i
    let (cl, _) := genClaim.run ⟨s.toUInt64⟩
    out.putStrLn (vector s cl)
