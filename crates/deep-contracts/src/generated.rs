// Generated from packages/contracts/schemas by generateRust. Do not edit.
use deep_contracts::{Contract, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckKind {
    Validity,
    Command,
    Journey,
    Review,
    Numbers,
    Docs,
    Draft,
    Narrowing,
    Document,
    PhysicsGolden,
    Media,
}

impl Contract for CheckKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "validity" => Ok(Self::Validity),
            "command" => Ok(Self::Command),
            "journey" => Ok(Self::Journey),
            "review" => Ok(Self::Review),
            "numbers" => Ok(Self::Numbers),
            "docs" => Ok(Self::Docs),
            "draft" => Ok(Self::Draft),
            "narrowing" => Ok(Self::Narrowing),
            "document" => Ok(Self::Document),
            "physics_golden" => Ok(Self::PhysicsGolden),
            "media" => Ok(Self::Media),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Validity => "validity",
            Self::Command => "command",
            Self::Journey => "journey",
            Self::Review => "review",
            Self::Numbers => "numbers",
            Self::Docs => "docs",
            Self::Draft => "draft",
            Self::Narrowing => "narrowing",
            Self::Document => "document",
            Self::PhysicsGolden => "physics_golden",
            Self::Media => "media",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckOracle {
    Code,
    Model,
    Person,
}

impl Contract for CheckOracle {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "code" => Ok(Self::Code),
            "model" => Ok(Self::Model),
            "person" => Ok(Self::Person),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Code => "code",
            Self::Model => "model",
            Self::Person => "person",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    pub kind: CheckKind,
    pub runner: String,
    pub inputs: Vec<String>,
    pub depth: String,
    pub oracle: CheckOracle,
    pub contract: Option<String>,
}

impl Contract for Check {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "runner", "inputs", "depth", "oracle", "contract"])?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            runner: deep_contracts::required(members, at, "runner")?,
            inputs: deep_contracts::required(members, at, "inputs")?,
            depth: deep_contracts::required(members, at, "depth")?,
            oracle: deep_contracts::required(members, at, "oracle")?,
            contract: deep_contracts::required(members, at, "contract")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("runner".to_string(), self.runner.to_json()));
        members.push(("inputs".to_string(), self.inputs.to_json()));
        members.push(("depth".to_string(), self.depth.to_json()));
        members.push(("oracle".to_string(), self.oracle.to_json()));
        members.push(("contract".to_string(), self.contract.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    UnknownSchema,
    NotJson,
    Type,
    Required,
    UnlistedField,
    Enum,
    Const,
    Pattern,
    Format,
    Length,
    Range,
    Union,
    UncataloguedKind,
    HandleSyntax,
    HandleScheme,
    DigestAlgorithm,
}

impl Contract for ErrorCode {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "unknown_schema" => Ok(Self::UnknownSchema),
            "not_json" => Ok(Self::NotJson),
            "type" => Ok(Self::Type),
            "required" => Ok(Self::Required),
            "unlisted_field" => Ok(Self::UnlistedField),
            "enum" => Ok(Self::Enum),
            "const" => Ok(Self::Const),
            "pattern" => Ok(Self::Pattern),
            "format" => Ok(Self::Format),
            "length" => Ok(Self::Length),
            "range" => Ok(Self::Range),
            "union" => Ok(Self::Union),
            "uncatalogued_kind" => Ok(Self::UncataloguedKind),
            "handle_syntax" => Ok(Self::HandleSyntax),
            "handle_scheme" => Ok(Self::HandleScheme),
            "digest_algorithm" => Ok(Self::DigestAlgorithm),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::UnknownSchema => "unknown_schema",
            Self::NotJson => "not_json",
            Self::Type => "type",
            Self::Required => "required",
            Self::UnlistedField => "unlisted_field",
            Self::Enum => "enum",
            Self::Const => "const",
            Self::Pattern => "pattern",
            Self::Format => "format",
            Self::Length => "length",
            Self::Range => "range",
            Self::Union => "union",
            Self::UncataloguedKind => "uncatalogued_kind",
            Self::HandleSyntax => "handle_syntax",
            Self::HandleScheme => "handle_scheme",
            Self::DigestAlgorithm => "digest_algorithm",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub code: ErrorCode,
    pub retryable: bool,
    pub remediation: String,
    pub path: String,
    pub actual: String,
    pub evidence: Vec<String>,
}

impl Contract for Error {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["code", "retryable", "remediation", "path", "actual", "evidence"])?;
        Ok(Self {
            code: deep_contracts::required(members, at, "code")?,
            retryable: deep_contracts::required(members, at, "retryable")?,
            remediation: deep_contracts::required(members, at, "remediation")?,
            path: deep_contracts::required(members, at, "path")?,
            actual: deep_contracts::required(members, at, "actual")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("code".to_string(), self.code.to_json()));
        members.push(("retryable".to_string(), self.retryable.to_json()));
        members.push(("remediation".to_string(), self.remediation.to_json()));
        members.push(("path".to_string(), self.path.to_json()));
        members.push(("actual".to_string(), self.actual.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardMode {
    Watch,
    Warn,
    Block,
}

impl Contract for GuardMode {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "watch" => Ok(Self::Watch),
            "warn" => Ok(Self::Warn),
            "block" => Ok(Self::Block),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Watch => "watch",
            Self::Warn => "warn",
            Self::Block => "block",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Guard {
    pub r#match: String,
    pub scope: String,
    pub mode: GuardMode,
    pub reason: String,
    pub next_step: String,
    pub fail_closed: bool,
}

impl Contract for Guard {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["match", "scope", "mode", "reason", "next_step", "fail_closed"])?;
        Ok(Self {
            r#match: deep_contracts::required(members, at, "match")?,
            scope: deep_contracts::required(members, at, "scope")?,
            mode: deep_contracts::required(members, at, "mode")?,
            reason: deep_contracts::required(members, at, "reason")?,
            next_step: deep_contracts::required(members, at, "next_step")?,
            fail_closed: deep_contracts::required(members, at, "fail_closed")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("match".to_string(), self.r#match.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("mode".to_string(), self.mode.to_json()));
        members.push(("reason".to_string(), self.reason.to_json()));
        members.push(("next_step".to_string(), self.next_step.to_json()));
        members.push(("fail_closed".to_string(), self.fail_closed.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookAck {
    pub ack: String,
    pub hold_until_ms: Option<i64>,
}

impl Contract for HookAck {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["ack", "hold_until_ms"])?;
        Ok(Self {
            ack: deep_contracts::required(members, at, "ack")?,
            hold_until_ms: deep_contracts::required(members, at, "hold_until_ms")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("ack".to_string(), self.ack.to_json()));
        members.push(("hold_until_ms".to_string(), self.hold_until_ms.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookJoinedDeniesItem {
    pub extension: String,
    pub reason: String,
}

impl Contract for HookJoinedDeniesItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["extension", "reason"])?;
        Ok(Self {
            extension: deep_contracts::required(members, at, "extension")?,
            reason: deep_contracts::required(members, at, "reason")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("extension".to_string(), self.extension.to_json()));
        members.push(("reason".to_string(), self.reason.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookJoinedContextItem {
    pub extension: String,
    pub text: String,
}

impl Contract for HookJoinedContextItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["extension", "text"])?;
        Ok(Self {
            extension: deep_contracts::required(members, at, "extension")?,
            text: deep_contracts::required(members, at, "text")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("extension".to_string(), self.extension.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookJoined {
    pub order: Vec<String>,
    pub bound: i64,
    pub denies: Vec<HookJoinedDeniesItem>,
    pub context: Vec<HookJoinedContextItem>,
}

impl Contract for HookJoined {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["order", "bound", "denies", "context"])?;
        Ok(Self {
            order: deep_contracts::required(members, at, "order")?,
            bound: deep_contracts::required(members, at, "bound")?,
            denies: deep_contracts::required(members, at, "denies")?,
            context: deep_contracts::required(members, at, "context")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("order".to_string(), self.order.to_json()));
        members.push(("bound".to_string(), self.bound.to_json()));
        members.push(("denies".to_string(), self.denies.to_json()));
        members.push(("context".to_string(), self.context.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookReply {
    pub exit: i64,
    pub stdout: String,
    pub stderr: String,
}

impl Contract for HookReply {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["exit", "stdout", "stderr"])?;
        Ok(Self {
            exit: deep_contracts::required(members, at, "exit")?,
            stdout: deep_contracts::required(members, at, "stdout")?,
            stderr: deep_contracts::required(members, at, "stderr")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("exit".to_string(), self.exit.to_json()));
        members.push(("stdout".to_string(), self.stdout.to_json()));
        members.push(("stderr".to_string(), self.stderr.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookRequestV;

impl Contract for HookRequestV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookRequest {
    pub v: HookRequestV,
    pub agent: String,
    pub event: String,
    pub seq: deep_contracts::Seq,
    pub id: String,
    pub pid: i64,
    pub ppid: i64,
    pub matched: Vec<String>,
    pub payload: deep_contracts::Value,
}

impl Contract for HookRequest {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "agent", "event", "seq", "id", "pid", "ppid", "matched", "payload"])?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            agent: deep_contracts::required(members, at, "agent")?,
            event: deep_contracts::required(members, at, "event")?,
            seq: deep_contracts::required(members, at, "seq")?,
            id: deep_contracts::required(members, at, "id")?,
            pid: deep_contracts::required(members, at, "pid")?,
            ppid: deep_contracts::required(members, at, "ppid")?,
            matched: deep_contracts::required(members, at, "matched")?,
            payload: deep_contracts::required(members, at, "payload")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("agent".to_string(), self.agent.to_json()));
        members.push(("event".to_string(), self.event.to_json()));
        members.push(("seq".to_string(), self.seq.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("pid".to_string(), self.pid.to_json()));
        members.push(("ppid".to_string(), self.ppid.to_json()));
        members.push(("matched".to_string(), self.matched.to_json()));
        members.push(("payload".to_string(), self.payload.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictRequirementOutcome {
    Pass,
    Fail,
    Invalid,
    Blocked,
    Inconclusive,
    Pending,
}

impl Contract for VerdictRequirementOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "PASS" => Ok(Self::Pass),
            "FAIL" => Ok(Self::Fail),
            "INVALID" => Ok(Self::Invalid),
            "BLOCKED" => Ok(Self::Blocked),
            "INCONCLUSIVE" => Ok(Self::Inconclusive),
            "pending" => Ok(Self::Pending),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::Invalid => "INVALID",
            Self::Blocked => "BLOCKED",
            Self::Inconclusive => "INCONCLUSIVE",
            Self::Pending => "pending",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictRequirementOracle {
    Code,
    Model,
    Person,
}

impl Contract for VerdictRequirementOracle {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "code" => Ok(Self::Code),
            "model" => Ok(Self::Model),
            "person" => Ok(Self::Person),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Code => "code",
            Self::Model => "model",
            Self::Person => "person",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictRequirementRuns {
    pub clean: i64,
    pub needed: i64,
    pub counted: Vec<String>,
}

impl Contract for VerdictRequirementRuns {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["clean", "needed", "counted"])?;
        Ok(Self {
            clean: deep_contracts::required(members, at, "clean")?,
            needed: deep_contracts::required(members, at, "needed")?,
            counted: deep_contracts::required(members, at, "counted")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("clean".to_string(), self.clean.to_json()));
        members.push(("needed".to_string(), self.needed.to_json()));
        members.push(("counted".to_string(), self.counted.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictRequirementProof {
    Statement,
    StaticCheck,
    TestRun,
    Journey,
    Decision,
}

impl Contract for VerdictRequirementProof {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "statement" => Ok(Self::Statement),
            "static_check" => Ok(Self::StaticCheck),
            "test_run" => Ok(Self::TestRun),
            "journey" => Ok(Self::Journey),
            "decision" => Ok(Self::Decision),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Statement => "statement",
            Self::StaticCheck => "static_check",
            Self::TestRun => "test_run",
            Self::Journey => "journey",
            Self::Decision => "decision",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictRequirement {
    pub req: String,
    pub outcome: VerdictRequirementOutcome,
    pub check: String,
    pub depth: String,
    pub oracle: VerdictRequirementOracle,
    pub runs: VerdictRequirementRuns,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub evidence: Vec<String>,
    pub proof: VerdictRequirementProof,
    pub ask: Option<String>,
}

impl Contract for VerdictRequirement {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["req", "outcome", "check", "depth", "oracle", "runs", "smallest", "points_to", "evidence", "proof", "ask"])?;
        Ok(Self {
            req: deep_contracts::required(members, at, "req")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            check: deep_contracts::required(members, at, "check")?,
            depth: deep_contracts::required(members, at, "depth")?,
            oracle: deep_contracts::required(members, at, "oracle")?,
            runs: deep_contracts::required(members, at, "runs")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            proof: deep_contracts::required(members, at, "proof")?,
            ask: deep_contracts::optional(members, at, "ask")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("req".to_string(), self.req.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("check".to_string(), self.check.to_json()));
        members.push(("depth".to_string(), self.depth.to_json()));
        members.push(("oracle".to_string(), self.oracle.to_json()));
        members.push(("runs".to_string(), self.runs.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("proof".to_string(), self.proof.to_json()));
        if let Some(value) = &self.ask {
            members.push(("ask".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictPassedOutcome;

impl Contract for VerdictPassedOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"PASS\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"PASS\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictPassedOracle {
    Code,
    Model,
    Person,
}

impl Contract for VerdictPassedOracle {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "code" => Ok(Self::Code),
            "model" => Ok(Self::Model),
            "person" => Ok(Self::Person),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Code => "code",
            Self::Model => "model",
            Self::Person => "person",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictPassedRuns {
    pub clean: i64,
    pub needed: i64,
    pub counted: Vec<String>,
}

impl Contract for VerdictPassedRuns {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["clean", "needed", "counted"])?;
        Ok(Self {
            clean: deep_contracts::required(members, at, "clean")?,
            needed: deep_contracts::required(members, at, "needed")?,
            counted: deep_contracts::required(members, at, "counted")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("clean".to_string(), self.clean.to_json()));
        members.push(("needed".to_string(), self.needed.to_json()));
        members.push(("counted".to_string(), self.counted.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictPassedProof {
    Statement,
    StaticCheck,
    TestRun,
    Journey,
    Decision,
}

impl Contract for VerdictPassedProof {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "statement" => Ok(Self::Statement),
            "static_check" => Ok(Self::StaticCheck),
            "test_run" => Ok(Self::TestRun),
            "journey" => Ok(Self::Journey),
            "decision" => Ok(Self::Decision),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Statement => "statement",
            Self::StaticCheck => "static_check",
            Self::TestRun => "test_run",
            Self::Journey => "journey",
            Self::Decision => "decision",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictPassed {
    pub req: String,
    pub outcome: VerdictPassedOutcome,
    pub check: String,
    pub depth: String,
    pub oracle: VerdictPassedOracle,
    pub runs: VerdictPassedRuns,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub evidence: Vec<String>,
    pub proof: VerdictPassedProof,
    pub ask: Option<String>,
}

impl Contract for VerdictPassed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["req", "outcome", "check", "depth", "oracle", "runs", "smallest", "points_to", "evidence", "proof", "ask"])?;
        Ok(Self {
            req: deep_contracts::required(members, at, "req")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            check: deep_contracts::required(members, at, "check")?,
            depth: deep_contracts::required(members, at, "depth")?,
            oracle: deep_contracts::required(members, at, "oracle")?,
            runs: deep_contracts::required(members, at, "runs")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            proof: deep_contracts::required(members, at, "proof")?,
            ask: deep_contracts::optional(members, at, "ask")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("req".to_string(), self.req.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("check".to_string(), self.check.to_json()));
        members.push(("depth".to_string(), self.depth.to_json()));
        members.push(("oracle".to_string(), self.oracle.to_json()));
        members.push(("runs".to_string(), self.runs.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("proof".to_string(), self.proof.to_json()));
        if let Some(value) = &self.ask {
            members.push(("ask".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictKey {
    pub commit: String,
    pub doc_revisions: Vec<String>,
    pub check_digests: Vec<String>,
    pub state_digests: Vec<String>,
    pub environment: String,
    pub tools: Vec<String>,
}

impl Contract for VerdictKey {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["commit", "doc_revisions", "check_digests", "state_digests", "environment", "tools"])?;
        Ok(Self {
            commit: deep_contracts::required(members, at, "commit")?,
            doc_revisions: deep_contracts::required(members, at, "doc_revisions")?,
            check_digests: deep_contracts::required(members, at, "check_digests")?,
            state_digests: deep_contracts::required(members, at, "state_digests")?,
            environment: deep_contracts::required(members, at, "environment")?,
            tools: deep_contracts::required(members, at, "tools")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("doc_revisions".to_string(), self.doc_revisions.to_json()));
        members.push(("check_digests".to_string(), self.check_digests.to_json()));
        members.push(("state_digests".to_string(), self.state_digests.to_json()));
        members.push(("environment".to_string(), self.environment.to_json()));
        members.push(("tools".to_string(), self.tools.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictPassOutcome;

impl Contract for VerdictPassOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"PASS\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"PASS\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictPass {
    pub verdict: String,
    pub claim: String,
    pub outcome: VerdictPassOutcome,
    pub reasons: Vec<String>,
    pub requirements: Vec<VerdictPassed>,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictKey,
    pub checkout: String,
}

impl Contract for VerdictPass {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["verdict", "claim", "outcome", "reasons", "requirements", "smallest", "points_to", "commit", "key", "checkout"])?;
        Ok(Self {
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
            checkout: deep_contracts::required(members, at, "checkout")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("checkout".to_string(), self.checkout.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictFailOutcome;

impl Contract for VerdictFailOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"FAIL\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"FAIL\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictFail {
    pub verdict: String,
    pub claim: String,
    pub outcome: VerdictFailOutcome,
    pub reasons: Vec<String>,
    pub requirements: Vec<VerdictRequirement>,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictKey,
    pub checkout: String,
}

impl Contract for VerdictFail {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["verdict", "claim", "outcome", "reasons", "requirements", "smallest", "points_to", "commit", "key", "checkout"])?;
        Ok(Self {
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
            checkout: deep_contracts::required(members, at, "checkout")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("checkout".to_string(), self.checkout.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictInvalidOutcome;

impl Contract for VerdictInvalidOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"INVALID\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"INVALID\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictInvalid {
    pub verdict: String,
    pub claim: String,
    pub outcome: VerdictInvalidOutcome,
    pub reasons: Vec<String>,
    pub requirements: Vec<VerdictRequirement>,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictKey,
    pub checkout: String,
}

impl Contract for VerdictInvalid {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["verdict", "claim", "outcome", "reasons", "requirements", "smallest", "points_to", "commit", "key", "checkout"])?;
        Ok(Self {
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
            checkout: deep_contracts::required(members, at, "checkout")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("checkout".to_string(), self.checkout.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictBlockedOutcome;

impl Contract for VerdictBlockedOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"BLOCKED\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"BLOCKED\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictBlocked {
    pub verdict: String,
    pub claim: String,
    pub outcome: VerdictBlockedOutcome,
    pub reasons: Vec<String>,
    pub requirements: Vec<VerdictRequirement>,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictKey,
    pub checkout: String,
}

impl Contract for VerdictBlocked {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["verdict", "claim", "outcome", "reasons", "requirements", "smallest", "points_to", "commit", "key", "checkout"])?;
        Ok(Self {
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
            checkout: deep_contracts::required(members, at, "checkout")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("checkout".to_string(), self.checkout.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictInconclusiveOutcome;

impl Contract for VerdictInconclusiveOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"INCONCLUSIVE\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"INCONCLUSIVE\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictInconclusive {
    pub verdict: String,
    pub claim: String,
    pub outcome: VerdictInconclusiveOutcome,
    pub reasons: Vec<String>,
    pub requirements: Vec<VerdictRequirement>,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictKey,
    pub checkout: String,
}

impl Contract for VerdictInconclusive {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["verdict", "claim", "outcome", "reasons", "requirements", "smallest", "points_to", "commit", "key", "checkout"])?;
        Ok(Self {
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
            checkout: deep_contracts::required(members, at, "checkout")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("checkout".to_string(), self.checkout.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    Pass(VerdictPass),
    Fail(VerdictFail),
    Invalid(VerdictInvalid),
    Blocked(VerdictBlocked),
    Inconclusive(VerdictInconclusive),
}

impl Contract for Verdict {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::tag(value, at, "outcome")?.as_str() {
            "\"PASS\"" => Ok(Self::Pass(<VerdictPass as Contract>::from_json(value, at)?)),
            "\"FAIL\"" => Ok(Self::Fail(<VerdictFail as Contract>::from_json(value, at)?)),
            "\"INVALID\"" => Ok(Self::Invalid(<VerdictInvalid as Contract>::from_json(value, at)?)),
            "\"BLOCKED\"" => Ok(Self::Blocked(<VerdictBlocked as Contract>::from_json(value, at)?)),
            "\"INCONCLUSIVE\"" => Ok(Self::Inconclusive(<VerdictInconclusive as Contract>::from_json(value, at)?)),
            other => Err(format!("{at}{}: {other} is not a listed tag", "/outcome")),
        }
    }
    fn to_json(&self) -> Value {
        match self {
            Self::Pass(inner) => inner.to_json(),
            Self::Fail(inner) => inner.to_json(),
            Self::Invalid(inner) => inner.to_json(),
            Self::Blocked(inner) => inner.to_json(),
            Self::Inconclusive(inner) => inner.to_json(),
        }
    }
}

/// Decodes `json` into the generated type for `schema` and returns its RFC 8785 text.
pub fn roundtrip(schema: &str, json: &str) -> Result<String, String> {
    let value = deep_contracts::parse(json)?;
    let typed = match schema {
        "check@1" => <Check as Contract>::from_json(&value, "")?.to_json(),
        "error@1" => <Error as Contract>::from_json(&value, "")?.to_json(),
        "guard@1" => <Guard as Contract>::from_json(&value, "")?.to_json(),
        "hook.ack@1" => <HookAck as Contract>::from_json(&value, "")?.to_json(),
        "hook.joined@1" => <HookJoined as Contract>::from_json(&value, "")?.to_json(),
        "hook.reply@1" => <HookReply as Contract>::from_json(&value, "")?.to_json(),
        "hook.request@1" => <HookRequest as Contract>::from_json(&value, "")?.to_json(),
        "verdict@1" => <Verdict as Contract>::from_json(&value, "")?.to_json(),
        _ => return Err(format!("no generated type for {schema}")),
    };
    Ok(deep_contracts::jcs(&typed))
}
