// Generated from packages/contracts/schemas by generateRust. Do not edit.
use deep_contracts::{Contract, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct ActionEnteredV;

impl Contract for ActionEnteredV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

static RULE_0: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: Some(deep_contracts::Format::Ulid), pattern: None };

#[derive(Debug, Clone, PartialEq)]
pub struct ActionEnteredKind;

impl Contract for ActionEnteredKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"action.entered\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"action.entered\"").expect("a constant is JSON")
    }
}

static PATTERN_1: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 6),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(7, 11),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(12, 18),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(109, 109)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(19, 27),
    deep_contracts::Inst::Char(&[(118, 118)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(28, 32),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(117, 117)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(33, 37),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(113, 113)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(38, 47),
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(48, 53),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(54, 60),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(61, 69),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(103, 103)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(70, 77),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(78, 82),
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Split(83, 86),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(118, 118)]),
    deep_contracts::Inst::Jmp(93),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(96, 98),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(95),
    deep_contracts::Inst::Split(99, 104),
    deep_contracts::Inst::Char(&[(35, 35)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(102, 104),
    deep_contracts::Inst::Char(&[(45, 46), (48, 57), (65, 90), (95, 95), (97, 122)]),
    deep_contracts::Inst::Jmp(101),
    deep_contracts::Inst::Match,
];

static RULE_2: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_1) };

#[derive(Debug, Clone, PartialEq)]
pub struct ActionEnteredWriter;

impl Contract for ActionEnteredWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

static RULE_3: deep_contracts::Rule = deep_contracts::Rule::String { min: Some(1), max: None, format: None, pattern: None };

static RULE_4: deep_contracts::Rule = deep_contracts::Rule::Number { min: Some(0.0), max: Some(9007199254740991.0) };

static RULE_5: deep_contracts::Rule = deep_contracts::Rule::Number { min: Some(1.0), max: Some(9007199254740991.0) };

static RULE_6: deep_contracts::Rule = deep_contracts::Rule::String { min: Some(1), max: Some(8192), format: None, pattern: None };

#[derive(Debug, Clone, PartialEq)]
pub struct ActionEnteredData {
    pub call: String,
    pub plugin: String,
    pub action: String,
    pub request: String,
    pub input: deep_contracts::Value,
}

impl Contract for ActionEnteredData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["call", "plugin", "action", "request", "input"])?;
        deep_contracts::check_member(members, at, "call", &RULE_6)?;
        deep_contracts::check_member(members, at, "plugin", &RULE_6)?;
        deep_contracts::check_member(members, at, "action", &RULE_6)?;
        deep_contracts::check_member(members, at, "request", &RULE_6)?;
        Ok(Self {
            call: deep_contracts::required(members, at, "call")?,
            plugin: deep_contracts::required(members, at, "plugin")?,
            action: deep_contracts::required(members, at, "action")?,
            request: deep_contracts::required(members, at, "request")?,
            input: deep_contracts::required(members, at, "input")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("call".to_string(), self.call.to_json()));
        members.push(("plugin".to_string(), self.plugin.to_json()));
        members.push(("action".to_string(), self.action.to_json()));
        members.push(("request".to_string(), self.request.to_json()));
        members.push(("input".to_string(), self.input.to_json()));
        Value::Object(members)
    }
}

static PATTERN_7: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Match,
];

static RULE_8: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_7) };

static RULE_9: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_8) };

#[derive(Debug, Clone, PartialEq)]
pub struct ActionEntered {
    pub v: ActionEnteredV,
    pub id: String,
    pub kind: ActionEnteredKind,
    pub subject: Option<String>,
    pub writer: ActionEnteredWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ActionEnteredData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ActionEntered {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionReportedV;

impl Contract for ActionReportedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionReportedKind;

impl Contract for ActionReportedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"action.reported\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"action.reported\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionReportedWriter;

impl Contract for ActionReportedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

static RULE_10: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_6) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionReportedDataVerified {
    True,
    False,
    Unverified,
}

impl Contract for ActionReportedDataVerified {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "true" => Ok(Self::True),
            "false" => Ok(Self::False),
            "unverified" => Ok(Self::Unverified),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::True => "true",
            Self::False => "false",
            Self::Unverified => "unverified",
        }.to_string())
    }
}

static RULE_11: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_6);

static RULE_12: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: None };

static RULE_13: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_12);

#[derive(Debug, Clone, PartialEq)]
pub struct ActionReportedData {
    pub call: String,
    pub changed: Vec<String>,
    pub verified: ActionReportedDataVerified,
    pub checked: Option<String>,
    pub error: Option<String>,
}

impl Contract for ActionReportedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["call", "changed", "verified", "checked", "error"])?;
        deep_contracts::check_member(members, at, "call", &RULE_6)?;
        deep_contracts::check_member(members, at, "changed", &RULE_10)?;
        deep_contracts::check_member(members, at, "checked", &RULE_11)?;
        deep_contracts::check_member(members, at, "error", &RULE_13)?;
        Ok(Self {
            call: deep_contracts::required(members, at, "call")?,
            changed: deep_contracts::required(members, at, "changed")?,
            verified: deep_contracts::required(members, at, "verified")?,
            checked: deep_contracts::required(members, at, "checked")?,
            error: deep_contracts::required(members, at, "error")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("call".to_string(), self.call.to_json()));
        members.push(("changed".to_string(), self.changed.to_json()));
        members.push(("verified".to_string(), self.verified.to_json()));
        members.push(("checked".to_string(), self.checked.to_json()));
        members.push(("error".to_string(), self.error.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActionReported {
    pub v: ActionReportedV,
    pub id: String,
    pub kind: ActionReportedKind,
    pub subject: Option<String>,
    pub writer: ActionReportedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ActionReportedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ActionReported {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentStopV;

impl Contract for AgentStopV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentStopKind;

impl Contract for AgentStopKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"agent.stop\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"agent.stop\"").expect("a constant is JSON")
    }
}

static PATTERN_14: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(10, 12),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(9),
    deep_contracts::Inst::Match,
];

static RULE_15: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_14) };

static PATTERN_16: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 6),
    deep_contracts::Inst::Char(&[(104, 104)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Jmp(30),
    deep_contracts::Inst::Split(7, 11),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Jmp(30),
    deep_contracts::Inst::Split(12, 16),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Jmp(30),
    deep_contracts::Inst::Split(17, 22),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Jmp(30),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(120, 120)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Split(28, 30),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Jmp(27),
    deep_contracts::Inst::Match,
];

static RULE_17: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_16) };

#[derive(Debug, Clone, PartialEq)]
pub struct AgentStopData {
    pub turn: i64,
    pub did_work: bool,
}

impl Contract for AgentStopData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["turn", "did_work"])?;
        deep_contracts::check_member(members, at, "turn", &RULE_4)?;
        Ok(Self {
            turn: deep_contracts::required(members, at, "turn")?,
            did_work: deep_contracts::required(members, at, "did_work")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("turn".to_string(), self.turn.to_json()));
        members.push(("did_work".to_string(), self.did_work.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentStop {
    pub v: AgentStopV,
    pub id: String,
    pub kind: AgentStopKind,
    pub subject: String,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AgentStopData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AgentStop {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_15)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnsweredV;

impl Contract for AskAnsweredV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnsweredKind;

impl Contract for AskAnsweredKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.answered\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.answered\"").expect("a constant is JSON")
    }
}

static PATTERN_18: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(6, 8),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(5),
    deep_contracts::Inst::Match,
];

static RULE_19: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_18) };

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnsweredWriter;

impl Contract for AskAnsweredWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

static RULE_20: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_7) };

static RULE_21: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskAnsweredDataDecision {
    Allow,
    Deny,
    None,
}

impl Contract for AskAnsweredDataDecision {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "allow" => Ok(Self::Allow),
            "deny" => Ok(Self::Deny),
            "none" => Ok(Self::None),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::None => "none",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnsweredData {
    pub answer: String,
    pub plan_hash: Option<String>,
    pub decision: AskAnsweredDataDecision,
}

impl Contract for AskAnsweredData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["answer", "plan_hash", "decision"])?;
        deep_contracts::check_member(members, at, "answer", &RULE_6)?;
        deep_contracts::check_member(members, at, "plan_hash", &RULE_21)?;
        Ok(Self {
            answer: deep_contracts::required(members, at, "answer")?,
            plan_hash: deep_contracts::required(members, at, "plan_hash")?,
            decision: deep_contracts::required(members, at, "decision")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("answer".to_string(), self.answer.to_json()));
        members.push(("plan_hash".to_string(), self.plan_hash.to_json()));
        members.push(("decision".to_string(), self.decision.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskAnswered {
    pub v: AskAnsweredV,
    pub id: String,
    pub kind: AskAnsweredKind,
    pub subject: String,
    pub writer: AskAnsweredWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskAnsweredData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskAnswered {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_19)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskBatchedV;

impl Contract for AskBatchedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskBatchedKind;

impl Contract for AskBatchedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.batched\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.batched\"").expect("a constant is JSON")
    }
}

static RULE_22: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_18) };

#[derive(Debug, Clone, PartialEq)]
pub struct AskBatchedDataAsksItem {
    pub ask: String,
    pub plan_hash: Option<String>,
}

impl Contract for AskBatchedDataAsksItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["ask", "plan_hash"])?;
        deep_contracts::check_member(members, at, "ask", &RULE_22)?;
        deep_contracts::check_member(members, at, "plan_hash", &RULE_21)?;
        Ok(Self {
            ask: deep_contracts::required(members, at, "ask")?,
            plan_hash: deep_contracts::required(members, at, "plan_hash")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("ask".to_string(), self.ask.to_json()));
        members.push(("plan_hash".to_string(), self.plan_hash.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskBatchedData {
    pub batch: String,
    pub asks: Vec<AskBatchedDataAsksItem>,
}

impl Contract for AskBatchedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["batch", "asks"])?;
        deep_contracts::check_member(members, at, "batch", &RULE_6)?;
        Ok(Self {
            batch: deep_contracts::required(members, at, "batch")?,
            asks: deep_contracts::required(members, at, "asks")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("batch".to_string(), self.batch.to_json()));
        members.push(("asks".to_string(), self.asks.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskBatched {
    pub v: AskBatchedV,
    pub id: String,
    pub kind: AskBatchedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskBatchedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskBatched {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCancelledV;

impl Contract for AskCancelledV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCancelledKind;

impl Contract for AskCancelledKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.cancelled\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.cancelled\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskCancelledDataDecision {
    Allow,
    Deny,
    None,
}

impl Contract for AskCancelledDataDecision {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "allow" => Ok(Self::Allow),
            "deny" => Ok(Self::Deny),
            "none" => Ok(Self::None),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::None => "none",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCancelledData {
    pub answer: String,
    pub plan_hash: Option<String>,
    pub decision: AskCancelledDataDecision,
}

impl Contract for AskCancelledData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["answer", "plan_hash", "decision"])?;
        deep_contracts::check_member(members, at, "answer", &RULE_6)?;
        deep_contracts::check_member(members, at, "plan_hash", &RULE_21)?;
        Ok(Self {
            answer: deep_contracts::required(members, at, "answer")?,
            plan_hash: deep_contracts::required(members, at, "plan_hash")?,
            decision: deep_contracts::required(members, at, "decision")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("answer".to_string(), self.answer.to_json()));
        members.push(("plan_hash".to_string(), self.plan_hash.to_json()));
        members.push(("decision".to_string(), self.decision.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCancelled {
    pub v: AskCancelledV,
    pub id: String,
    pub kind: AskCancelledKind,
    pub subject: String,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskCancelledData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskCancelled {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_19)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedPinnedToCommitKind;

impl Contract for AskCreatedPinnedToCommitKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"commit\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"commit\"").expect("a constant is JSON")
    }
}

static PATTERN_23: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Match,
];

static RULE_24: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_23) };

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedPinnedToCommit {
    pub kind: AskCreatedPinnedToCommitKind,
    pub r#ref: String,
}

impl Contract for AskCreatedPinnedToCommit {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "ref"])?;
        deep_contracts::check_member(members, at, "ref", &RULE_24)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            r#ref: deep_contracts::required(members, at, "ref")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("ref".to_string(), self.r#ref.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedPinnedToDocRevisionKind;

impl Contract for AskCreatedPinnedToDocRevisionKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"doc_revision\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"doc_revision\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedPinnedToDocRevision {
    pub kind: AskCreatedPinnedToDocRevisionKind,
    pub r#ref: String,
}

impl Contract for AskCreatedPinnedToDocRevision {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "ref"])?;
        deep_contracts::check_member(members, at, "ref", &RULE_6)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            r#ref: deep_contracts::required(members, at, "ref")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("ref".to_string(), self.r#ref.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedPinnedToEvidenceKind;

impl Contract for AskCreatedPinnedToEvidenceKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"evidence\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"evidence\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedPinnedToEvidence {
    pub kind: AskCreatedPinnedToEvidenceKind,
    pub r#ref: String,
}

impl Contract for AskCreatedPinnedToEvidence {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "ref"])?;
        deep_contracts::check_member(members, at, "ref", &RULE_20)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            r#ref: deep_contracts::required(members, at, "ref")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("ref".to_string(), self.r#ref.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AskCreatedPinnedTo {
    Commit(AskCreatedPinnedToCommit),
    DocRevision(AskCreatedPinnedToDocRevision),
    Evidence(AskCreatedPinnedToEvidence),
}

impl Contract for AskCreatedPinnedTo {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::tag(value, at, "kind")?.as_str() {
            "\"commit\"" => Ok(Self::Commit(<AskCreatedPinnedToCommit as Contract>::from_json(value, at)?)),
            "\"doc_revision\"" => Ok(Self::DocRevision(<AskCreatedPinnedToDocRevision as Contract>::from_json(value, at)?)),
            "\"evidence\"" => Ok(Self::Evidence(<AskCreatedPinnedToEvidence as Contract>::from_json(value, at)?)),
            other => Err(format!("{at}{}: {other} is not a listed tag", "/kind")),
        }
    }
    fn to_json(&self) -> Value {
        match self {
            Self::Commit(inner) => inner.to_json(),
            Self::DocRevision(inner) => inner.to_json(),
            Self::Evidence(inner) => inner.to_json(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskCreatedOptionsItemDecision {
    Allow,
    Deny,
    None,
}

impl Contract for AskCreatedOptionsItemDecision {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "allow" => Ok(Self::Allow),
            "deny" => Ok(Self::Deny),
            "none" => Ok(Self::None),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::None => "none",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedOptionsItem {
    pub id: String,
    pub label: String,
    pub decision: AskCreatedOptionsItemDecision,
}

impl Contract for AskCreatedOptionsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["id", "label", "decision"])?;
        deep_contracts::check_member(members, at, "id", &RULE_6)?;
        deep_contracts::check_member(members, at, "label", &RULE_6)?;
        Ok(Self {
            id: deep_contracts::required(members, at, "id")?,
            label: deep_contracts::required(members, at, "label")?,
            decision: deep_contracts::required(members, at, "decision")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("label".to_string(), self.label.to_json()));
        members.push(("decision".to_string(), self.decision.to_json()));
        Value::Object(members)
    }
}

pub type AskCreatedOptions = Vec<AskCreatedOptionsItem>;

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedV;

impl Contract for AskCreatedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedKind;

impl Contract for AskCreatedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.created\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.created\"").expect("a constant is JSON")
    }
}

static PATTERN_25: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 6),
    deep_contracts::Inst::Char(&[(104, 104)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Jmp(40),
    deep_contracts::Inst::Split(7, 11),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Jmp(40),
    deep_contracts::Inst::Split(12, 16),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Jmp(40),
    deep_contracts::Inst::Split(17, 22),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Jmp(40),
    deep_contracts::Inst::Split(23, 32),
    deep_contracts::Inst::Char(&[(109, 109)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Split(29, 31),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Jmp(28),
    deep_contracts::Inst::Jmp(40),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(120, 120)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Split(38, 40),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Jmp(37),
    deep_contracts::Inst::Match,
];

static RULE_26: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_25) };

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataAuthorityKind;

impl Contract for AskCreatedDataAuthorityKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"authority\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"authority\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataAuthority {
    pub kind: AskCreatedDataAuthorityKind,
    pub question: String,
    pub options: AskCreatedOptions,
    pub recommended: Option<String>,
    pub deadline: i64,
    pub fallback: String,
    pub default: String,
    pub provisional: bool,
    pub owner: String,
    pub key: String,
    pub pinned_to: AskCreatedPinnedTo,
}

impl Contract for AskCreatedDataAuthority {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "question", "options", "recommended", "deadline", "fallback", "default", "provisional", "owner", "key", "pinned_to"])?;
        deep_contracts::check_member(members, at, "question", &RULE_6)?;
        deep_contracts::check_member(members, at, "recommended", &RULE_11)?;
        deep_contracts::check_member(members, at, "deadline", &RULE_4)?;
        deep_contracts::check_member(members, at, "fallback", &RULE_6)?;
        deep_contracts::check_member(members, at, "default", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            question: deep_contracts::required(members, at, "question")?,
            options: deep_contracts::required(members, at, "options")?,
            recommended: deep_contracts::required(members, at, "recommended")?,
            deadline: deep_contracts::required(members, at, "deadline")?,
            fallback: deep_contracts::required(members, at, "fallback")?,
            default: deep_contracts::required(members, at, "default")?,
            provisional: deep_contracts::required(members, at, "provisional")?,
            owner: deep_contracts::required(members, at, "owner")?,
            key: deep_contracts::required(members, at, "key")?,
            pinned_to: deep_contracts::required(members, at, "pinned_to")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("question".to_string(), self.question.to_json()));
        members.push(("options".to_string(), self.options.to_json()));
        members.push(("recommended".to_string(), self.recommended.to_json()));
        members.push(("deadline".to_string(), self.deadline.to_json()));
        members.push(("fallback".to_string(), self.fallback.to_json()));
        members.push(("default".to_string(), self.default.to_json()));
        members.push(("provisional".to_string(), self.provisional.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("pinned_to".to_string(), self.pinned_to.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataUnblockKind;

impl Contract for AskCreatedDataUnblockKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"unblock\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"unblock\"").expect("a constant is JSON")
    }
}

static RULE_27: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_1) };

static RULE_28: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_27) };

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataUnblock {
    pub kind: AskCreatedDataUnblockKind,
    pub question: String,
    pub options: AskCreatedOptions,
    pub recommended: Option<String>,
    pub deadline: i64,
    pub fallback: String,
    pub default: String,
    pub provisional: bool,
    pub owner: String,
    pub key: String,
    pub pinned_to: AskCreatedPinnedTo,
    pub steps: Vec<String>,
    pub r#where: String,
    pub why: String,
    pub unblocks: Vec<String>,
    pub proves: String,
}

impl Contract for AskCreatedDataUnblock {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "question", "options", "recommended", "deadline", "fallback", "default", "provisional", "owner", "key", "pinned_to", "steps", "where", "why", "unblocks", "proves"])?;
        deep_contracts::check_member(members, at, "question", &RULE_6)?;
        deep_contracts::check_member(members, at, "recommended", &RULE_11)?;
        deep_contracts::check_member(members, at, "deadline", &RULE_4)?;
        deep_contracts::check_member(members, at, "fallback", &RULE_6)?;
        deep_contracts::check_member(members, at, "default", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        deep_contracts::check_member(members, at, "steps", &RULE_10)?;
        deep_contracts::check_member(members, at, "where", &RULE_6)?;
        deep_contracts::check_member(members, at, "why", &RULE_6)?;
        deep_contracts::check_member(members, at, "unblocks", &RULE_28)?;
        deep_contracts::check_member(members, at, "proves", &RULE_6)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            question: deep_contracts::required(members, at, "question")?,
            options: deep_contracts::required(members, at, "options")?,
            recommended: deep_contracts::required(members, at, "recommended")?,
            deadline: deep_contracts::required(members, at, "deadline")?,
            fallback: deep_contracts::required(members, at, "fallback")?,
            default: deep_contracts::required(members, at, "default")?,
            provisional: deep_contracts::required(members, at, "provisional")?,
            owner: deep_contracts::required(members, at, "owner")?,
            key: deep_contracts::required(members, at, "key")?,
            pinned_to: deep_contracts::required(members, at, "pinned_to")?,
            steps: deep_contracts::required(members, at, "steps")?,
            r#where: deep_contracts::required(members, at, "where")?,
            why: deep_contracts::required(members, at, "why")?,
            unblocks: deep_contracts::required(members, at, "unblocks")?,
            proves: deep_contracts::required(members, at, "proves")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("question".to_string(), self.question.to_json()));
        members.push(("options".to_string(), self.options.to_json()));
        members.push(("recommended".to_string(), self.recommended.to_json()));
        members.push(("deadline".to_string(), self.deadline.to_json()));
        members.push(("fallback".to_string(), self.fallback.to_json()));
        members.push(("default".to_string(), self.default.to_json()));
        members.push(("provisional".to_string(), self.provisional.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("pinned_to".to_string(), self.pinned_to.to_json()));
        members.push(("steps".to_string(), self.steps.to_json()));
        members.push(("where".to_string(), self.r#where.to_json()));
        members.push(("why".to_string(), self.why.to_json()));
        members.push(("unblocks".to_string(), self.unblocks.to_json()));
        members.push(("proves".to_string(), self.proves.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataTasteKind;

impl Contract for AskCreatedDataTasteKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"taste\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"taste\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataTaste {
    pub kind: AskCreatedDataTasteKind,
    pub question: String,
    pub options: AskCreatedOptions,
    pub recommended: Option<String>,
    pub deadline: i64,
    pub fallback: String,
    pub default: String,
    pub provisional: bool,
    pub owner: String,
    pub key: String,
    pub pinned_to: AskCreatedPinnedTo,
}

impl Contract for AskCreatedDataTaste {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "question", "options", "recommended", "deadline", "fallback", "default", "provisional", "owner", "key", "pinned_to"])?;
        deep_contracts::check_member(members, at, "question", &RULE_6)?;
        deep_contracts::check_member(members, at, "recommended", &RULE_11)?;
        deep_contracts::check_member(members, at, "deadline", &RULE_4)?;
        deep_contracts::check_member(members, at, "fallback", &RULE_6)?;
        deep_contracts::check_member(members, at, "default", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            question: deep_contracts::required(members, at, "question")?,
            options: deep_contracts::required(members, at, "options")?,
            recommended: deep_contracts::required(members, at, "recommended")?,
            deadline: deep_contracts::required(members, at, "deadline")?,
            fallback: deep_contracts::required(members, at, "fallback")?,
            default: deep_contracts::required(members, at, "default")?,
            provisional: deep_contracts::required(members, at, "provisional")?,
            owner: deep_contracts::required(members, at, "owner")?,
            key: deep_contracts::required(members, at, "key")?,
            pinned_to: deep_contracts::required(members, at, "pinned_to")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("question".to_string(), self.question.to_json()));
        members.push(("options".to_string(), self.options.to_json()));
        members.push(("recommended".to_string(), self.recommended.to_json()));
        members.push(("deadline".to_string(), self.deadline.to_json()));
        members.push(("fallback".to_string(), self.fallback.to_json()));
        members.push(("default".to_string(), self.default.to_json()));
        members.push(("provisional".to_string(), self.provisional.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("pinned_to".to_string(), self.pinned_to.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataExceptionKind;

impl Contract for AskCreatedDataExceptionKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"exception\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"exception\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataException {
    pub kind: AskCreatedDataExceptionKind,
    pub question: String,
    pub options: AskCreatedOptions,
    pub recommended: Option<String>,
    pub deadline: i64,
    pub fallback: String,
    pub default: String,
    pub provisional: bool,
    pub owner: String,
    pub key: String,
    pub pinned_to: AskCreatedPinnedTo,
}

impl Contract for AskCreatedDataException {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "question", "options", "recommended", "deadline", "fallback", "default", "provisional", "owner", "key", "pinned_to"])?;
        deep_contracts::check_member(members, at, "question", &RULE_6)?;
        deep_contracts::check_member(members, at, "recommended", &RULE_11)?;
        deep_contracts::check_member(members, at, "deadline", &RULE_4)?;
        deep_contracts::check_member(members, at, "fallback", &RULE_6)?;
        deep_contracts::check_member(members, at, "default", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            question: deep_contracts::required(members, at, "question")?,
            options: deep_contracts::required(members, at, "options")?,
            recommended: deep_contracts::required(members, at, "recommended")?,
            deadline: deep_contracts::required(members, at, "deadline")?,
            fallback: deep_contracts::required(members, at, "fallback")?,
            default: deep_contracts::required(members, at, "default")?,
            provisional: deep_contracts::required(members, at, "provisional")?,
            owner: deep_contracts::required(members, at, "owner")?,
            key: deep_contracts::required(members, at, "key")?,
            pinned_to: deep_contracts::required(members, at, "pinned_to")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("question".to_string(), self.question.to_json()));
        members.push(("options".to_string(), self.options.to_json()));
        members.push(("recommended".to_string(), self.recommended.to_json()));
        members.push(("deadline".to_string(), self.deadline.to_json()));
        members.push(("fallback".to_string(), self.fallback.to_json()));
        members.push(("default".to_string(), self.default.to_json()));
        members.push(("provisional".to_string(), self.provisional.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("pinned_to".to_string(), self.pinned_to.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataChoiceKind;

impl Contract for AskCreatedDataChoiceKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"choice\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"choice\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataChoice {
    pub kind: AskCreatedDataChoiceKind,
    pub question: String,
    pub options: AskCreatedOptions,
    pub recommended: Option<String>,
    pub deadline: i64,
    pub fallback: String,
    pub default: String,
    pub provisional: bool,
    pub owner: String,
    pub key: String,
    pub pinned_to: AskCreatedPinnedTo,
}

impl Contract for AskCreatedDataChoice {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "question", "options", "recommended", "deadline", "fallback", "default", "provisional", "owner", "key", "pinned_to"])?;
        deep_contracts::check_member(members, at, "question", &RULE_6)?;
        deep_contracts::check_member(members, at, "recommended", &RULE_11)?;
        deep_contracts::check_member(members, at, "deadline", &RULE_4)?;
        deep_contracts::check_member(members, at, "fallback", &RULE_6)?;
        deep_contracts::check_member(members, at, "default", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            question: deep_contracts::required(members, at, "question")?,
            options: deep_contracts::required(members, at, "options")?,
            recommended: deep_contracts::required(members, at, "recommended")?,
            deadline: deep_contracts::required(members, at, "deadline")?,
            fallback: deep_contracts::required(members, at, "fallback")?,
            default: deep_contracts::required(members, at, "default")?,
            provisional: deep_contracts::required(members, at, "provisional")?,
            owner: deep_contracts::required(members, at, "owner")?,
            key: deep_contracts::required(members, at, "key")?,
            pinned_to: deep_contracts::required(members, at, "pinned_to")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("question".to_string(), self.question.to_json()));
        members.push(("options".to_string(), self.options.to_json()));
        members.push(("recommended".to_string(), self.recommended.to_json()));
        members.push(("deadline".to_string(), self.deadline.to_json()));
        members.push(("fallback".to_string(), self.fallback.to_json()));
        members.push(("default".to_string(), self.default.to_json()));
        members.push(("provisional".to_string(), self.provisional.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("pinned_to".to_string(), self.pinned_to.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataDefinitionKind;

impl Contract for AskCreatedDataDefinitionKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"definition\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"definition\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreatedDataDefinition {
    pub kind: AskCreatedDataDefinitionKind,
    pub question: String,
    pub options: AskCreatedOptions,
    pub recommended: Option<String>,
    pub deadline: i64,
    pub fallback: String,
    pub default: String,
    pub provisional: bool,
    pub owner: String,
    pub key: String,
    pub pinned_to: AskCreatedPinnedTo,
}

impl Contract for AskCreatedDataDefinition {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "question", "options", "recommended", "deadline", "fallback", "default", "provisional", "owner", "key", "pinned_to"])?;
        deep_contracts::check_member(members, at, "question", &RULE_6)?;
        deep_contracts::check_member(members, at, "recommended", &RULE_11)?;
        deep_contracts::check_member(members, at, "deadline", &RULE_4)?;
        deep_contracts::check_member(members, at, "fallback", &RULE_6)?;
        deep_contracts::check_member(members, at, "default", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            question: deep_contracts::required(members, at, "question")?,
            options: deep_contracts::required(members, at, "options")?,
            recommended: deep_contracts::required(members, at, "recommended")?,
            deadline: deep_contracts::required(members, at, "deadline")?,
            fallback: deep_contracts::required(members, at, "fallback")?,
            default: deep_contracts::required(members, at, "default")?,
            provisional: deep_contracts::required(members, at, "provisional")?,
            owner: deep_contracts::required(members, at, "owner")?,
            key: deep_contracts::required(members, at, "key")?,
            pinned_to: deep_contracts::required(members, at, "pinned_to")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("question".to_string(), self.question.to_json()));
        members.push(("options".to_string(), self.options.to_json()));
        members.push(("recommended".to_string(), self.recommended.to_json()));
        members.push(("deadline".to_string(), self.deadline.to_json()));
        members.push(("fallback".to_string(), self.fallback.to_json()));
        members.push(("default".to_string(), self.default.to_json()));
        members.push(("provisional".to_string(), self.provisional.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("pinned_to".to_string(), self.pinned_to.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum AskCreatedData {
    Authority(AskCreatedDataAuthority),
    Unblock(AskCreatedDataUnblock),
    Taste(AskCreatedDataTaste),
    Exception(AskCreatedDataException),
    Choice(AskCreatedDataChoice),
    Definition(AskCreatedDataDefinition),
}

impl Contract for AskCreatedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::tag(value, at, "kind")?.as_str() {
            "\"authority\"" => Ok(Self::Authority(<AskCreatedDataAuthority as Contract>::from_json(value, at)?)),
            "\"unblock\"" => Ok(Self::Unblock(<AskCreatedDataUnblock as Contract>::from_json(value, at)?)),
            "\"taste\"" => Ok(Self::Taste(<AskCreatedDataTaste as Contract>::from_json(value, at)?)),
            "\"exception\"" => Ok(Self::Exception(<AskCreatedDataException as Contract>::from_json(value, at)?)),
            "\"choice\"" => Ok(Self::Choice(<AskCreatedDataChoice as Contract>::from_json(value, at)?)),
            "\"definition\"" => Ok(Self::Definition(<AskCreatedDataDefinition as Contract>::from_json(value, at)?)),
            other => Err(format!("{at}{}: {other} is not a listed tag", "/kind")),
        }
    }
    fn to_json(&self) -> Value {
        match self {
            Self::Authority(inner) => inner.to_json(),
            Self::Unblock(inner) => inner.to_json(),
            Self::Taste(inner) => inner.to_json(),
            Self::Exception(inner) => inner.to_json(),
            Self::Choice(inner) => inner.to_json(),
            Self::Definition(inner) => inner.to_json(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskCreated {
    pub v: AskCreatedV,
    pub id: String,
    pub kind: AskCreatedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskCreatedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskCreated {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskDefaultedV;

impl Contract for AskDefaultedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskDefaultedKind;

impl Contract for AskDefaultedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.defaulted\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.defaulted\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskDefaultedWriter;

impl Contract for AskDefaultedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskDefaultedDataDecision {
    Allow,
    Deny,
    None,
}

impl Contract for AskDefaultedDataDecision {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "allow" => Ok(Self::Allow),
            "deny" => Ok(Self::Deny),
            "none" => Ok(Self::None),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::None => "none",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskDefaultedData {
    pub answer: String,
    pub plan_hash: Option<String>,
    pub decision: AskDefaultedDataDecision,
}

impl Contract for AskDefaultedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["answer", "plan_hash", "decision"])?;
        deep_contracts::check_member(members, at, "answer", &RULE_6)?;
        deep_contracts::check_member(members, at, "plan_hash", &RULE_21)?;
        Ok(Self {
            answer: deep_contracts::required(members, at, "answer")?,
            plan_hash: deep_contracts::required(members, at, "plan_hash")?,
            decision: deep_contracts::required(members, at, "decision")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("answer".to_string(), self.answer.to_json()));
        members.push(("plan_hash".to_string(), self.plan_hash.to_json()));
        members.push(("decision".to_string(), self.decision.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskDefaulted {
    pub v: AskDefaultedV,
    pub id: String,
    pub kind: AskDefaultedKind,
    pub subject: String,
    pub writer: AskDefaultedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskDefaultedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskDefaulted {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_19)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskEscalatedV;

impl Contract for AskEscalatedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskEscalatedKind;

impl Contract for AskEscalatedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.escalated\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.escalated\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskEscalatedDataDecision {
    Allow,
    Deny,
    None,
}

impl Contract for AskEscalatedDataDecision {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "allow" => Ok(Self::Allow),
            "deny" => Ok(Self::Deny),
            "none" => Ok(Self::None),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
            Self::None => "none",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskEscalatedData {
    pub answer: String,
    pub plan_hash: Option<String>,
    pub decision: AskEscalatedDataDecision,
}

impl Contract for AskEscalatedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["answer", "plan_hash", "decision"])?;
        deep_contracts::check_member(members, at, "answer", &RULE_6)?;
        deep_contracts::check_member(members, at, "plan_hash", &RULE_21)?;
        Ok(Self {
            answer: deep_contracts::required(members, at, "answer")?,
            plan_hash: deep_contracts::required(members, at, "plan_hash")?,
            decision: deep_contracts::required(members, at, "decision")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("answer".to_string(), self.answer.to_json()));
        members.push(("plan_hash".to_string(), self.plan_hash.to_json()));
        members.push(("decision".to_string(), self.decision.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskEscalated {
    pub v: AskEscalatedV,
    pub id: String,
    pub kind: AskEscalatedKind,
    pub subject: String,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskEscalatedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskEscalated {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_19)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskLaterV;

impl Contract for AskLaterV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskLaterKind;

impl Contract for AskLaterKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"ask.later\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"ask.later\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AskLaterWriter {
    App,
    Cli,
    Core,
}

impl Contract for AskLaterWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "app" => Ok(Self::App),
            "cli" => Ok(Self::Cli),
            "core" => Ok(Self::Core),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::App => "app",
            Self::Cli => "cli",
            Self::Core => "core",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskLaterData {
    pub until: i64,
}

impl Contract for AskLaterData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["until"])?;
        deep_contracts::check_member(members, at, "until", &RULE_4)?;
        Ok(Self {
            until: deep_contracts::required(members, at, "until")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("until".to_string(), self.until.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AskLater {
    pub v: AskLaterV,
    pub id: String,
    pub kind: AskLaterKind,
    pub subject: String,
    pub writer: AskLaterWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: AskLaterData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for AskLater {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_19)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

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

static RULE_29: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_3) };

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

static RULE_30: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_3);

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
        deep_contracts::check_member(members, at, "runner", &RULE_3)?;
        deep_contracts::check_member(members, at, "inputs", &RULE_29)?;
        deep_contracts::check_member(members, at, "depth", &RULE_3)?;
        deep_contracts::check_member(members, at, "contract", &RULE_30)?;
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

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimMadeV;

impl Contract for ClaimMadeV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimMadeKind;

impl Contract for ClaimMadeKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"claim.made\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"claim.made\"").expect("a constant is JSON")
    }
}

static PATTERN_31: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 11),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(8, 10),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(7),
    deep_contracts::Inst::Jmp(28),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(21, 23),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(20),
    deep_contracts::Inst::Char(&[(35, 35)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(26, 28),
    deep_contracts::Inst::Char(&[(45, 46), (48, 57), (65, 90), (95, 95), (97, 122)]),
    deep_contracts::Inst::Jmp(25),
    deep_contracts::Inst::Match,
];

static RULE_32: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_31) };

static RULE_33: deep_contracts::Rule = deep_contracts::Rule::Number { min: Some(0.0), max: Some(65535.0) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimMadeDataScope {
    Session,
    Child,
    Task,
}

impl Contract for ClaimMadeDataScope {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "session" => Ok(Self::Session),
            "child" => Ok(Self::Child),
            "task" => Ok(Self::Task),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Session => "session",
            Self::Child => "child",
            Self::Task => "task",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimMadeData {
    pub task_ref: String,
    pub attempt: i64,
    pub commit: String,
    pub scope: ClaimMadeDataScope,
}

impl Contract for ClaimMadeData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["task_ref", "attempt", "commit", "scope"])?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "attempt", &RULE_33)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            attempt: deep_contracts::required(members, at, "attempt")?,
            commit: deep_contracts::required(members, at, "commit")?,
            scope: deep_contracts::required(members, at, "scope")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("attempt".to_string(), self.attempt.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimMade {
    pub v: ClaimMadeV,
    pub id: String,
    pub kind: ClaimMadeKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ClaimMadeData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ClaimMade {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimSentBackV;

impl Contract for ClaimSentBackV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimSentBackKind;

impl Contract for ClaimSentBackKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"claim.sent_back\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"claim.sent_back\"").expect("a constant is JSON")
    }
}

static PATTERN_34: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(109, 109)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(8, 10),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(7),
    deep_contracts::Inst::Match,
];

static RULE_35: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_34) };

static PATTERN_36: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(118, 118)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(10, 12),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(9),
    deep_contracts::Inst::Match,
];

static RULE_37: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_36) };

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimSentBackData {
    pub claim: String,
    pub verdict: String,
    pub round: i64,
    pub to: String,
}

impl Contract for ClaimSentBackData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["claim", "verdict", "round", "to"])?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "round", &RULE_33)?;
        deep_contracts::check_member(members, at, "to", &RULE_27)?;
        Ok(Self {
            claim: deep_contracts::required(members, at, "claim")?,
            verdict: deep_contracts::required(members, at, "verdict")?,
            round: deep_contracts::required(members, at, "round")?,
            to: deep_contracts::required(members, at, "to")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("round".to_string(), self.round.to_json()));
        members.push(("to".to_string(), self.to.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimSentBack {
    pub v: ClaimSentBackV,
    pub id: String,
    pub kind: ClaimSentBackKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ClaimSentBackData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ClaimSentBack {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimStalledV;

impl Contract for ClaimStalledV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimStalledKind;

impl Contract for ClaimStalledKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"claim.stalled\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"claim.stalled\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimStalledData {
    pub claim: String,
    pub rule: String,
}

impl Contract for ClaimStalledData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["claim", "rule"])?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "rule", &RULE_6)?;
        Ok(Self {
            claim: deep_contracts::required(members, at, "claim")?,
            rule: deep_contracts::required(members, at, "rule")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("rule".to_string(), self.rule.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClaimStalled {
    pub v: ClaimStalledV,
    pub id: String,
    pub kind: ClaimStalledKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ClaimStalledData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ClaimStalled {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionAppliedV;

impl Contract for DecisionAppliedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionAppliedKind;

impl Contract for DecisionAppliedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"decision.applied\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"decision.applied\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionAppliedWriter;

impl Contract for DecisionAppliedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

static PATTERN_38: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(11, 13),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(10),
    deep_contracts::Inst::Match,
];

static RULE_39: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_38) };

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionAppliedData {
    pub decision: String,
    pub ask: String,
}

impl Contract for DecisionAppliedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["decision", "ask"])?;
        deep_contracts::check_member(members, at, "decision", &RULE_39)?;
        deep_contracts::check_member(members, at, "ask", &RULE_22)?;
        Ok(Self {
            decision: deep_contracts::required(members, at, "decision")?,
            ask: deep_contracts::required(members, at, "ask")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("decision".to_string(), self.decision.to_json()));
        members.push(("ask".to_string(), self.ask.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionApplied {
    pub v: DecisionAppliedV,
    pub id: String,
    pub kind: DecisionAppliedKind,
    pub subject: Option<String>,
    pub writer: DecisionAppliedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DecisionAppliedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DecisionApplied {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionCreatedV;

impl Contract for DecisionCreatedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionCreatedKind;

impl Contract for DecisionCreatedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"decision.created\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"decision.created\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionCreatedWriter;

impl Contract for DecisionCreatedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

static PATTERN_40: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 14),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(11, 13),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(10),
    deep_contracts::Inst::Jmp(28),
    deep_contracts::Inst::Split(15, 25),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(22, 24),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(21),
    deep_contracts::Inst::Jmp(28),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Match,
];

static RULE_41: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_40) };

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionCreatedData {
    pub key: String,
    pub scope: String,
    pub answer: String,
    pub ask: String,
}

impl Contract for DecisionCreatedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["key", "scope", "answer", "ask"])?;
        deep_contracts::check_member(members, at, "key", &RULE_20)?;
        deep_contracts::check_member(members, at, "scope", &RULE_41)?;
        deep_contracts::check_member(members, at, "answer", &RULE_6)?;
        deep_contracts::check_member(members, at, "ask", &RULE_22)?;
        Ok(Self {
            key: deep_contracts::required(members, at, "key")?,
            scope: deep_contracts::required(members, at, "scope")?,
            answer: deep_contracts::required(members, at, "answer")?,
            ask: deep_contracts::required(members, at, "ask")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("answer".to_string(), self.answer.to_json()));
        members.push(("ask".to_string(), self.ask.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionCreated {
    pub v: DecisionCreatedV,
    pub id: String,
    pub kind: DecisionCreatedKind,
    pub subject: Option<String>,
    pub writer: DecisionCreatedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DecisionCreatedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DecisionCreated {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionDraftedV;

impl Contract for DefinitionDraftedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionDraftedKind;

impl Contract for DefinitionDraftedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"definition.drafted\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"definition.drafted\"").expect("a constant is JSON")
    }
}

static PATTERN_42: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 6),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Jmp(14),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(120, 120)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Split(12, 14),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Jmp(11),
    deep_contracts::Inst::Match,
];

static RULE_43: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_42) };

static PATTERN_44: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(82, 82)]),
    deep_contracts::Inst::Char(&[(49, 57)]),
    deep_contracts::Inst::Split(3, 5),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(2),
    deep_contracts::Inst::Match,
];

static RULE_45: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_44) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefinitionDraftedDataRequirementsItemOracle {
    Code,
    Model,
    Person,
}

impl Contract for DefinitionDraftedDataRequirementsItemOracle {
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
pub struct DefinitionDraftedDataRequirementsItem {
    pub id: String,
    pub text: String,
    pub checks: Vec<String>,
    pub oracle: DefinitionDraftedDataRequirementsItemOracle,
    pub depth: String,
}

impl Contract for DefinitionDraftedDataRequirementsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["id", "text", "checks", "oracle", "depth"])?;
        deep_contracts::check_member(members, at, "id", &RULE_45)?;
        deep_contracts::check_member(members, at, "text", &RULE_6)?;
        deep_contracts::check_member(members, at, "checks", &RULE_10)?;
        deep_contracts::check_member(members, at, "depth", &RULE_6)?;
        Ok(Self {
            id: deep_contracts::required(members, at, "id")?,
            text: deep_contracts::required(members, at, "text")?,
            checks: deep_contracts::required(members, at, "checks")?,
            oracle: deep_contracts::required(members, at, "oracle")?,
            depth: deep_contracts::required(members, at, "depth")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        members.push(("checks".to_string(), self.checks.to_json()));
        members.push(("oracle".to_string(), self.oracle.to_json()));
        members.push(("depth".to_string(), self.depth.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionDraftedDataBudget {
    pub runs: i64,
    pub cap_usd: f64,
}

impl Contract for DefinitionDraftedDataBudget {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["runs", "cap_usd"])?;
        deep_contracts::check_member(members, at, "runs", &RULE_33)?;
        deep_contracts::check_member(members, at, "cap_usd", &RULE_4)?;
        Ok(Self {
            runs: deep_contracts::required(members, at, "runs")?,
            cap_usd: deep_contracts::required(members, at, "cap_usd")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("runs".to_string(), self.runs.to_json()));
        members.push(("cap_usd".to_string(), self.cap_usd.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionDraftedData {
    pub definition: String,
    pub task_ref: String,
    pub requirements: Vec<DefinitionDraftedDataRequirementsItem>,
    pub hash: String,
    pub base_commit: String,
    pub budget: Option<DefinitionDraftedDataBudget>,
}

impl Contract for DefinitionDraftedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["definition", "task_ref", "requirements", "hash", "base_commit", "budget"])?;
        deep_contracts::check_member(members, at, "definition", &RULE_20)?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "hash", &RULE_20)?;
        deep_contracts::check_member(members, at, "base_commit", &RULE_24)?;
        Ok(Self {
            definition: deep_contracts::required(members, at, "definition")?,
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            hash: deep_contracts::required(members, at, "hash")?,
            base_commit: deep_contracts::required(members, at, "base_commit")?,
            budget: deep_contracts::required(members, at, "budget")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("definition".to_string(), self.definition.to_json()));
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("hash".to_string(), self.hash.to_json()));
        members.push(("base_commit".to_string(), self.base_commit.to_json()));
        members.push(("budget".to_string(), self.budget.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionDrafted {
    pub v: DefinitionDraftedV,
    pub id: String,
    pub kind: DefinitionDraftedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DefinitionDraftedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DefinitionDrafted {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_43)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionLockedV;

impl Contract for DefinitionLockedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionLockedKind;

impl Contract for DefinitionLockedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"definition.locked\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"definition.locked\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionLockedWriter;

impl Contract for DefinitionLockedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefinitionLockedDataRequirementsItemOracle {
    Code,
    Model,
    Person,
}

impl Contract for DefinitionLockedDataRequirementsItemOracle {
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
pub struct DefinitionLockedDataRequirementsItem {
    pub id: String,
    pub text: String,
    pub checks: Vec<String>,
    pub oracle: DefinitionLockedDataRequirementsItemOracle,
    pub depth: String,
}

impl Contract for DefinitionLockedDataRequirementsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["id", "text", "checks", "oracle", "depth"])?;
        deep_contracts::check_member(members, at, "id", &RULE_45)?;
        deep_contracts::check_member(members, at, "text", &RULE_6)?;
        deep_contracts::check_member(members, at, "checks", &RULE_10)?;
        deep_contracts::check_member(members, at, "depth", &RULE_6)?;
        Ok(Self {
            id: deep_contracts::required(members, at, "id")?,
            text: deep_contracts::required(members, at, "text")?,
            checks: deep_contracts::required(members, at, "checks")?,
            oracle: deep_contracts::required(members, at, "oracle")?,
            depth: deep_contracts::required(members, at, "depth")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        members.push(("checks".to_string(), self.checks.to_json()));
        members.push(("oracle".to_string(), self.oracle.to_json()));
        members.push(("depth".to_string(), self.depth.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionLockedDataBudget {
    pub runs: i64,
    pub cap_usd: f64,
}

impl Contract for DefinitionLockedDataBudget {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["runs", "cap_usd"])?;
        deep_contracts::check_member(members, at, "runs", &RULE_33)?;
        deep_contracts::check_member(members, at, "cap_usd", &RULE_4)?;
        Ok(Self {
            runs: deep_contracts::required(members, at, "runs")?,
            cap_usd: deep_contracts::required(members, at, "cap_usd")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("runs".to_string(), self.runs.to_json()));
        members.push(("cap_usd".to_string(), self.cap_usd.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionLockedData {
    pub definition: String,
    pub task_ref: String,
    pub requirements: Vec<DefinitionLockedDataRequirementsItem>,
    pub hash: String,
    pub base_commit: String,
    pub budget: Option<DefinitionLockedDataBudget>,
}

impl Contract for DefinitionLockedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["definition", "task_ref", "requirements", "hash", "base_commit", "budget"])?;
        deep_contracts::check_member(members, at, "definition", &RULE_20)?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "hash", &RULE_20)?;
        deep_contracts::check_member(members, at, "base_commit", &RULE_24)?;
        Ok(Self {
            definition: deep_contracts::required(members, at, "definition")?,
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            hash: deep_contracts::required(members, at, "hash")?,
            base_commit: deep_contracts::required(members, at, "base_commit")?,
            budget: deep_contracts::required(members, at, "budget")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("definition".to_string(), self.definition.to_json()));
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("hash".to_string(), self.hash.to_json()));
        members.push(("base_commit".to_string(), self.base_commit.to_json()));
        members.push(("budget".to_string(), self.budget.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionLocked {
    pub v: DefinitionLockedV,
    pub id: String,
    pub kind: DefinitionLockedKind,
    pub subject: Option<String>,
    pub writer: DefinitionLockedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DefinitionLockedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DefinitionLocked {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionRevisedV;

impl Contract for DefinitionRevisedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionRevisedKind;

impl Contract for DefinitionRevisedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"definition.revised\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"definition.revised\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionRevisedWriter;

impl Contract for DefinitionRevisedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefinitionRevisedDataRequirementsItemOracle {
    Code,
    Model,
    Person,
}

impl Contract for DefinitionRevisedDataRequirementsItemOracle {
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
pub struct DefinitionRevisedDataRequirementsItem {
    pub id: String,
    pub text: String,
    pub checks: Vec<String>,
    pub oracle: DefinitionRevisedDataRequirementsItemOracle,
    pub depth: String,
}

impl Contract for DefinitionRevisedDataRequirementsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["id", "text", "checks", "oracle", "depth"])?;
        deep_contracts::check_member(members, at, "id", &RULE_45)?;
        deep_contracts::check_member(members, at, "text", &RULE_6)?;
        deep_contracts::check_member(members, at, "checks", &RULE_10)?;
        deep_contracts::check_member(members, at, "depth", &RULE_6)?;
        Ok(Self {
            id: deep_contracts::required(members, at, "id")?,
            text: deep_contracts::required(members, at, "text")?,
            checks: deep_contracts::required(members, at, "checks")?,
            oracle: deep_contracts::required(members, at, "oracle")?,
            depth: deep_contracts::required(members, at, "depth")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        members.push(("checks".to_string(), self.checks.to_json()));
        members.push(("oracle".to_string(), self.oracle.to_json()));
        members.push(("depth".to_string(), self.depth.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionRevisedDataBudget {
    pub runs: i64,
    pub cap_usd: f64,
}

impl Contract for DefinitionRevisedDataBudget {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["runs", "cap_usd"])?;
        deep_contracts::check_member(members, at, "runs", &RULE_33)?;
        deep_contracts::check_member(members, at, "cap_usd", &RULE_4)?;
        Ok(Self {
            runs: deep_contracts::required(members, at, "runs")?,
            cap_usd: deep_contracts::required(members, at, "cap_usd")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("runs".to_string(), self.runs.to_json()));
        members.push(("cap_usd".to_string(), self.cap_usd.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionRevisedData {
    pub definition: String,
    pub task_ref: String,
    pub requirements: Vec<DefinitionRevisedDataRequirementsItem>,
    pub hash: String,
    pub base_commit: String,
    pub budget: Option<DefinitionRevisedDataBudget>,
    pub dispute_ask: String,
}

impl Contract for DefinitionRevisedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["definition", "task_ref", "requirements", "hash", "base_commit", "budget", "dispute_ask"])?;
        deep_contracts::check_member(members, at, "definition", &RULE_20)?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "hash", &RULE_20)?;
        deep_contracts::check_member(members, at, "base_commit", &RULE_24)?;
        deep_contracts::check_member(members, at, "dispute_ask", &RULE_22)?;
        Ok(Self {
            definition: deep_contracts::required(members, at, "definition")?,
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            hash: deep_contracts::required(members, at, "hash")?,
            base_commit: deep_contracts::required(members, at, "base_commit")?,
            budget: deep_contracts::required(members, at, "budget")?,
            dispute_ask: deep_contracts::required(members, at, "dispute_ask")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("definition".to_string(), self.definition.to_json()));
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("hash".to_string(), self.hash.to_json()));
        members.push(("base_commit".to_string(), self.base_commit.to_json()));
        members.push(("budget".to_string(), self.budget.to_json()));
        members.push(("dispute_ask".to_string(), self.dispute_ask.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DefinitionRevised {
    pub v: DefinitionRevisedV,
    pub id: String,
    pub kind: DefinitionRevisedKind,
    pub subject: Option<String>,
    pub writer: DefinitionRevisedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DefinitionRevisedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DefinitionRevised {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryOutcomeV;

impl Contract for DeliveryOutcomeV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryOutcomeKind;

impl Contract for DeliveryOutcomeKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"delivery.outcome\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"delivery.outcome\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryOutcomeDataVia {
    Steer,
    Interrupt,
    StopHold,
    NextPrompt,
}

impl Contract for DeliveryOutcomeDataVia {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "steer" => Ok(Self::Steer),
            "interrupt" => Ok(Self::Interrupt),
            "stop_hold" => Ok(Self::StopHold),
            "next_prompt" => Ok(Self::NextPrompt),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Steer => "steer",
            Self::Interrupt => "interrupt",
            Self::StopHold => "stop_hold",
            Self::NextPrompt => "next_prompt",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryOutcomeDataOutcome {
    Delivered,
    Stalled,
    TimedOut,
    Replaced,
}

impl Contract for DeliveryOutcomeDataOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "delivered" => Ok(Self::Delivered),
            "stalled" => Ok(Self::Stalled),
            "timed_out" => Ok(Self::TimedOut),
            "replaced" => Ok(Self::Replaced),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Delivered => "delivered",
            Self::Stalled => "stalled",
            Self::TimedOut => "timed_out",
            Self::Replaced => "replaced",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryOutcomeData {
    pub delivery: String,
    pub via: DeliveryOutcomeDataVia,
    pub outcome: DeliveryOutcomeDataOutcome,
}

impl Contract for DeliveryOutcomeData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["delivery", "via", "outcome"])?;
        deep_contracts::check_member(members, at, "delivery", &RULE_6)?;
        Ok(Self {
            delivery: deep_contracts::required(members, at, "delivery")?,
            via: deep_contracts::required(members, at, "via")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("delivery".to_string(), self.delivery.to_json()));
        members.push(("via".to_string(), self.via.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DeliveryOutcome {
    pub v: DeliveryOutcomeV,
    pub id: String,
    pub kind: DeliveryOutcomeKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DeliveryOutcomeData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DeliveryOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocPatchedV;

impl Contract for DocPatchedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocPatchedKind;

impl Contract for DocPatchedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"doc.patched\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"doc.patched\"").expect("a constant is JSON")
    }
}

static PATTERN_46: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(6, 8),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(5),
    deep_contracts::Inst::Match,
];

static RULE_47: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_46) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocPatchedDataWriter {
    You,
    Shell,
    Record,
    Agent,
    Plugin,
}

impl Contract for DocPatchedDataWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "you" => Ok(Self::You),
            "shell" => Ok(Self::Shell),
            "record" => Ok(Self::Record),
            "agent" => Ok(Self::Agent),
            "plugin" => Ok(Self::Plugin),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::You => "you",
            Self::Shell => "shell",
            Self::Record => "record",
            Self::Agent => "agent",
            Self::Plugin => "plugin",
        }.to_string())
    }
}

static PATTERN_48: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(2, 4),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Jmp(1),
    deep_contracts::Inst::Split(5, 11),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(8, 10),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Jmp(7),
    deep_contracts::Inst::Jmp(4),
    deep_contracts::Inst::Char(&[(64, 64)]),
    deep_contracts::Inst::Char(&[(49, 57)]),
    deep_contracts::Inst::Split(14, 16),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(13),
    deep_contracts::Inst::Match,
];

static RULE_49: deep_contracts::Rule = deep_contracts::Rule::Map { keys: PATTERN_48, values: Some(&RULE_4) };

#[derive(Debug, Clone, PartialEq)]
pub struct DocPatchedDataAchieved {
    pub created: std::collections::BTreeMap<String, i64>,
    pub updated: i64,
    pub deleted: std::collections::BTreeMap<String, i64>,
    pub unchanged: bool,
}

impl Contract for DocPatchedDataAchieved {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["created", "updated", "deleted", "unchanged"])?;
        deep_contracts::check_member(members, at, "created", &RULE_49)?;
        deep_contracts::check_member(members, at, "updated", &RULE_4)?;
        deep_contracts::check_member(members, at, "deleted", &RULE_49)?;
        Ok(Self {
            created: deep_contracts::required(members, at, "created")?,
            updated: deep_contracts::required(members, at, "updated")?,
            deleted: deep_contracts::required(members, at, "deleted")?,
            unchanged: deep_contracts::required(members, at, "unchanged")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("created".to_string(), self.created.to_json()));
        members.push(("updated".to_string(), self.updated.to_json()));
        members.push(("deleted".to_string(), self.deleted.to_json()));
        members.push(("unchanged".to_string(), self.unchanged.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocPatchedData {
    pub doc: String,
    pub rev: i64,
    pub patch: String,
    pub writer: DocPatchedDataWriter,
    pub achieved: DocPatchedDataAchieved,
}

impl Contract for DocPatchedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["doc", "rev", "patch", "writer", "achieved"])?;
        deep_contracts::check_member(members, at, "doc", &RULE_47)?;
        deep_contracts::check_member(members, at, "rev", &RULE_4)?;
        deep_contracts::check_member(members, at, "patch", &RULE_0)?;
        Ok(Self {
            doc: deep_contracts::required(members, at, "doc")?,
            rev: deep_contracts::required(members, at, "rev")?,
            patch: deep_contracts::required(members, at, "patch")?,
            writer: deep_contracts::required(members, at, "writer")?,
            achieved: deep_contracts::required(members, at, "achieved")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("doc".to_string(), self.doc.to_json()));
        members.push(("rev".to_string(), self.rev.to_json()));
        members.push(("patch".to_string(), self.patch.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("achieved".to_string(), self.achieved.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocPatched {
    pub v: DocPatchedV,
    pub id: String,
    pub kind: DocPatchedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: DocPatchedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for DocPatched {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
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

static RULE_50: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_2) };

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
        deep_contracts::check_member(members, at, "remediation", &RULE_3)?;
        deep_contracts::check_member(members, at, "actual", &RULE_12)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_50)?;
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

#[derive(Debug, Clone, PartialEq)]
pub struct EvidencePutV;

impl Contract for EvidencePutV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvidencePutKind;

impl Contract for EvidencePutKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"evidence.put\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"evidence.put\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidencePutDataOrigin {
    Deepbuild,
    You,
    Agent,
}

impl Contract for EvidencePutDataOrigin {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "deepbuild" => Ok(Self::Deepbuild),
            "you" => Ok(Self::You),
            "agent" => Ok(Self::Agent),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Deepbuild => "deepbuild",
            Self::You => "you",
            Self::Agent => "agent",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidencePutDataRedaction {
    Complete,
    Incomplete,
    Unknown,
}

impl Contract for EvidencePutDataRedaction {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "complete" => Ok(Self::Complete),
            "incomplete" => Ok(Self::Incomplete),
            "unknown" => Ok(Self::Unknown),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Complete => "complete",
            Self::Incomplete => "incomplete",
            Self::Unknown => "unknown",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvidencePutDataStepTimesItem {
    pub step: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

impl Contract for EvidencePutDataStepTimesItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["step", "start_ms", "end_ms"])?;
        deep_contracts::check_member(members, at, "step", &RULE_6)?;
        deep_contracts::check_member(members, at, "start_ms", &RULE_4)?;
        deep_contracts::check_member(members, at, "end_ms", &RULE_4)?;
        Ok(Self {
            step: deep_contracts::required(members, at, "step")?,
            start_ms: deep_contracts::required(members, at, "start_ms")?,
            end_ms: deep_contracts::required(members, at, "end_ms")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("step".to_string(), self.step.to_json()));
        members.push(("start_ms".to_string(), self.start_ms.to_json()));
        members.push(("end_ms".to_string(), self.end_ms.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvidencePutData {
    pub sha256: String,
    pub kind: String,
    pub source: String,
    pub origin: EvidencePutDataOrigin,
    pub redaction: EvidencePutDataRedaction,
    pub license: String,
    pub step_times: Vec<EvidencePutDataStepTimesItem>,
}

impl Contract for EvidencePutData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["sha256", "kind", "source", "origin", "redaction", "license", "step_times"])?;
        deep_contracts::check_member(members, at, "sha256", &RULE_20)?;
        deep_contracts::check_member(members, at, "kind", &RULE_6)?;
        deep_contracts::check_member(members, at, "source", &RULE_6)?;
        deep_contracts::check_member(members, at, "license", &RULE_6)?;
        Ok(Self {
            sha256: deep_contracts::required(members, at, "sha256")?,
            kind: deep_contracts::required(members, at, "kind")?,
            source: deep_contracts::required(members, at, "source")?,
            origin: deep_contracts::required(members, at, "origin")?,
            redaction: deep_contracts::required(members, at, "redaction")?,
            license: deep_contracts::required(members, at, "license")?,
            step_times: deep_contracts::required(members, at, "step_times")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("sha256".to_string(), self.sha256.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("source".to_string(), self.source.to_json()));
        members.push(("origin".to_string(), self.origin.to_json()));
        members.push(("redaction".to_string(), self.redaction.to_json()));
        members.push(("license".to_string(), self.license.to_json()));
        members.push(("step_times".to_string(), self.step_times.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvidencePut {
    pub v: EvidencePutV,
    pub id: String,
    pub kind: EvidencePutKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: EvidencePutData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for EvidencePut {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
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
        deep_contracts::check_member(members, at, "match", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "reason", &RULE_3)?;
        deep_contracts::check_member(members, at, "next_step", &RULE_3)?;
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

static RULE_51: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_4);

#[derive(Debug, Clone, PartialEq)]
pub struct HookAck {
    pub ack: String,
    pub hold_until_ms: Option<i64>,
}

impl Contract for HookAck {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["ack", "hold_until_ms"])?;
        deep_contracts::check_member(members, at, "ack", &RULE_0)?;
        deep_contracts::check_member(members, at, "hold_until_ms", &RULE_51)?;
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
        deep_contracts::check_member(members, at, "extension", &RULE_3)?;
        deep_contracts::check_member(members, at, "reason", &RULE_3)?;
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
        deep_contracts::check_member(members, at, "extension", &RULE_3)?;
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
        deep_contracts::check_member(members, at, "order", &RULE_29)?;
        deep_contracts::check_member(members, at, "bound", &RULE_4)?;
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

static RULE_52: deep_contracts::Rule = deep_contracts::Rule::Number { min: Some(0.0), max: Some(255.0) };

#[derive(Debug, Clone, PartialEq)]
pub struct HookReply {
    pub exit: i64,
    pub stdout: String,
    pub stderr: String,
}

impl Contract for HookReply {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["exit", "stdout", "stderr"])?;
        deep_contracts::check_member(members, at, "exit", &RULE_52)?;
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

static RULE_53: deep_contracts::Rule = deep_contracts::Rule::Number { min: Some(0.0), max: Some(4294967295.0) };

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
        deep_contracts::check_member(members, at, "agent", &RULE_3)?;
        deep_contracts::check_member(members, at, "event", &RULE_3)?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "pid", &RULE_53)?;
        deep_contracts::check_member(members, at, "ppid", &RULE_53)?;
        deep_contracts::check_member(members, at, "matched", &RULE_29)?;
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

#[derive(Debug, Clone, PartialEq)]
pub struct LayerRowsV;

impl Contract for LayerRowsV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerRowsKind;

impl Contract for LayerRowsKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"layer.rows\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"layer.rows\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerRowsWriter;

impl Contract for LayerRowsWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerRowsData {
    pub layer: String,
    pub project: String,
    pub parent: Option<String>,
    pub level: i64,
    pub file: String,
}

impl Contract for LayerRowsData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["layer", "project", "parent", "level", "file"])?;
        deep_contracts::check_member(members, at, "layer", &RULE_6)?;
        deep_contracts::check_member(members, at, "project", &RULE_6)?;
        deep_contracts::check_member(members, at, "parent", &RULE_11)?;
        deep_contracts::check_member(members, at, "level", &RULE_33)?;
        deep_contracts::check_member(members, at, "file", &RULE_20)?;
        Ok(Self {
            layer: deep_contracts::required(members, at, "layer")?,
            project: deep_contracts::required(members, at, "project")?,
            parent: deep_contracts::required(members, at, "parent")?,
            level: deep_contracts::required(members, at, "level")?,
            file: deep_contracts::required(members, at, "file")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("layer".to_string(), self.layer.to_json()));
        members.push(("project".to_string(), self.project.to_json()));
        members.push(("parent".to_string(), self.parent.to_json()));
        members.push(("level".to_string(), self.level.to_json()));
        members.push(("file".to_string(), self.file.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayerRows {
    pub v: LayerRowsV,
    pub id: String,
    pub kind: LayerRowsKind,
    pub subject: Option<String>,
    pub writer: LayerRowsWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LayerRowsData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LayerRows {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnAppliedV;

impl Contract for LearnAppliedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnAppliedKind;

impl Contract for LearnAppliedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"learn.applied\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"learn.applied\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnAppliedWriter {
    App,
    Cli,
    Core,
}

impl Contract for LearnAppliedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "app" => Ok(Self::App),
            "cli" => Ok(Self::Cli),
            "core" => Ok(Self::Core),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::App => "app",
            Self::Cli => "cli",
            Self::Core => "core",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnAppliedDataLayer {
    Learned,
    Base,
}

impl Contract for LearnAppliedDataLayer {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "learned" => Ok(Self::Learned),
            "base" => Ok(Self::Base),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Learned => "learned",
            Self::Base => "base",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnAppliedDataEvidenceItem {
    pub at: String,
    pub quote: String,
}

impl Contract for LearnAppliedDataEvidenceItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["at", "quote"])?;
        deep_contracts::check_member(members, at, "at", &RULE_27)?;
        deep_contracts::check_member(members, at, "quote", &RULE_6)?;
        Ok(Self {
            at: deep_contracts::required(members, at, "at")?,
            quote: deep_contracts::required(members, at, "quote")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("at".to_string(), self.at.to_json()));
        members.push(("quote".to_string(), self.quote.to_json()));
        Value::Object(members)
    }
}

static RULE_54: deep_contracts::Rule = deep_contracts::Rule::Array { min: Some(1), max: None, items: None };

#[derive(Debug, Clone, PartialEq)]
pub struct LearnAppliedDataReplay {
    pub tasks: i64,
    pub regressions: i64,
}

impl Contract for LearnAppliedDataReplay {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["tasks", "regressions"])?;
        deep_contracts::check_member(members, at, "tasks", &RULE_4)?;
        deep_contracts::check_member(members, at, "regressions", &RULE_4)?;
        Ok(Self {
            tasks: deep_contracts::required(members, at, "tasks")?,
            regressions: deep_contracts::required(members, at, "regressions")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("tasks".to_string(), self.tasks.to_json()));
        members.push(("regressions".to_string(), self.regressions.to_json()));
        Value::Object(members)
    }
}

static PATTERN_55: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 5),
    deep_contracts::Inst::Char(&[(121, 121)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(117, 117)]),
    deep_contracts::Inst::Jmp(14),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(117, 117)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(12, 14),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(11),
    deep_contracts::Inst::Match,
];

static RULE_56: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_55) };

static RULE_57: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_27);

#[derive(Debug, Clone, PartialEq)]
pub struct LearnAppliedData {
    pub layer: LearnAppliedDataLayer,
    pub target: String,
    pub diff: String,
    pub evidence: Vec<LearnAppliedDataEvidenceItem>,
    pub scope: String,
    pub replay: Option<LearnAppliedDataReplay>,
    pub applied_by: String,
    pub supersedes: Option<String>,
}

impl Contract for LearnAppliedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["layer", "target", "diff", "evidence", "scope", "replay", "applied_by", "supersedes"])?;
        deep_contracts::check_member(members, at, "target", &RULE_6)?;
        deep_contracts::check_member(members, at, "diff", &RULE_6)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_54)?;
        deep_contracts::check_member(members, at, "scope", &RULE_41)?;
        deep_contracts::check_member(members, at, "applied_by", &RULE_56)?;
        deep_contracts::check_member(members, at, "supersedes", &RULE_57)?;
        Ok(Self {
            layer: deep_contracts::required(members, at, "layer")?,
            target: deep_contracts::required(members, at, "target")?,
            diff: deep_contracts::required(members, at, "diff")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            scope: deep_contracts::required(members, at, "scope")?,
            replay: deep_contracts::required(members, at, "replay")?,
            applied_by: deep_contracts::required(members, at, "applied_by")?,
            supersedes: deep_contracts::required(members, at, "supersedes")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("layer".to_string(), self.layer.to_json()));
        members.push(("target".to_string(), self.target.to_json()));
        members.push(("diff".to_string(), self.diff.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("replay".to_string(), self.replay.to_json()));
        members.push(("applied_by".to_string(), self.applied_by.to_json()));
        members.push(("supersedes".to_string(), self.supersedes.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnApplied {
    pub v: LearnAppliedV,
    pub id: String,
    pub kind: LearnAppliedKind,
    pub subject: Option<String>,
    pub writer: LearnAppliedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LearnAppliedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LearnApplied {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnProposedV;

impl Contract for LearnProposedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnProposedKind;

impl Contract for LearnProposedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"learn.proposed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"learn.proposed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnProposedDataLayer {
    Learned,
    Base,
}

impl Contract for LearnProposedDataLayer {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "learned" => Ok(Self::Learned),
            "base" => Ok(Self::Base),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Learned => "learned",
            Self::Base => "base",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnProposedDataEvidenceItem {
    pub at: String,
    pub quote: String,
}

impl Contract for LearnProposedDataEvidenceItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["at", "quote"])?;
        deep_contracts::check_member(members, at, "at", &RULE_27)?;
        deep_contracts::check_member(members, at, "quote", &RULE_6)?;
        Ok(Self {
            at: deep_contracts::required(members, at, "at")?,
            quote: deep_contracts::required(members, at, "quote")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("at".to_string(), self.at.to_json()));
        members.push(("quote".to_string(), self.quote.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnProposedDataReplay {
    pub tasks: i64,
    pub regressions: i64,
}

impl Contract for LearnProposedDataReplay {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["tasks", "regressions"])?;
        deep_contracts::check_member(members, at, "tasks", &RULE_4)?;
        deep_contracts::check_member(members, at, "regressions", &RULE_4)?;
        Ok(Self {
            tasks: deep_contracts::required(members, at, "tasks")?,
            regressions: deep_contracts::required(members, at, "regressions")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("tasks".to_string(), self.tasks.to_json()));
        members.push(("regressions".to_string(), self.regressions.to_json()));
        Value::Object(members)
    }
}

static RULE_58: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_56);

#[derive(Debug, Clone, PartialEq)]
pub struct LearnProposedData {
    pub layer: LearnProposedDataLayer,
    pub target: String,
    pub diff: String,
    pub evidence: Vec<LearnProposedDataEvidenceItem>,
    pub scope: String,
    pub replay: Option<LearnProposedDataReplay>,
    pub applied_by: Option<String>,
    pub supersedes: Option<String>,
}

impl Contract for LearnProposedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["layer", "target", "diff", "evidence", "scope", "replay", "applied_by", "supersedes"])?;
        deep_contracts::check_member(members, at, "target", &RULE_6)?;
        deep_contracts::check_member(members, at, "diff", &RULE_6)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_54)?;
        deep_contracts::check_member(members, at, "scope", &RULE_41)?;
        deep_contracts::check_member(members, at, "applied_by", &RULE_58)?;
        deep_contracts::check_member(members, at, "supersedes", &RULE_57)?;
        Ok(Self {
            layer: deep_contracts::required(members, at, "layer")?,
            target: deep_contracts::required(members, at, "target")?,
            diff: deep_contracts::required(members, at, "diff")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            scope: deep_contracts::required(members, at, "scope")?,
            replay: deep_contracts::required(members, at, "replay")?,
            applied_by: deep_contracts::required(members, at, "applied_by")?,
            supersedes: deep_contracts::required(members, at, "supersedes")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("layer".to_string(), self.layer.to_json()));
        members.push(("target".to_string(), self.target.to_json()));
        members.push(("diff".to_string(), self.diff.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("replay".to_string(), self.replay.to_json()));
        members.push(("applied_by".to_string(), self.applied_by.to_json()));
        members.push(("supersedes".to_string(), self.supersedes.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnProposed {
    pub v: LearnProposedV,
    pub id: String,
    pub kind: LearnProposedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LearnProposedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LearnProposed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnRolledBackV;

impl Contract for LearnRolledBackV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnRolledBackKind;

impl Contract for LearnRolledBackKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"learn.rolled_back\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"learn.rolled_back\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnRolledBackDataLayer {
    Learned,
    Base,
}

impl Contract for LearnRolledBackDataLayer {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "learned" => Ok(Self::Learned),
            "base" => Ok(Self::Base),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Learned => "learned",
            Self::Base => "base",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnRolledBackDataEvidenceItem {
    pub at: String,
    pub quote: String,
}

impl Contract for LearnRolledBackDataEvidenceItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["at", "quote"])?;
        deep_contracts::check_member(members, at, "at", &RULE_27)?;
        deep_contracts::check_member(members, at, "quote", &RULE_6)?;
        Ok(Self {
            at: deep_contracts::required(members, at, "at")?,
            quote: deep_contracts::required(members, at, "quote")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("at".to_string(), self.at.to_json()));
        members.push(("quote".to_string(), self.quote.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnRolledBackDataReplay {
    pub tasks: i64,
    pub regressions: i64,
}

impl Contract for LearnRolledBackDataReplay {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["tasks", "regressions"])?;
        deep_contracts::check_member(members, at, "tasks", &RULE_4)?;
        deep_contracts::check_member(members, at, "regressions", &RULE_4)?;
        Ok(Self {
            tasks: deep_contracts::required(members, at, "tasks")?,
            regressions: deep_contracts::required(members, at, "regressions")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("tasks".to_string(), self.tasks.to_json()));
        members.push(("regressions".to_string(), self.regressions.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnRolledBackData {
    pub layer: LearnRolledBackDataLayer,
    pub target: String,
    pub diff: String,
    pub evidence: Vec<LearnRolledBackDataEvidenceItem>,
    pub scope: String,
    pub replay: Option<LearnRolledBackDataReplay>,
    pub applied_by: Option<String>,
    pub supersedes: Option<String>,
}

impl Contract for LearnRolledBackData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["layer", "target", "diff", "evidence", "scope", "replay", "applied_by", "supersedes"])?;
        deep_contracts::check_member(members, at, "target", &RULE_6)?;
        deep_contracts::check_member(members, at, "diff", &RULE_6)?;
        deep_contracts::check_member(members, at, "scope", &RULE_41)?;
        deep_contracts::check_member(members, at, "applied_by", &RULE_58)?;
        deep_contracts::check_member(members, at, "supersedes", &RULE_57)?;
        Ok(Self {
            layer: deep_contracts::required(members, at, "layer")?,
            target: deep_contracts::required(members, at, "target")?,
            diff: deep_contracts::required(members, at, "diff")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            scope: deep_contracts::required(members, at, "scope")?,
            replay: deep_contracts::required(members, at, "replay")?,
            applied_by: deep_contracts::required(members, at, "applied_by")?,
            supersedes: deep_contracts::required(members, at, "supersedes")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("layer".to_string(), self.layer.to_json()));
        members.push(("target".to_string(), self.target.to_json()));
        members.push(("diff".to_string(), self.diff.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("replay".to_string(), self.replay.to_json()));
        members.push(("applied_by".to_string(), self.applied_by.to_json()));
        members.push(("supersedes".to_string(), self.supersedes.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnRolledBack {
    pub v: LearnRolledBackV,
    pub id: String,
    pub kind: LearnRolledBackKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LearnRolledBackData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LearnRolledBack {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnWidenedV;

impl Contract for LearnWidenedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnWidenedKind;

impl Contract for LearnWidenedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"learn.widened\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"learn.widened\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnWidenedWriter {
    App,
    Cli,
    Core,
}

impl Contract for LearnWidenedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "app" => Ok(Self::App),
            "cli" => Ok(Self::Cli),
            "core" => Ok(Self::Core),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::App => "app",
            Self::Cli => "cli",
            Self::Core => "core",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LearnWidenedDataLayer {
    Learned,
    Base,
}

impl Contract for LearnWidenedDataLayer {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "learned" => Ok(Self::Learned),
            "base" => Ok(Self::Base),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Learned => "learned",
            Self::Base => "base",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnWidenedDataEvidenceItem {
    pub at: String,
    pub quote: String,
}

impl Contract for LearnWidenedDataEvidenceItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["at", "quote"])?;
        deep_contracts::check_member(members, at, "at", &RULE_27)?;
        deep_contracts::check_member(members, at, "quote", &RULE_6)?;
        Ok(Self {
            at: deep_contracts::required(members, at, "at")?,
            quote: deep_contracts::required(members, at, "quote")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("at".to_string(), self.at.to_json()));
        members.push(("quote".to_string(), self.quote.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnWidenedDataReplay {
    pub tasks: i64,
    pub regressions: i64,
}

impl Contract for LearnWidenedDataReplay {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["tasks", "regressions"])?;
        deep_contracts::check_member(members, at, "tasks", &RULE_4)?;
        deep_contracts::check_member(members, at, "regressions", &RULE_4)?;
        Ok(Self {
            tasks: deep_contracts::required(members, at, "tasks")?,
            regressions: deep_contracts::required(members, at, "regressions")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("tasks".to_string(), self.tasks.to_json()));
        members.push(("regressions".to_string(), self.regressions.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnWidenedData {
    pub layer: LearnWidenedDataLayer,
    pub target: String,
    pub diff: String,
    pub evidence: Vec<LearnWidenedDataEvidenceItem>,
    pub scope: String,
    pub replay: Option<LearnWidenedDataReplay>,
    pub applied_by: String,
    pub supersedes: Option<String>,
}

impl Contract for LearnWidenedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["layer", "target", "diff", "evidence", "scope", "replay", "applied_by", "supersedes"])?;
        deep_contracts::check_member(members, at, "target", &RULE_6)?;
        deep_contracts::check_member(members, at, "diff", &RULE_6)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_54)?;
        deep_contracts::check_member(members, at, "scope", &RULE_41)?;
        deep_contracts::check_member(members, at, "applied_by", &RULE_56)?;
        deep_contracts::check_member(members, at, "supersedes", &RULE_57)?;
        Ok(Self {
            layer: deep_contracts::required(members, at, "layer")?,
            target: deep_contracts::required(members, at, "target")?,
            diff: deep_contracts::required(members, at, "diff")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            scope: deep_contracts::required(members, at, "scope")?,
            replay: deep_contracts::required(members, at, "replay")?,
            applied_by: deep_contracts::required(members, at, "applied_by")?,
            supersedes: deep_contracts::required(members, at, "supersedes")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("layer".to_string(), self.layer.to_json()));
        members.push(("target".to_string(), self.target.to_json()));
        members.push(("diff".to_string(), self.diff.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("replay".to_string(), self.replay.to_json()));
        members.push(("applied_by".to_string(), self.applied_by.to_json()));
        members.push(("supersedes".to_string(), self.supersedes.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LearnWidened {
    pub v: LearnWidenedV,
    pub id: String,
    pub kind: LearnWidenedKind,
    pub subject: Option<String>,
    pub writer: LearnWidenedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LearnWidenedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LearnWidened {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseAcquiredV;

impl Contract for LeaseAcquiredV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseAcquiredKind;

impl Contract for LeaseAcquiredKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"lease.acquired\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"lease.acquired\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseAcquiredDataResource {
    pub host: String,
    pub kind: String,
    pub key: String,
}

impl Contract for LeaseAcquiredDataResource {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["host", "kind", "key"])?;
        deep_contracts::check_member(members, at, "host", &RULE_6)?;
        deep_contracts::check_member(members, at, "kind", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_6)?;
        Ok(Self {
            host: deep_contracts::required(members, at, "host")?,
            kind: deep_contracts::required(members, at, "kind")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("host".to_string(), self.host.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

static PATTERN_59: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 14),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(115, 115)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(11, 13),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(10),
    deep_contracts::Inst::Jmp(54),
    deep_contracts::Inst::Split(15, 20),
    deep_contracts::Inst::Char(&[(104, 104)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(107, 107)]),
    deep_contracts::Inst::Jmp(54),
    deep_contracts::Inst::Split(21, 25),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Jmp(54),
    deep_contracts::Inst::Split(26, 30),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(108, 108)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Jmp(54),
    deep_contracts::Inst::Split(31, 36),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Jmp(54),
    deep_contracts::Inst::Split(37, 46),
    deep_contracts::Inst::Char(&[(109, 109)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(112, 112)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Split(43, 45),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Jmp(42),
    deep_contracts::Inst::Jmp(54),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(120, 120)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Split(52, 54),
    deep_contracts::Inst::Char(&[(0, 8), (14, 31), (33, 159), (161, 5759), (5761, 8191), (8203, 8231), (8234, 8238), (8240, 8286), (8288, 12287), (12289, 65278), (65280, 1114111)]),
    deep_contracts::Inst::Jmp(51),
    deep_contracts::Inst::Match,
];

static RULE_60: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_59) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseAcquiredDataMode {
    Exclusive,
    Shared,
}

impl Contract for LeaseAcquiredDataMode {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "exclusive" => Ok(Self::Exclusive),
            "shared" => Ok(Self::Shared),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Exclusive => "exclusive",
            Self::Shared => "shared",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseAcquiredData {
    pub resource: LeaseAcquiredDataResource,
    pub holder: String,
    pub mode: LeaseAcquiredDataMode,
    pub expires: i64,
}

impl Contract for LeaseAcquiredData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["resource", "holder", "mode", "expires"])?;
        deep_contracts::check_member(members, at, "holder", &RULE_60)?;
        deep_contracts::check_member(members, at, "expires", &RULE_4)?;
        Ok(Self {
            resource: deep_contracts::required(members, at, "resource")?,
            holder: deep_contracts::required(members, at, "holder")?,
            mode: deep_contracts::required(members, at, "mode")?,
            expires: deep_contracts::required(members, at, "expires")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("resource".to_string(), self.resource.to_json()));
        members.push(("holder".to_string(), self.holder.to_json()));
        members.push(("mode".to_string(), self.mode.to_json()));
        members.push(("expires".to_string(), self.expires.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseAcquired {
    pub v: LeaseAcquiredV,
    pub id: String,
    pub kind: LeaseAcquiredKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LeaseAcquiredData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LeaseAcquired {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseDeniedV;

impl Contract for LeaseDeniedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseDeniedKind;

impl Contract for LeaseDeniedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"lease.denied\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"lease.denied\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseDeniedDataResource {
    pub host: String,
    pub kind: String,
    pub key: String,
}

impl Contract for LeaseDeniedDataResource {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["host", "kind", "key"])?;
        deep_contracts::check_member(members, at, "host", &RULE_6)?;
        deep_contracts::check_member(members, at, "kind", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_6)?;
        Ok(Self {
            host: deep_contracts::required(members, at, "host")?,
            kind: deep_contracts::required(members, at, "kind")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("host".to_string(), self.host.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseDeniedDataMode {
    Exclusive,
    Shared,
}

impl Contract for LeaseDeniedDataMode {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "exclusive" => Ok(Self::Exclusive),
            "shared" => Ok(Self::Shared),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Exclusive => "exclusive",
            Self::Shared => "shared",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseDeniedData {
    pub resource: LeaseDeniedDataResource,
    pub holder: String,
    pub mode: LeaseDeniedDataMode,
    pub expires: i64,
}

impl Contract for LeaseDeniedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["resource", "holder", "mode", "expires"])?;
        deep_contracts::check_member(members, at, "holder", &RULE_60)?;
        deep_contracts::check_member(members, at, "expires", &RULE_4)?;
        Ok(Self {
            resource: deep_contracts::required(members, at, "resource")?,
            holder: deep_contracts::required(members, at, "holder")?,
            mode: deep_contracts::required(members, at, "mode")?,
            expires: deep_contracts::required(members, at, "expires")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("resource".to_string(), self.resource.to_json()));
        members.push(("holder".to_string(), self.holder.to_json()));
        members.push(("mode".to_string(), self.mode.to_json()));
        members.push(("expires".to_string(), self.expires.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseDenied {
    pub v: LeaseDeniedV,
    pub id: String,
    pub kind: LeaseDeniedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LeaseDeniedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LeaseDenied {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseReleasedV;

impl Contract for LeaseReleasedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseReleasedKind;

impl Contract for LeaseReleasedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"lease.released\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"lease.released\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseReleasedDataResource {
    pub host: String,
    pub kind: String,
    pub key: String,
}

impl Contract for LeaseReleasedDataResource {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["host", "kind", "key"])?;
        deep_contracts::check_member(members, at, "host", &RULE_6)?;
        deep_contracts::check_member(members, at, "kind", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_6)?;
        Ok(Self {
            host: deep_contracts::required(members, at, "host")?,
            kind: deep_contracts::required(members, at, "kind")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("host".to_string(), self.host.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseReleasedDataMode {
    Exclusive,
    Shared,
}

impl Contract for LeaseReleasedDataMode {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "exclusive" => Ok(Self::Exclusive),
            "shared" => Ok(Self::Shared),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Exclusive => "exclusive",
            Self::Shared => "shared",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseReleasedData {
    pub resource: LeaseReleasedDataResource,
    pub holder: String,
    pub mode: LeaseReleasedDataMode,
    pub expires: i64,
}

impl Contract for LeaseReleasedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["resource", "holder", "mode", "expires"])?;
        deep_contracts::check_member(members, at, "holder", &RULE_60)?;
        deep_contracts::check_member(members, at, "expires", &RULE_4)?;
        Ok(Self {
            resource: deep_contracts::required(members, at, "resource")?,
            holder: deep_contracts::required(members, at, "holder")?,
            mode: deep_contracts::required(members, at, "mode")?,
            expires: deep_contracts::required(members, at, "expires")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("resource".to_string(), self.resource.to_json()));
        members.push(("holder".to_string(), self.holder.to_json()));
        members.push(("mode".to_string(), self.mode.to_json()));
        members.push(("expires".to_string(), self.expires.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseReleased {
    pub v: LeaseReleasedV,
    pub id: String,
    pub kind: LeaseReleasedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LeaseReleasedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LeaseReleased {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseStaleV;

impl Contract for LeaseStaleV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseStaleKind;

impl Contract for LeaseStaleKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"lease.stale\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"lease.stale\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseStaleDataResource {
    pub host: String,
    pub kind: String,
    pub key: String,
}

impl Contract for LeaseStaleDataResource {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["host", "kind", "key"])?;
        deep_contracts::check_member(members, at, "host", &RULE_6)?;
        deep_contracts::check_member(members, at, "kind", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_6)?;
        Ok(Self {
            host: deep_contracts::required(members, at, "host")?,
            kind: deep_contracts::required(members, at, "kind")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("host".to_string(), self.host.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseStaleDataMode {
    Exclusive,
    Shared,
}

impl Contract for LeaseStaleDataMode {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "exclusive" => Ok(Self::Exclusive),
            "shared" => Ok(Self::Shared),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Exclusive => "exclusive",
            Self::Shared => "shared",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseStaleData {
    pub resource: LeaseStaleDataResource,
    pub holder: String,
    pub mode: LeaseStaleDataMode,
    pub expires: i64,
}

impl Contract for LeaseStaleData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["resource", "holder", "mode", "expires"])?;
        deep_contracts::check_member(members, at, "holder", &RULE_60)?;
        deep_contracts::check_member(members, at, "expires", &RULE_4)?;
        Ok(Self {
            resource: deep_contracts::required(members, at, "resource")?,
            holder: deep_contracts::required(members, at, "holder")?,
            mode: deep_contracts::required(members, at, "mode")?,
            expires: deep_contracts::required(members, at, "expires")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("resource".to_string(), self.resource.to_json()));
        members.push(("holder".to_string(), self.holder.to_json()));
        members.push(("mode".to_string(), self.mode.to_json()));
        members.push(("expires".to_string(), self.expires.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LeaseStale {
    pub v: LeaseStaleV,
    pub id: String,
    pub kind: LeaseStaleKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: LeaseStaleData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for LeaseStale {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MergeDryRunV;

impl Contract for MergeDryRunV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MergeDryRunKind;

impl Contract for MergeDryRunKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"merge.dry_run\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"merge.dry_run\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MergeDryRunWriter;

impl Contract for MergeDryRunWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MergeDryRunData {
    pub a: String,
    pub b: String,
    pub conflicts: Vec<String>,
}

impl Contract for MergeDryRunData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["a", "b", "conflicts"])?;
        deep_contracts::check_member(members, at, "a", &RULE_6)?;
        deep_contracts::check_member(members, at, "b", &RULE_6)?;
        deep_contracts::check_member(members, at, "conflicts", &RULE_10)?;
        Ok(Self {
            a: deep_contracts::required(members, at, "a")?,
            b: deep_contracts::required(members, at, "b")?,
            conflicts: deep_contracts::required(members, at, "conflicts")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("a".to_string(), self.a.to_json()));
        members.push(("b".to_string(), self.b.to_json()));
        members.push(("conflicts".to_string(), self.conflicts.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MergeDryRun {
    pub v: MergeDryRunV,
    pub id: String,
    pub kind: MergeDryRunKind,
    pub subject: Option<String>,
    pub writer: MergeDryRunWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: MergeDryRunData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for MergeDryRun {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteClosedV;

impl Contract for NoteClosedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteClosedKind;

impl Contract for NoteClosedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"note.closed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"note.closed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteClosedWriter {
    Core,
    App,
}

impl Contract for NoteClosedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "core" => Ok(Self::Core),
            "app" => Ok(Self::App),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Core => "core",
            Self::App => "app",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteClosedDataBy {
    You,
    Check,
}

impl Contract for NoteClosedDataBy {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "you" => Ok(Self::You),
            "check" => Ok(Self::Check),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::You => "you",
            Self::Check => "check",
        }.to_string())
    }
}

static PATTERN_61: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(117, 117)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(6, 8),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(5),
    deep_contracts::Inst::Match,
];

static RULE_62: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_61) };

static RULE_63: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_62);

#[derive(Debug, Clone, PartialEq)]
pub struct NoteClosedData {
    pub note: String,
    pub by: NoteClosedDataBy,
    pub rev: i64,
    pub run: Option<String>,
}

impl Contract for NoteClosedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["note", "by", "rev", "run"])?;
        deep_contracts::check_member(members, at, "note", &RULE_0)?;
        deep_contracts::check_member(members, at, "rev", &RULE_4)?;
        deep_contracts::check_member(members, at, "run", &RULE_63)?;
        Ok(Self {
            note: deep_contracts::required(members, at, "note")?,
            by: deep_contracts::required(members, at, "by")?,
            rev: deep_contracts::required(members, at, "rev")?,
            run: deep_contracts::required(members, at, "run")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("note".to_string(), self.note.to_json()));
        members.push(("by".to_string(), self.by.to_json()));
        members.push(("rev".to_string(), self.rev.to_json()));
        members.push(("run".to_string(), self.run.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteClosed {
    pub v: NoteClosedV,
    pub id: String,
    pub kind: NoteClosedKind,
    pub subject: Option<String>,
    pub writer: NoteClosedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: NoteClosedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for NoteClosed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteOpenedV;

impl Contract for NoteOpenedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteOpenedKind;

impl Contract for NoteOpenedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"note.opened\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"note.opened\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoteOpenedWriter {
    App,
}

impl Contract for NoteOpenedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "app" => Ok(Self::App),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::App => "app",
        }.to_string())
    }
}

static PATTERN_64: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(2, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(4, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(6, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(8, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(10, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(12, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(14, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(16, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(18, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(20, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(22, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(24, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(26, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(28, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(30, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(32, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(34, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(36, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(38, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(40, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(42, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(44, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(46, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(48, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(50, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(52, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(54, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(56, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(58, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(60, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(62, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(64, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(66, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(68, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(70, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(72, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(74, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(76, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(78, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(80, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(82, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(84, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(86, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(88, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(90, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(92, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(94, 95),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(96, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(99, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(101, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(103, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(105, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(107, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(109, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(111, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(113, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(115, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(117, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(119, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(121, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(123, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(125, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(127, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(129, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(131, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(133, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(135, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(137, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(139, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(141, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(143, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(145, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(147, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(149, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(151, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(153, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(155, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(157, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(159, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(161, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(163, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(165, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(167, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(169, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(171, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(173, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(175, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(177, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(179, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(181, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(183, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(185, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(187, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(189, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(191, 192),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(193, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(196, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(198, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(200, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(202, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(204, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(206, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(208, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(210, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(212, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(214, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(216, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(218, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(220, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(222, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(224, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(226, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(228, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(230, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(232, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(234, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(236, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(238, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(240, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(242, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(244, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(246, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(248, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(250, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(252, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(254, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(256, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(258, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(260, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(262, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(264, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(266, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(268, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(270, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(272, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(274, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(276, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(278, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(280, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(282, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(284, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(286, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(288, 289),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(290, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(293, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(295, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(297, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(299, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(301, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(303, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(305, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(307, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(309, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(311, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(313, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(315, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(317, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(319, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(321, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(323, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(325, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(327, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(329, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(331, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(333, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(335, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(337, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(339, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(341, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(343, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(345, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(347, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(349, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(351, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(353, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(355, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(357, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(359, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(361, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(363, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(365, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(367, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(369, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(371, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(373, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(375, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(377, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(379, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(381, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(383, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(385, 386),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(387, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(390, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(392, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(394, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(396, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(398, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(400, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(402, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(404, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(406, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(408, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(410, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(412, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(414, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(416, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(418, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(420, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(422, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(424, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(426, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(428, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(430, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(432, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(434, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(436, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(438, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(440, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(442, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(444, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(446, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(448, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(450, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(452, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(454, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(456, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(458, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(460, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(462, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(464, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(466, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(468, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(470, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(472, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(474, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(476, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(478, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(480, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(482, 483),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(484, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(487, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(489, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(491, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(493, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(495, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(497, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(499, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(501, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(503, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(505, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(507, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(509, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(511, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(513, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(515, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(517, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(519, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(521, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(523, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(525, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(527, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(529, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(531, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(533, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(535, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(537, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(539, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(541, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(543, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(545, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(547, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(549, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(551, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(553, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(555, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(557, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(559, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(561, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(563, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(565, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(567, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(569, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(571, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(573, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(575, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(577, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(579, 580),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(581, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(584, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(586, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(588, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(590, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(592, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(594, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(596, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(598, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(600, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(602, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(604, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(606, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(608, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(610, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(612, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(614, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(616, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(618, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(620, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(622, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(624, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(626, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(628, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(630, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(632, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(634, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(636, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(638, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(640, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(642, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(644, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(646, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(648, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(650, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(652, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(654, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(656, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(658, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(660, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(662, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(664, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(666, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(668, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(670, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(672, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(674, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(676, 677),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(678, 774),
    deep_contracts::Inst::Char(&[(46, 46)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 122)]),
    deep_contracts::Inst::Split(681, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(683, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(685, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(687, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(689, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(691, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(693, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(695, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(697, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(699, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(701, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(703, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(705, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(707, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(709, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(711, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(713, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(715, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(717, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(719, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(721, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(723, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(725, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(727, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(729, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(731, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(733, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(735, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(737, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(739, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(741, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(743, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(745, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(747, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(749, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(751, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(753, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(755, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(757, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(759, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(761, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(763, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(765, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(767, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(769, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(771, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Split(773, 774),
    deep_contracts::Inst::Char(&[(45, 45), (48, 57), (95, 95), (97, 122)]),
    deep_contracts::Inst::Match,
];

static RULE_65: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_64) };

static PATTERN_66: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Split(1, 3),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(4, 40),
    deep_contracts::Inst::Char(&[(49, 57)]),
    deep_contracts::Inst::Split(6, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(8, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(10, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(12, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(14, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(16, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(18, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(20, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(22, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(24, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(26, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(28, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(30, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(32, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(34, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(36, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(38, 39),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(41, 61),
    deep_contracts::Inst::Char(&[(49, 56)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(62, 82),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(48, 49)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(83, 103),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 49)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(104, 124),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 50)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(125, 145),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(48, 50)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(146, 166),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(167, 187),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(48, 49)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(188, 208),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(48, 50)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(209, 229),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(48, 53)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(230, 250),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(48, 55)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(251, 271),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(48, 52)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(272, 292),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(48, 51)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(293, 313),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(314, 334),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(335, 355),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(48, 52)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(356, 376),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(48, 55)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(377, 397),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(398, 418),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Char(&[(45, 45)]),
    deep_contracts::Inst::Split(420, 456),
    deep_contracts::Inst::Char(&[(49, 57)]),
    deep_contracts::Inst::Split(422, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(424, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(426, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(428, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(430, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(432, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(434, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(436, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(438, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(440, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(442, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(444, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(446, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(448, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(450, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(452, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Split(454, 455),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(457, 477),
    deep_contracts::Inst::Char(&[(49, 56)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(478, 498),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(48, 49)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(499, 519),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 49)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(520, 540),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 50)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(541, 561),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(48, 50)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(562, 582),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(583, 603),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(48, 49)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(604, 624),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(48, 50)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(625, 645),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(48, 53)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(646, 666),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(48, 55)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(667, 687),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(48, 52)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(688, 708),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(48, 51)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(709, 729),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(730, 750),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(48, 54)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(751, 771),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(48, 52)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(772, 792),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(48, 55)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Split(793, 813),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(48, 55)]),
    deep_contracts::Inst::Jmp(832),
    deep_contracts::Inst::Char(&[(57, 57)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(50, 50)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(51, 51)]),
    deep_contracts::Inst::Char(&[(54, 54)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(52, 52)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(55, 55)]),
    deep_contracts::Inst::Char(&[(53, 53)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Char(&[(48, 48)]),
    deep_contracts::Inst::Char(&[(56, 56)]),
    deep_contracts::Inst::Match,
];

static RULE_67: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_66) };

#[derive(Debug, Clone, PartialEq)]
pub struct NoteOpenedDataRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Contract for NoteOpenedDataRegion {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["x", "y", "w", "h"])?;
        deep_contracts::check_member(members, at, "x", &RULE_4)?;
        deep_contracts::check_member(members, at, "y", &RULE_4)?;
        deep_contracts::check_member(members, at, "w", &RULE_4)?;
        deep_contracts::check_member(members, at, "h", &RULE_4)?;
        Ok(Self {
            x: deep_contracts::required(members, at, "x")?,
            y: deep_contracts::required(members, at, "y")?,
            w: deep_contracts::required(members, at, "w")?,
            h: deep_contracts::required(members, at, "h")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("x".to_string(), self.x.to_json()));
        members.push(("y".to_string(), self.y.to_json()));
        members.push(("w".to_string(), self.w.to_json()));
        members.push(("h".to_string(), self.h.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteOpenedData {
    pub note: String,
    pub doc: String,
    pub item: String,
    pub rev: i64,
    pub t: Option<String>,
    pub region: NoteOpenedDataRegion,
    pub text: String,
}

impl Contract for NoteOpenedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["note", "doc", "item", "rev", "t", "region", "text"])?;
        deep_contracts::check_member(members, at, "note", &RULE_0)?;
        deep_contracts::check_member(members, at, "doc", &RULE_47)?;
        deep_contracts::check_member(members, at, "item", &RULE_65)?;
        deep_contracts::check_member(members, at, "rev", &RULE_4)?;
        deep_contracts::check_member(members, at, "t", &RULE_67)?;
        deep_contracts::check_member(members, at, "text", &RULE_6)?;
        Ok(Self {
            note: deep_contracts::required(members, at, "note")?,
            doc: deep_contracts::required(members, at, "doc")?,
            item: deep_contracts::required(members, at, "item")?,
            rev: deep_contracts::required(members, at, "rev")?,
            t: deep_contracts::optional(members, at, "t")?,
            region: deep_contracts::required(members, at, "region")?,
            text: deep_contracts::required(members, at, "text")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("note".to_string(), self.note.to_json()));
        members.push(("doc".to_string(), self.doc.to_json()));
        members.push(("item".to_string(), self.item.to_json()));
        members.push(("rev".to_string(), self.rev.to_json()));
        if let Some(value) = &self.t {
            members.push(("t".to_string(), value.to_json()));
        }
        members.push(("region".to_string(), self.region.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoteOpened {
    pub v: NoteOpenedV,
    pub id: String,
    pub kind: NoteOpenedKind,
    pub subject: Option<String>,
    pub writer: NoteOpenedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: NoteOpenedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for NoteOpened {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSentV;

impl Contract for NoticeSentV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSentKind;

impl Contract for NoticeSentKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"notice.sent\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"notice.sent\"").expect("a constant is JSON")
    }
}

static PATTERN_68: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(111, 111)]),
    deep_contracts::Inst::Char(&[(116, 116)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(99, 99)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(9, 11),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(8),
    deep_contracts::Inst::Match,
];

static RULE_69: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_68) };

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSentData {
    pub notice: String,
    pub cites: Vec<String>,
}

impl Contract for NoticeSentData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["notice", "cites"])?;
        deep_contracts::check_member(members, at, "notice", &RULE_69)?;
        deep_contracts::check_member(members, at, "cites", &RULE_28)?;
        Ok(Self {
            notice: deep_contracts::required(members, at, "notice")?,
            cites: deep_contracts::required(members, at, "cites")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("notice".to_string(), self.notice.to_json()));
        members.push(("cites".to_string(), self.cites.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSent {
    pub v: NoticeSentV,
    pub id: String,
    pub kind: NoticeSentKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: NoticeSentData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for NoticeSent {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_43)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSubscribedV;

impl Contract for NoticeSubscribedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSubscribedKind;

impl Contract for NoticeSubscribedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"notice.subscribed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"notice.subscribed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSubscribedData {
    pub notice_kind: String,
    pub key: String,
    pub by: String,
}

impl Contract for NoticeSubscribedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["notice_kind", "key", "by"])?;
        deep_contracts::check_member(members, at, "notice_kind", &RULE_6)?;
        deep_contracts::check_member(members, at, "key", &RULE_6)?;
        deep_contracts::check_member(members, at, "by", &RULE_6)?;
        Ok(Self {
            notice_kind: deep_contracts::required(members, at, "notice_kind")?,
            key: deep_contracts::required(members, at, "key")?,
            by: deep_contracts::required(members, at, "by")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("notice_kind".to_string(), self.notice_kind.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        members.push(("by".to_string(), self.by.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NoticeSubscribed {
    pub v: NoticeSubscribedV,
    pub id: String,
    pub kind: NoticeSubscribedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: NoticeSubscribedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for NoticeSubscribed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemClosedV;

impl Contract for OpenItemClosedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemClosedKind;

impl Contract for OpenItemClosedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"open_item.closed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"open_item.closed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemClosedData {
    pub task_ref: String,
    pub text: String,
}

impl Contract for OpenItemClosedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["task_ref", "text"])?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "text", &RULE_6)?;
        Ok(Self {
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            text: deep_contracts::required(members, at, "text")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemClosed {
    pub v: OpenItemClosedV,
    pub id: String,
    pub kind: OpenItemClosedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: OpenItemClosedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for OpenItemClosed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemOpenedV;

impl Contract for OpenItemOpenedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemOpenedKind;

impl Contract for OpenItemOpenedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"open_item.opened\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"open_item.opened\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemOpenedData {
    pub task_ref: String,
    pub text: String,
}

impl Contract for OpenItemOpenedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["task_ref", "text"])?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "text", &RULE_6)?;
        Ok(Self {
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            text: deep_contracts::required(members, at, "text")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpenItemOpened {
    pub v: OpenItemOpenedV,
    pub id: String,
    pub kind: OpenItemOpenedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: OpenItemOpenedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for OpenItemOpened {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanProposedV;

impl Contract for PlanProposedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanProposedKind;

impl Contract for PlanProposedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"plan.proposed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"plan.proposed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanProposedDataStepsItem {
    pub does: String,
    pub changes: Vec<String>,
    pub undo: String,
    pub public: bool,
    pub cost: f64,
}

impl Contract for PlanProposedDataStepsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["does", "changes", "undo", "public", "cost"])?;
        deep_contracts::check_member(members, at, "does", &RULE_6)?;
        deep_contracts::check_member(members, at, "changes", &RULE_10)?;
        deep_contracts::check_member(members, at, "undo", &RULE_6)?;
        deep_contracts::check_member(members, at, "cost", &RULE_4)?;
        Ok(Self {
            does: deep_contracts::required(members, at, "does")?,
            changes: deep_contracts::required(members, at, "changes")?,
            undo: deep_contracts::required(members, at, "undo")?,
            public: deep_contracts::required(members, at, "public")?,
            cost: deep_contracts::required(members, at, "cost")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("does".to_string(), self.does.to_json()));
        members.push(("changes".to_string(), self.changes.to_json()));
        members.push(("undo".to_string(), self.undo.to_json()));
        members.push(("public".to_string(), self.public.to_json()));
        members.push(("cost".to_string(), self.cost.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanProposedData {
    pub ask: String,
    pub steps: Vec<PlanProposedDataStepsItem>,
    pub diff: String,
    pub hash: String,
}

impl Contract for PlanProposedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["ask", "steps", "diff", "hash"])?;
        deep_contracts::check_member(members, at, "ask", &RULE_22)?;
        deep_contracts::check_member(members, at, "diff", &RULE_20)?;
        deep_contracts::check_member(members, at, "hash", &RULE_20)?;
        Ok(Self {
            ask: deep_contracts::required(members, at, "ask")?,
            steps: deep_contracts::required(members, at, "steps")?,
            diff: deep_contracts::required(members, at, "diff")?,
            hash: deep_contracts::required(members, at, "hash")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("ask".to_string(), self.ask.to_json()));
        members.push(("steps".to_string(), self.steps.to_json()));
        members.push(("diff".to_string(), self.diff.to_json()));
        members.push(("hash".to_string(), self.hash.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanProposed {
    pub v: PlanProposedV,
    pub id: String,
    pub kind: PlanProposedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: PlanProposedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for PlanProposed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrMergedV;

impl Contract for PrMergedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrMergedKind;

impl Contract for PrMergedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"pr.merged\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"pr.merged\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrMergedData {
    pub pr: i64,
    pub merge_sha: String,
}

impl Contract for PrMergedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["pr", "merge_sha"])?;
        deep_contracts::check_member(members, at, "pr", &RULE_4)?;
        deep_contracts::check_member(members, at, "merge_sha", &RULE_24)?;
        Ok(Self {
            pr: deep_contracts::required(members, at, "pr")?,
            merge_sha: deep_contracts::required(members, at, "merge_sha")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("pr".to_string(), self.pr.to_json()));
        members.push(("merge_sha".to_string(), self.merge_sha.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrMerged {
    pub v: PrMergedV,
    pub id: String,
    pub kind: PrMergedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: PrMergedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for PrMerged {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingBatchV;

impl Contract for ReadingBatchV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingBatchKind;

impl Contract for ReadingBatchKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"reading.batch\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"reading.batch\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingBatchData {
    pub source: String,
    pub as_of: i64,
    pub file: String,
}

impl Contract for ReadingBatchData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["source", "as_of", "file"])?;
        deep_contracts::check_member(members, at, "source", &RULE_6)?;
        deep_contracts::check_member(members, at, "as_of", &RULE_4)?;
        deep_contracts::check_member(members, at, "file", &RULE_20)?;
        Ok(Self {
            source: deep_contracts::required(members, at, "source")?,
            as_of: deep_contracts::required(members, at, "as_of")?,
            file: deep_contracts::required(members, at, "file")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("source".to_string(), self.source.to_json()));
        members.push(("as_of".to_string(), self.as_of.to_json()));
        members.push(("file".to_string(), self.file.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingBatch {
    pub v: ReadingBatchV,
    pub id: String,
    pub kind: ReadingBatchKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ReadingBatchData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ReadingBatch {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRecordedV;

impl Contract for ReadingRecordedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRecordedKind;

impl Contract for ReadingRecordedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"reading.recorded\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"reading.recorded\"").expect("a constant is JSON")
    }
}

static PATTERN_70: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(97, 97)]),
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(105, 105)]),
    deep_contracts::Inst::Char(&[(110, 110)]),
    deep_contracts::Inst::Char(&[(103, 103)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(10, 12),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(9),
    deep_contracts::Inst::Match,
];

static RULE_71: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_70) };

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRecordedData {
    pub reading: String,
    pub value: f64,
    pub unit: String,
    pub as_of: i64,
    pub source: String,
    pub n: i64,
    pub outside: bool,
}

impl Contract for ReadingRecordedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["reading", "value", "unit", "as_of", "source", "n", "outside"])?;
        deep_contracts::check_member(members, at, "reading", &RULE_71)?;
        deep_contracts::check_member(members, at, "unit", &RULE_6)?;
        deep_contracts::check_member(members, at, "as_of", &RULE_4)?;
        deep_contracts::check_member(members, at, "source", &RULE_6)?;
        deep_contracts::check_member(members, at, "n", &RULE_4)?;
        Ok(Self {
            reading: deep_contracts::required(members, at, "reading")?,
            value: deep_contracts::required(members, at, "value")?,
            unit: deep_contracts::required(members, at, "unit")?,
            as_of: deep_contracts::required(members, at, "as_of")?,
            source: deep_contracts::required(members, at, "source")?,
            n: deep_contracts::required(members, at, "n")?,
            outside: deep_contracts::required(members, at, "outside")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("reading".to_string(), self.reading.to_json()));
        members.push(("value".to_string(), self.value.to_json()));
        members.push(("unit".to_string(), self.unit.to_json()));
        members.push(("as_of".to_string(), self.as_of.to_json()));
        members.push(("source".to_string(), self.source.to_json()));
        members.push(("n".to_string(), self.n.to_json()));
        members.push(("outside".to_string(), self.outside.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRecorded {
    pub v: ReadingRecordedV,
    pub id: String,
    pub kind: ReadingRecordedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ReadingRecordedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ReadingRecorded {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRollupV;

impl Contract for ReadingRollupV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRollupKind;

impl Contract for ReadingRollupKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"reading.rollup\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"reading.rollup\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRollupWriter;

impl Contract for ReadingRollupWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadingRollupDataSpan {
    Minute,
    Hour,
}

impl Contract for ReadingRollupDataSpan {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "minute" => Ok(Self::Minute),
            "hour" => Ok(Self::Hour),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Minute => "minute",
            Self::Hour => "hour",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRollupData {
    pub source: String,
    pub span: ReadingRollupDataSpan,
    pub start: i64,
    pub file: String,
}

impl Contract for ReadingRollupData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["source", "span", "start", "file"])?;
        deep_contracts::check_member(members, at, "source", &RULE_6)?;
        deep_contracts::check_member(members, at, "start", &RULE_4)?;
        deep_contracts::check_member(members, at, "file", &RULE_20)?;
        Ok(Self {
            source: deep_contracts::required(members, at, "source")?,
            span: deep_contracts::required(members, at, "span")?,
            start: deep_contracts::required(members, at, "start")?,
            file: deep_contracts::required(members, at, "file")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("source".to_string(), self.source.to_json()));
        members.push(("span".to_string(), self.span.to_json()));
        members.push(("start".to_string(), self.start.to_json()));
        members.push(("file".to_string(), self.file.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ReadingRollup {
    pub v: ReadingRollupV,
    pub id: String,
    pub kind: ReadingRollupKind,
    pub subject: Option<String>,
    pub writer: ReadingRollupWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ReadingRollupData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ReadingRollup {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunFinishedV;

impl Contract for RunFinishedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunFinishedKind;

impl Contract for RunFinishedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"run.finished\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"run.finished\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunFinishedDataOutcome {
    Passed,
    Failed,
    RanNothing,
    Missing,
    Overran,
    Stopped,
    Uncounted,
}

impl Contract for RunFinishedDataOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "passed" => Ok(Self::Passed),
            "failed" => Ok(Self::Failed),
            "ran_nothing" => Ok(Self::RanNothing),
            "missing" => Ok(Self::Missing),
            "overran" => Ok(Self::Overran),
            "stopped" => Ok(Self::Stopped),
            "uncounted" => Ok(Self::Uncounted),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Passed => "passed",
            Self::Failed => "failed",
            Self::RanNothing => "ran_nothing",
            Self::Missing => "missing",
            Self::Overran => "overran",
            Self::Stopped => "stopped",
            Self::Uncounted => "uncounted",
        }.to_string())
    }
}

static RULE_72: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_20) };

#[derive(Debug, Clone, PartialEq)]
pub struct RunFinishedData {
    pub run: String,
    pub outcome: RunFinishedDataOutcome,
    pub tests_run: i64,
    pub passed: i64,
    pub runs: i64,
    pub evidence: Vec<String>,
    pub check: String,
    pub assertion: Option<String>,
    pub expected: Option<String>,
    pub actual: Option<String>,
    pub step: Option<String>,
    pub points_to: Option<String>,
    pub findings: Vec<String>,
    pub environment: String,
}

impl Contract for RunFinishedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["run", "outcome", "tests_run", "passed", "runs", "evidence", "check", "assertion", "expected", "actual", "step", "points_to", "findings", "environment"])?;
        deep_contracts::check_member(members, at, "run", &RULE_62)?;
        deep_contracts::check_member(members, at, "tests_run", &RULE_4)?;
        deep_contracts::check_member(members, at, "passed", &RULE_4)?;
        deep_contracts::check_member(members, at, "runs", &RULE_33)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_72)?;
        deep_contracts::check_member(members, at, "check", &RULE_6)?;
        deep_contracts::check_member(members, at, "assertion", &RULE_13)?;
        deep_contracts::check_member(members, at, "expected", &RULE_13)?;
        deep_contracts::check_member(members, at, "actual", &RULE_13)?;
        deep_contracts::check_member(members, at, "step", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "findings", &RULE_10)?;
        deep_contracts::check_member(members, at, "environment", &RULE_6)?;
        Ok(Self {
            run: deep_contracts::required(members, at, "run")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            tests_run: deep_contracts::required(members, at, "tests_run")?,
            passed: deep_contracts::required(members, at, "passed")?,
            runs: deep_contracts::required(members, at, "runs")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
            check: deep_contracts::required(members, at, "check")?,
            assertion: deep_contracts::required(members, at, "assertion")?,
            expected: deep_contracts::required(members, at, "expected")?,
            actual: deep_contracts::required(members, at, "actual")?,
            step: deep_contracts::required(members, at, "step")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            findings: deep_contracts::required(members, at, "findings")?,
            environment: deep_contracts::required(members, at, "environment")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("run".to_string(), self.run.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("tests_run".to_string(), self.tests_run.to_json()));
        members.push(("passed".to_string(), self.passed.to_json()));
        members.push(("runs".to_string(), self.runs.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        members.push(("check".to_string(), self.check.to_json()));
        members.push(("assertion".to_string(), self.assertion.to_json()));
        members.push(("expected".to_string(), self.expected.to_json()));
        members.push(("actual".to_string(), self.actual.to_json()));
        members.push(("step".to_string(), self.step.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("findings".to_string(), self.findings.to_json()));
        members.push(("environment".to_string(), self.environment.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunFinished {
    pub v: RunFinishedV,
    pub id: String,
    pub kind: RunFinishedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: RunFinishedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for RunFinished {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunStartedV;

impl Contract for RunStartedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunStartedKind;

impl Contract for RunStartedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"run.started\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"run.started\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunStartedData {
    pub run: String,
    pub check: String,
    pub claim: String,
    pub commit: String,
}

impl Contract for RunStartedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["run", "check", "claim", "commit"])?;
        deep_contracts::check_member(members, at, "run", &RULE_62)?;
        deep_contracts::check_member(members, at, "check", &RULE_6)?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            run: deep_contracts::required(members, at, "run")?,
            check: deep_contracts::required(members, at, "check")?,
            claim: deep_contracts::required(members, at, "claim")?,
            commit: deep_contracts::required(members, at, "commit")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("run".to_string(), self.run.to_json()));
        members.push(("check".to_string(), self.check.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RunStarted {
    pub v: RunStartedV,
    pub id: String,
    pub kind: RunStartedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: RunStartedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for RunStarted {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionAttentionV;

impl Contract for SessionAttentionV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionAttentionKind;

impl Contract for SessionAttentionKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"session.attention\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"session.attention\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionAttentionDataState {
    Finished,
    Failed,
    WaitingPermission,
    Unknown,
}

impl Contract for SessionAttentionDataState {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "finished" => Ok(Self::Finished),
            "failed" => Ok(Self::Failed),
            "waiting_permission" => Ok(Self::WaitingPermission),
            "unknown" => Ok(Self::Unknown),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Finished => "finished",
            Self::Failed => "failed",
            Self::WaitingPermission => "waiting_permission",
            Self::Unknown => "unknown",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionAttentionData {
    pub state: SessionAttentionDataState,
}

impl Contract for SessionAttentionData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["state"])?;
        Ok(Self {
            state: deep_contracts::required(members, at, "state")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("state".to_string(), self.state.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionAttention {
    pub v: SessionAttentionV,
    pub id: String,
    pub kind: SessionAttentionKind,
    pub subject: String,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: SessionAttentionData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for SessionAttention {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_15)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionChildStartedV;

impl Contract for SessionChildStartedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionChildStartedKind;

impl Contract for SessionChildStartedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"session.child_started\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"session.child_started\"").expect("a constant is JSON")
    }
}

static RULE_73: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_14) };

static RULE_74: deep_contracts::Rule = deep_contracts::Rule::Nullable(&RULE_32);

#[derive(Debug, Clone, PartialEq)]
pub struct SessionChildStartedData {
    pub parent: String,
    pub child: String,
    pub task_ref: Option<String>,
}

impl Contract for SessionChildStartedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["parent", "child", "task_ref"])?;
        deep_contracts::check_member(members, at, "parent", &RULE_73)?;
        deep_contracts::check_member(members, at, "child", &RULE_73)?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_74)?;
        Ok(Self {
            parent: deep_contracts::required(members, at, "parent")?,
            child: deep_contracts::required(members, at, "child")?,
            task_ref: deep_contracts::required(members, at, "task_ref")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("parent".to_string(), self.parent.to_json()));
        members.push(("child".to_string(), self.child.to_json()));
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionChildStarted {
    pub v: SessionChildStartedV,
    pub id: String,
    pub kind: SessionChildStartedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: SessionChildStartedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for SessionChildStarted {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionStartV;

impl Contract for SessionStartV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionStartKind;

impl Contract for SessionStartKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"session.start\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"session.start\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionStartData {
    pub agent: String,
    pub worktree: String,
    pub branch: Option<String>,
    pub thread: String,
}

impl Contract for SessionStartData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["agent", "worktree", "branch", "thread"])?;
        deep_contracts::check_member(members, at, "agent", &RULE_6)?;
        deep_contracts::check_member(members, at, "worktree", &RULE_6)?;
        deep_contracts::check_member(members, at, "branch", &RULE_13)?;
        deep_contracts::check_member(members, at, "thread", &RULE_6)?;
        Ok(Self {
            agent: deep_contracts::required(members, at, "agent")?,
            worktree: deep_contracts::required(members, at, "worktree")?,
            branch: deep_contracts::required(members, at, "branch")?,
            thread: deep_contracts::required(members, at, "thread")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("agent".to_string(), self.agent.to_json()));
        members.push(("worktree".to_string(), self.worktree.to_json()));
        members.push(("branch".to_string(), self.branch.to_json()));
        members.push(("thread".to_string(), self.thread.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SessionStart {
    pub v: SessionStartV,
    pub id: String,
    pub kind: SessionStartKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: SessionStartData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for SessionStart {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionFiledV;

impl Contract for SuggestionFiledV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionFiledKind;

impl Contract for SuggestionFiledKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"suggestion.filed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"suggestion.filed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionFiledDataWriter {
    You,
    Shell,
    Record,
    Agent,
    Plugin,
}

impl Contract for SuggestionFiledDataWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "you" => Ok(Self::You),
            "shell" => Ok(Self::Shell),
            "record" => Ok(Self::Record),
            "agent" => Ok(Self::Agent),
            "plugin" => Ok(Self::Plugin),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::You => "you",
            Self::Shell => "shell",
            Self::Record => "record",
            Self::Agent => "agent",
            Self::Plugin => "plugin",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionFiledData {
    pub suggestion: String,
    pub doc: String,
    pub item: String,
    pub writer: SuggestionFiledDataWriter,
    pub patch: String,
    pub base: i64,
    pub ops: Vec<deep_contracts::Value>,
}

impl Contract for SuggestionFiledData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["suggestion", "doc", "item", "writer", "patch", "base", "ops"])?;
        deep_contracts::check_member(members, at, "suggestion", &RULE_6)?;
        deep_contracts::check_member(members, at, "doc", &RULE_47)?;
        deep_contracts::check_member(members, at, "item", &RULE_65)?;
        deep_contracts::check_member(members, at, "patch", &RULE_0)?;
        deep_contracts::check_member(members, at, "base", &RULE_4)?;
        Ok(Self {
            suggestion: deep_contracts::required(members, at, "suggestion")?,
            doc: deep_contracts::required(members, at, "doc")?,
            item: deep_contracts::required(members, at, "item")?,
            writer: deep_contracts::required(members, at, "writer")?,
            patch: deep_contracts::required(members, at, "patch")?,
            base: deep_contracts::required(members, at, "base")?,
            ops: deep_contracts::required(members, at, "ops")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("suggestion".to_string(), self.suggestion.to_json()));
        members.push(("doc".to_string(), self.doc.to_json()));
        members.push(("item".to_string(), self.item.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("patch".to_string(), self.patch.to_json()));
        members.push(("base".to_string(), self.base.to_json()));
        members.push(("ops".to_string(), self.ops.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionFiled {
    pub v: SuggestionFiledV,
    pub id: String,
    pub kind: SuggestionFiledKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: SuggestionFiledData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for SuggestionFiled {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_26)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionSettledV;

impl Contract for SuggestionSettledV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionSettledKind;

impl Contract for SuggestionSettledKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"suggestion.settled\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"suggestion.settled\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionSettledWriter {
    App,
    Core,
}

impl Contract for SuggestionSettledWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "app" => Ok(Self::App),
            "core" => Ok(Self::Core),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::App => "app",
            Self::Core => "core",
        }.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuggestionSettledDataOutcome {
    Accepted,
    Superseded,
}

impl Contract for SuggestionSettledDataOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "accepted" => Ok(Self::Accepted),
            "superseded" => Ok(Self::Superseded),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Accepted => "accepted",
            Self::Superseded => "superseded",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionSettledData {
    pub suggestion: String,
    pub outcome: SuggestionSettledDataOutcome,
    pub rev: i64,
}

impl Contract for SuggestionSettledData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["suggestion", "outcome", "rev"])?;
        deep_contracts::check_member(members, at, "suggestion", &RULE_6)?;
        deep_contracts::check_member(members, at, "rev", &RULE_4)?;
        Ok(Self {
            suggestion: deep_contracts::required(members, at, "suggestion")?,
            outcome: deep_contracts::required(members, at, "outcome")?,
            rev: deep_contracts::required(members, at, "rev")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("suggestion".to_string(), self.suggestion.to_json()));
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("rev".to_string(), self.rev.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestionSettled {
    pub v: SuggestionSettledV,
    pub id: String,
    pub kind: SuggestionSettledKind,
    pub subject: Option<String>,
    pub writer: SuggestionSettledWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: SuggestionSettledData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for SuggestionSettled {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskClosedV;

impl Contract for TaskClosedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskClosedKind;

impl Contract for TaskClosedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"task.closed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"task.closed\"").expect("a constant is JSON")
    }
}

static RULE_75: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_31) };

#[derive(Debug, Clone, PartialEq)]
pub struct TaskClosedWriter;

impl Contract for TaskClosedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskClosedData {
    pub by_verdict: String,
}

impl Contract for TaskClosedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["by_verdict"])?;
        deep_contracts::check_member(members, at, "by_verdict", &RULE_37)?;
        Ok(Self {
            by_verdict: deep_contracts::required(members, at, "by_verdict")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("by_verdict".to_string(), self.by_verdict.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskClosed {
    pub v: TaskClosedV,
    pub id: String,
    pub kind: TaskClosedKind,
    pub subject: String,
    pub writer: TaskClosedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: TaskClosedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for TaskClosed {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_75)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::required(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("subject".to_string(), self.subject.to_json()));
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskCreatedV;

impl Contract for TaskCreatedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskCreatedKind;

impl Contract for TaskCreatedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"task.created\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"task.created\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskCreatedData {
    pub task_ref: String,
    pub thread: String,
    pub owner: String,
    pub title: String,
}

impl Contract for TaskCreatedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["task_ref", "thread", "owner", "title"])?;
        deep_contracts::check_member(members, at, "task_ref", &RULE_32)?;
        deep_contracts::check_member(members, at, "thread", &RULE_6)?;
        deep_contracts::check_member(members, at, "owner", &RULE_6)?;
        deep_contracts::check_member(members, at, "title", &RULE_6)?;
        Ok(Self {
            task_ref: deep_contracts::required(members, at, "task_ref")?,
            thread: deep_contracts::required(members, at, "thread")?,
            owner: deep_contracts::required(members, at, "owner")?,
            title: deep_contracts::required(members, at, "title")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("task_ref".to_string(), self.task_ref.to_json()));
        members.push(("thread".to_string(), self.thread.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("title".to_string(), self.title.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskCreated {
    pub v: TaskCreatedV,
    pub id: String,
    pub kind: TaskCreatedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: TaskCreatedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for TaskCreated {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolAfterV;

impl Contract for ToolAfterV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolAfterKind;

impl Contract for ToolAfterKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"tool.after\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"tool.after\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolAfterDataKind {
    Shell,
    Read,
    Edit,
    Write,
    Search,
    Fetch,
    Mcp,
    Unknown,
}

impl Contract for ToolAfterDataKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "shell" => Ok(Self::Shell),
            "read" => Ok(Self::Read),
            "edit" => Ok(Self::Edit),
            "write" => Ok(Self::Write),
            "search" => Ok(Self::Search),
            "fetch" => Ok(Self::Fetch),
            "mcp" => Ok(Self::Mcp),
            "unknown" => Ok(Self::Unknown),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Shell => "shell",
            Self::Read => "read",
            Self::Edit => "edit",
            Self::Write => "write",
            Self::Search => "search",
            Self::Fetch => "fetch",
            Self::Mcp => "mcp",
            Self::Unknown => "unknown",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolAfterData {
    pub kind: ToolAfterDataKind,
    pub paths: Vec<String>,
    pub command: Option<String>,
    pub server: Option<String>,
    pub tool: Option<String>,
}

impl Contract for ToolAfterData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "paths", "command", "server", "tool"])?;
        deep_contracts::check_member(members, at, "paths", &RULE_10)?;
        deep_contracts::check_member(members, at, "command", &RULE_13)?;
        deep_contracts::check_member(members, at, "server", &RULE_6)?;
        deep_contracts::check_member(members, at, "tool", &RULE_6)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            paths: deep_contracts::required(members, at, "paths")?,
            command: deep_contracts::required(members, at, "command")?,
            server: deep_contracts::optional(members, at, "server")?,
            tool: deep_contracts::optional(members, at, "tool")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("paths".to_string(), self.paths.to_json()));
        members.push(("command".to_string(), self.command.to_json()));
        if let Some(value) = &self.server {
            members.push(("server".to_string(), value.to_json()));
        }
        if let Some(value) = &self.tool {
            members.push(("tool".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolAfter {
    pub v: ToolAfterV,
    pub id: String,
    pub kind: ToolAfterKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ToolAfterData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ToolAfter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolBeforeV;

impl Contract for ToolBeforeV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolBeforeKind;

impl Contract for ToolBeforeKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"tool.before\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"tool.before\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolBeforeDataKind {
    Shell,
    Read,
    Edit,
    Write,
    Search,
    Fetch,
    Mcp,
    Unknown,
}

impl Contract for ToolBeforeDataKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "shell" => Ok(Self::Shell),
            "read" => Ok(Self::Read),
            "edit" => Ok(Self::Edit),
            "write" => Ok(Self::Write),
            "search" => Ok(Self::Search),
            "fetch" => Ok(Self::Fetch),
            "mcp" => Ok(Self::Mcp),
            "unknown" => Ok(Self::Unknown),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Shell => "shell",
            Self::Read => "read",
            Self::Edit => "edit",
            Self::Write => "write",
            Self::Search => "search",
            Self::Fetch => "fetch",
            Self::Mcp => "mcp",
            Self::Unknown => "unknown",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolBeforeData {
    pub kind: ToolBeforeDataKind,
    pub paths: Vec<String>,
    pub command: Option<String>,
    pub server: Option<String>,
    pub tool: Option<String>,
}

impl Contract for ToolBeforeData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["kind", "paths", "command", "server", "tool"])?;
        deep_contracts::check_member(members, at, "paths", &RULE_10)?;
        deep_contracts::check_member(members, at, "command", &RULE_13)?;
        deep_contracts::check_member(members, at, "server", &RULE_6)?;
        deep_contracts::check_member(members, at, "tool", &RULE_6)?;
        Ok(Self {
            kind: deep_contracts::required(members, at, "kind")?,
            paths: deep_contracts::required(members, at, "paths")?,
            command: deep_contracts::required(members, at, "command")?,
            server: deep_contracts::optional(members, at, "server")?,
            tool: deep_contracts::optional(members, at, "tool")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("kind".to_string(), self.kind.to_json()));
        members.push(("paths".to_string(), self.paths.to_json()));
        members.push(("command".to_string(), self.command.to_json()));
        if let Some(value) = &self.server {
            members.push(("server".to_string(), value.to_json()));
        }
        if let Some(value) = &self.tool {
            members.push(("tool".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolBefore {
    pub v: ToolBeforeV,
    pub id: String,
    pub kind: ToolBeforeKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: ToolBeforeData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for ToolBefore {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptArchivedV;

impl Contract for TranscriptArchivedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptArchivedKind;

impl Contract for TranscriptArchivedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"transcript.archived\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"transcript.archived\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptArchivedData {
    pub session: String,
    pub evidence: String,
}

impl Contract for TranscriptArchivedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["session", "evidence"])?;
        deep_contracts::check_member(members, at, "session", &RULE_73)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_20)?;
        Ok(Self {
            session: deep_contracts::required(members, at, "session")?,
            evidence: deep_contracts::required(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("session".to_string(), self.session.to_json()));
        members.push(("evidence".to_string(), self.evidence.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptArchived {
    pub v: TranscriptArchivedV,
    pub id: String,
    pub kind: TranscriptArchivedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: TranscriptArchivedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for TranscriptArchived {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserAskV;

impl Contract for UserAskV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserAskKind;

impl Contract for UserAskKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"user.ask\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"user.ask\"").expect("a constant is JSON")
    }
}

static RULE_76: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_32) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserAskDataFrom {
    Person,
    Scheduled,
    Subagent,
    Session,
    Continuation,
    Unknown,
}

impl Contract for UserAskDataFrom {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "person" => Ok(Self::Person),
            "scheduled" => Ok(Self::Scheduled),
            "subagent" => Ok(Self::Subagent),
            "session" => Ok(Self::Session),
            "continuation" => Ok(Self::Continuation),
            "unknown" => Ok(Self::Unknown),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::Person => "person",
            Self::Scheduled => "scheduled",
            Self::Subagent => "subagent",
            Self::Session => "session",
            Self::Continuation => "continuation",
            Self::Unknown => "unknown",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserAskData {
    pub msg: i64,
    pub text: String,
    pub tasks: Vec<String>,
    pub from: UserAskDataFrom,
}

impl Contract for UserAskData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["msg", "text", "tasks", "from"])?;
        deep_contracts::check_member(members, at, "msg", &RULE_4)?;
        deep_contracts::check_member(members, at, "text", &RULE_12)?;
        deep_contracts::check_member(members, at, "tasks", &RULE_76)?;
        Ok(Self {
            msg: deep_contracts::required(members, at, "msg")?,
            text: deep_contracts::required(members, at, "text")?,
            tasks: deep_contracts::required(members, at, "tasks")?,
            from: deep_contracts::required(members, at, "from")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("msg".to_string(), self.msg.to_json()));
        members.push(("text".to_string(), self.text.to_json()));
        members.push(("tasks".to_string(), self.tasks.to_json()));
        members.push(("from".to_string(), self.from.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UserAsk {
    pub v: UserAskV,
    pub id: String,
    pub kind: UserAskKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: UserAskData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for UserAsk {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

static PATTERN_77: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(114, 114)]),
    deep_contracts::Inst::Char(&[(101, 101)]),
    deep_contracts::Inst::Char(&[(113, 113)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Split(6, 8),
    deep_contracts::Inst::Char(&[(48, 57), (65, 90), (97, 122)]),
    deep_contracts::Inst::Jmp(5),
    deep_contracts::Inst::Char(&[(35, 35)]),
    deep_contracts::Inst::Char(&[(82, 82)]),
    deep_contracts::Inst::Char(&[(49, 57)]),
    deep_contracts::Inst::Split(12, 14),
    deep_contracts::Inst::Char(&[(48, 57)]),
    deep_contracts::Inst::Jmp(11),
    deep_contracts::Inst::Match,
];

static RULE_78: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_77) };

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictMadeRequirementsItemOutcome {
    Pass,
    Fail,
    Invalid,
    Blocked,
    Inconclusive,
    Pending,
}

impl Contract for VerdictMadeRequirementsItemOutcome {
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
pub enum VerdictMadeRequirementsItemOracle {
    Code,
    Model,
    Person,
}

impl Contract for VerdictMadeRequirementsItemOracle {
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

static RULE_79: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_62) };

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeRequirementsItemRuns {
    pub clean: i64,
    pub needed: i64,
    pub counted: Vec<String>,
}

impl Contract for VerdictMadeRequirementsItemRuns {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["clean", "needed", "counted"])?;
        deep_contracts::check_member(members, at, "clean", &RULE_33)?;
        deep_contracts::check_member(members, at, "needed", &RULE_33)?;
        deep_contracts::check_member(members, at, "counted", &RULE_79)?;
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
pub enum VerdictMadeRequirementsItemProof {
    Statement,
    StaticCheck,
    TestRun,
    Journey,
    Decision,
}

impl Contract for VerdictMadeRequirementsItemProof {
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
pub struct VerdictMadeRequirementsItem {
    pub req: String,
    pub outcome: VerdictMadeRequirementsItemOutcome,
    pub check: String,
    pub depth: String,
    pub oracle: VerdictMadeRequirementsItemOracle,
    pub runs: VerdictMadeRequirementsItemRuns,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub evidence: Vec<String>,
    pub proof: VerdictMadeRequirementsItemProof,
    pub ask: Option<String>,
}

impl Contract for VerdictMadeRequirementsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["req", "outcome", "check", "depth", "oracle", "runs", "smallest", "points_to", "evidence", "proof", "ask"])?;
        deep_contracts::check_member(members, at, "req", &RULE_78)?;
        deep_contracts::check_member(members, at, "check", &RULE_6)?;
        deep_contracts::check_member(members, at, "depth", &RULE_6)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_72)?;
        deep_contracts::check_member(members, at, "ask", &RULE_22)?;
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

pub type VerdictMadeRequirements = Vec<VerdictMadeRequirementsItem>;

static PATTERN_80: &[deep_contracts::Inst] = &[
    deep_contracts::Inst::Char(&[(100, 100)]),
    deep_contracts::Inst::Char(&[(49, 49)]),
    deep_contracts::Inst::Char(&[(58, 58)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Char(&[(48, 57), (97, 102)]),
    deep_contracts::Inst::Match,
];

static RULE_81: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: Some(8192), format: None, pattern: Some(PATTERN_80) };

static RULE_82: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_81) };

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeKey {
    pub commit: String,
    pub doc_revisions: Vec<String>,
    pub check_digests: Vec<String>,
    pub state_digests: Vec<String>,
    pub environment: String,
    pub tools: Vec<String>,
}

impl Contract for VerdictMadeKey {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["commit", "doc_revisions", "check_digests", "state_digests", "environment", "tools"])?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        deep_contracts::check_member(members, at, "doc_revisions", &RULE_10)?;
        deep_contracts::check_member(members, at, "check_digests", &RULE_82)?;
        deep_contracts::check_member(members, at, "state_digests", &RULE_72)?;
        deep_contracts::check_member(members, at, "environment", &RULE_6)?;
        deep_contracts::check_member(members, at, "tools", &RULE_10)?;
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
pub struct VerdictMadeV;

impl Contract for VerdictMadeV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeKind;

impl Contract for VerdictMadeKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"verdict.made\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"verdict.made\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeWriter;

impl Contract for VerdictMadeWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataPassOutcome;

impl Contract for VerdictMadeDataPassOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"PASS\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"PASS\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataPassRequirementsItemOutcome;

impl Contract for VerdictMadeDataPassRequirementsItemOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"PASS\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"PASS\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerdictMadeDataPassRequirementsItemOracle {
    Code,
    Model,
    Person,
}

impl Contract for VerdictMadeDataPassRequirementsItemOracle {
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
pub struct VerdictMadeDataPassRequirementsItemRuns {
    pub clean: i64,
    pub needed: i64,
    pub counted: Vec<String>,
}

impl Contract for VerdictMadeDataPassRequirementsItemRuns {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["clean", "needed", "counted"])?;
        deep_contracts::check_member(members, at, "clean", &RULE_33)?;
        deep_contracts::check_member(members, at, "needed", &RULE_33)?;
        deep_contracts::check_member(members, at, "counted", &RULE_79)?;
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
pub enum VerdictMadeDataPassRequirementsItemProof {
    Statement,
    StaticCheck,
    TestRun,
    Journey,
    Decision,
}

impl Contract for VerdictMadeDataPassRequirementsItemProof {
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
pub struct VerdictMadeDataPassRequirementsItem {
    pub req: String,
    pub outcome: VerdictMadeDataPassRequirementsItemOutcome,
    pub check: String,
    pub depth: String,
    pub oracle: VerdictMadeDataPassRequirementsItemOracle,
    pub runs: VerdictMadeDataPassRequirementsItemRuns,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub evidence: Vec<String>,
    pub proof: VerdictMadeDataPassRequirementsItemProof,
    pub ask: Option<String>,
}

impl Contract for VerdictMadeDataPassRequirementsItem {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["req", "outcome", "check", "depth", "oracle", "runs", "smallest", "points_to", "evidence", "proof", "ask"])?;
        deep_contracts::check_member(members, at, "req", &RULE_78)?;
        deep_contracts::check_member(members, at, "check", &RULE_6)?;
        deep_contracts::check_member(members, at, "depth", &RULE_6)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_72)?;
        deep_contracts::check_member(members, at, "ask", &RULE_22)?;
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
pub struct VerdictMadeDataPass {
    pub outcome: VerdictMadeDataPassOutcome,
    pub verdict: String,
    pub claim: String,
    pub reasons: Vec<String>,
    pub requirements: Vec<VerdictMadeDataPassRequirementsItem>,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictMadeKey,
}

impl Contract for VerdictMadeDataPass {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["outcome", "verdict", "claim", "reasons", "requirements", "smallest", "points_to", "commit", "key"])?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_10)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            outcome: deep_contracts::required(members, at, "outcome")?,
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataFailOutcome;

impl Contract for VerdictMadeDataFailOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"FAIL\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"FAIL\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataFail {
    pub outcome: VerdictMadeDataFailOutcome,
    pub verdict: String,
    pub claim: String,
    pub reasons: Vec<String>,
    pub requirements: VerdictMadeRequirements,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictMadeKey,
}

impl Contract for VerdictMadeDataFail {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["outcome", "verdict", "claim", "reasons", "requirements", "smallest", "points_to", "commit", "key"])?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_10)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            outcome: deep_contracts::required(members, at, "outcome")?,
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataInvalidOutcome;

impl Contract for VerdictMadeDataInvalidOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"INVALID\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"INVALID\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataInvalid {
    pub outcome: VerdictMadeDataInvalidOutcome,
    pub verdict: String,
    pub claim: String,
    pub reasons: Vec<String>,
    pub requirements: VerdictMadeRequirements,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictMadeKey,
}

impl Contract for VerdictMadeDataInvalid {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["outcome", "verdict", "claim", "reasons", "requirements", "smallest", "points_to", "commit", "key"])?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_10)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            outcome: deep_contracts::required(members, at, "outcome")?,
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataBlockedOutcome;

impl Contract for VerdictMadeDataBlockedOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"BLOCKED\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"BLOCKED\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataBlocked {
    pub outcome: VerdictMadeDataBlockedOutcome,
    pub verdict: String,
    pub claim: String,
    pub reasons: Vec<String>,
    pub requirements: VerdictMadeRequirements,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictMadeKey,
}

impl Contract for VerdictMadeDataBlocked {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["outcome", "verdict", "claim", "reasons", "requirements", "smallest", "points_to", "commit", "key"])?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_10)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            outcome: deep_contracts::required(members, at, "outcome")?,
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataInconclusiveOutcome;

impl Contract for VerdictMadeDataInconclusiveOutcome {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"INCONCLUSIVE\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"INCONCLUSIVE\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMadeDataInconclusive {
    pub outcome: VerdictMadeDataInconclusiveOutcome,
    pub verdict: String,
    pub claim: String,
    pub reasons: Vec<String>,
    pub requirements: VerdictMadeRequirements,
    pub smallest: Option<String>,
    pub points_to: Option<String>,
    pub commit: String,
    pub key: VerdictMadeKey,
}

impl Contract for VerdictMadeDataInconclusive {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["outcome", "verdict", "claim", "reasons", "requirements", "smallest", "points_to", "commit", "key"])?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "claim", &RULE_35)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_10)?;
        deep_contracts::check_member(members, at, "smallest", &RULE_13)?;
        deep_contracts::check_member(members, at, "points_to", &RULE_13)?;
        deep_contracts::check_member(members, at, "commit", &RULE_24)?;
        Ok(Self {
            outcome: deep_contracts::required(members, at, "outcome")?,
            verdict: deep_contracts::required(members, at, "verdict")?,
            claim: deep_contracts::required(members, at, "claim")?,
            reasons: deep_contracts::required(members, at, "reasons")?,
            requirements: deep_contracts::required(members, at, "requirements")?,
            smallest: deep_contracts::required(members, at, "smallest")?,
            points_to: deep_contracts::required(members, at, "points_to")?,
            commit: deep_contracts::required(members, at, "commit")?,
            key: deep_contracts::required(members, at, "key")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("outcome".to_string(), self.outcome.to_json()));
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("claim".to_string(), self.claim.to_json()));
        members.push(("reasons".to_string(), self.reasons.to_json()));
        members.push(("requirements".to_string(), self.requirements.to_json()));
        members.push(("smallest".to_string(), self.smallest.to_json()));
        members.push(("points_to".to_string(), self.points_to.to_json()));
        members.push(("commit".to_string(), self.commit.to_json()));
        members.push(("key".to_string(), self.key.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum VerdictMadeData {
    Pass(VerdictMadeDataPass),
    Fail(VerdictMadeDataFail),
    Invalid(VerdictMadeDataInvalid),
    Blocked(VerdictMadeDataBlocked),
    Inconclusive(VerdictMadeDataInconclusive),
}

impl Contract for VerdictMadeData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::tag(value, at, "outcome")?.as_str() {
            "\"PASS\"" => Ok(Self::Pass(<VerdictMadeDataPass as Contract>::from_json(value, at)?)),
            "\"FAIL\"" => Ok(Self::Fail(<VerdictMadeDataFail as Contract>::from_json(value, at)?)),
            "\"INVALID\"" => Ok(Self::Invalid(<VerdictMadeDataInvalid as Contract>::from_json(value, at)?)),
            "\"BLOCKED\"" => Ok(Self::Blocked(<VerdictMadeDataBlocked as Contract>::from_json(value, at)?)),
            "\"INCONCLUSIVE\"" => Ok(Self::Inconclusive(<VerdictMadeDataInconclusive as Contract>::from_json(value, at)?)),
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

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictMade {
    pub v: VerdictMadeV,
    pub id: String,
    pub kind: VerdictMadeKind,
    pub subject: Option<String>,
    pub writer: VerdictMadeWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: VerdictMadeData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for VerdictMade {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictStaleV;

impl Contract for VerdictStaleV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictStaleKind;

impl Contract for VerdictStaleKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"verdict.stale\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"verdict.stale\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictStaleWriter;

impl Contract for VerdictStaleWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"core\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"core\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictStaleData {
    pub verdict: String,
    pub because: String,
}

impl Contract for VerdictStaleData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["verdict", "because"])?;
        deep_contracts::check_member(members, at, "verdict", &RULE_37)?;
        deep_contracts::check_member(members, at, "because", &RULE_6)?;
        Ok(Self {
            verdict: deep_contracts::required(members, at, "verdict")?,
            because: deep_contracts::required(members, at, "because")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("verdict".to_string(), self.verdict.to_json()));
        members.push(("because".to_string(), self.because.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictStale {
    pub v: VerdictStaleV,
    pub id: String,
    pub kind: VerdictStaleKind,
    pub subject: Option<String>,
    pub writer: VerdictStaleWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: VerdictStaleData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for VerdictStale {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

static RULE_83: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_77) };

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

static RULE_84: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_61) };

static RULE_85: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_84) };

#[derive(Debug, Clone, PartialEq)]
pub struct VerdictRequirementRuns {
    pub clean: i64,
    pub needed: i64,
    pub counted: Vec<String>,
}

impl Contract for VerdictRequirementRuns {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["clean", "needed", "counted"])?;
        deep_contracts::check_member(members, at, "clean", &RULE_33)?;
        deep_contracts::check_member(members, at, "needed", &RULE_33)?;
        deep_contracts::check_member(members, at, "counted", &RULE_85)?;
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
        deep_contracts::check_member(members, at, "req", &RULE_83)?;
        deep_contracts::check_member(members, at, "check", &RULE_3)?;
        deep_contracts::check_member(members, at, "depth", &RULE_3)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        deep_contracts::check_member(members, at, "ask", &RULE_19)?;
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
        deep_contracts::check_member(members, at, "clean", &RULE_33)?;
        deep_contracts::check_member(members, at, "needed", &RULE_33)?;
        deep_contracts::check_member(members, at, "counted", &RULE_85)?;
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
        deep_contracts::check_member(members, at, "req", &RULE_83)?;
        deep_contracts::check_member(members, at, "check", &RULE_3)?;
        deep_contracts::check_member(members, at, "depth", &RULE_3)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        deep_contracts::check_member(members, at, "ask", &RULE_19)?;
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

static RULE_86: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_23) };

static RULE_87: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_80) };

static RULE_88: deep_contracts::Rule = deep_contracts::Rule::Array { min: None, max: None, items: Some(&RULE_87) };

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
        deep_contracts::check_member(members, at, "commit", &RULE_86)?;
        deep_contracts::check_member(members, at, "doc_revisions", &RULE_29)?;
        deep_contracts::check_member(members, at, "check_digests", &RULE_88)?;
        deep_contracts::check_member(members, at, "state_digests", &RULE_9)?;
        deep_contracts::check_member(members, at, "environment", &RULE_3)?;
        deep_contracts::check_member(members, at, "tools", &RULE_29)?;
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

static RULE_89: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_36) };

static RULE_90: deep_contracts::Rule = deep_contracts::Rule::String { min: None, max: None, format: None, pattern: Some(PATTERN_34) };

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
        deep_contracts::check_member(members, at, "verdict", &RULE_89)?;
        deep_contracts::check_member(members, at, "claim", &RULE_90)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_29)?;
        deep_contracts::check_member(members, at, "commit", &RULE_86)?;
        deep_contracts::check_member(members, at, "checkout", &RULE_3)?;
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
        deep_contracts::check_member(members, at, "verdict", &RULE_89)?;
        deep_contracts::check_member(members, at, "claim", &RULE_90)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_29)?;
        deep_contracts::check_member(members, at, "commit", &RULE_86)?;
        deep_contracts::check_member(members, at, "checkout", &RULE_3)?;
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
        deep_contracts::check_member(members, at, "verdict", &RULE_89)?;
        deep_contracts::check_member(members, at, "claim", &RULE_90)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_29)?;
        deep_contracts::check_member(members, at, "commit", &RULE_86)?;
        deep_contracts::check_member(members, at, "checkout", &RULE_3)?;
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
        deep_contracts::check_member(members, at, "verdict", &RULE_89)?;
        deep_contracts::check_member(members, at, "claim", &RULE_90)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_29)?;
        deep_contracts::check_member(members, at, "commit", &RULE_86)?;
        deep_contracts::check_member(members, at, "checkout", &RULE_3)?;
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
        deep_contracts::check_member(members, at, "verdict", &RULE_89)?;
        deep_contracts::check_member(members, at, "claim", &RULE_90)?;
        deep_contracts::check_member(members, at, "reasons", &RULE_29)?;
        deep_contracts::check_member(members, at, "commit", &RULE_86)?;
        deep_contracts::check_member(members, at, "checkout", &RULE_3)?;
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

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeCreatedV;

impl Contract for WorktreeCreatedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeCreatedKind;

impl Contract for WorktreeCreatedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"worktree.created\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"worktree.created\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeCreatedData {
    pub path: String,
    pub branch: Option<String>,
    pub owner: String,
    pub base: String,
}

impl Contract for WorktreeCreatedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["path", "branch", "owner", "base"])?;
        deep_contracts::check_member(members, at, "path", &RULE_6)?;
        deep_contracts::check_member(members, at, "branch", &RULE_13)?;
        deep_contracts::check_member(members, at, "owner", &RULE_32)?;
        deep_contracts::check_member(members, at, "base", &RULE_24)?;
        Ok(Self {
            path: deep_contracts::required(members, at, "path")?,
            branch: deep_contracts::required(members, at, "branch")?,
            owner: deep_contracts::required(members, at, "owner")?,
            base: deep_contracts::required(members, at, "base")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("path".to_string(), self.path.to_json()));
        members.push(("branch".to_string(), self.branch.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        members.push(("base".to_string(), self.base.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeCreated {
    pub v: WorktreeCreatedV,
    pub id: String,
    pub kind: WorktreeCreatedKind,
    pub subject: Option<String>,
    pub writer: String,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: WorktreeCreatedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for WorktreeCreated {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "writer", &RULE_17)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeRemovedV;

impl Contract for WorktreeRemovedV {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "1").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("1").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeRemovedKind;

impl Contract for WorktreeRemovedKind {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        deep_contracts::constant(value, at, "\"worktree.removed\"").map(|()| Self)
    }
    fn to_json(&self) -> Value {
        deep_contracts::parse("\"worktree.removed\"").expect("a constant is JSON")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeRemovedWriter {
    App,
}

impl Contract for WorktreeRemovedWriter {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        match deep_contracts::string(value, at)? {
            "app" => Ok(Self::App),
            other => Err(format!("{at}: {other:?} is not one of the listed values")),
        }
    }
    fn to_json(&self) -> Value {
        Value::String(match self {
            Self::App => "app",
        }.to_string())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeRemovedData {
    pub path: String,
    pub branch: Option<String>,
    pub owner: String,
}

impl Contract for WorktreeRemovedData {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["path", "branch", "owner"])?;
        deep_contracts::check_member(members, at, "path", &RULE_6)?;
        deep_contracts::check_member(members, at, "branch", &RULE_13)?;
        deep_contracts::check_member(members, at, "owner", &RULE_32)?;
        Ok(Self {
            path: deep_contracts::required(members, at, "path")?,
            branch: deep_contracts::required(members, at, "branch")?,
            owner: deep_contracts::required(members, at, "owner")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("path".to_string(), self.path.to_json()));
        members.push(("branch".to_string(), self.branch.to_json()));
        members.push(("owner".to_string(), self.owner.to_json()));
        Value::Object(members)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeRemoved {
    pub v: WorktreeRemovedV,
    pub id: String,
    pub kind: WorktreeRemovedKind,
    pub subject: Option<String>,
    pub writer: WorktreeRemovedWriter,
    pub actor: String,
    pub scope: String,
    pub ts: i64,
    pub seq: Option<deep_contracts::Seq>,
    pub log_pos: Option<i64>,
    pub data: WorktreeRemovedData,
    pub evidence: Option<Vec<String>>,
}

impl Contract for WorktreeRemoved {
    fn from_json(value: &Value, at: &str) -> Result<Self, String> {
        let members = deep_contracts::members(value, at, &["v", "id", "kind", "subject", "writer", "actor", "scope", "ts", "seq", "log_pos", "data", "evidence"])?;
        deep_contracts::check_member(members, at, "id", &RULE_0)?;
        deep_contracts::check_member(members, at, "subject", &RULE_2)?;
        deep_contracts::check_member(members, at, "actor", &RULE_3)?;
        deep_contracts::check_member(members, at, "scope", &RULE_3)?;
        deep_contracts::check_member(members, at, "ts", &RULE_4)?;
        deep_contracts::check_member(members, at, "log_pos", &RULE_5)?;
        deep_contracts::check_member(members, at, "evidence", &RULE_9)?;
        Ok(Self {
            v: deep_contracts::required(members, at, "v")?,
            id: deep_contracts::required(members, at, "id")?,
            kind: deep_contracts::required(members, at, "kind")?,
            subject: deep_contracts::optional(members, at, "subject")?,
            writer: deep_contracts::required(members, at, "writer")?,
            actor: deep_contracts::required(members, at, "actor")?,
            scope: deep_contracts::required(members, at, "scope")?,
            ts: deep_contracts::required(members, at, "ts")?,
            seq: deep_contracts::optional(members, at, "seq")?,
            log_pos: deep_contracts::optional(members, at, "log_pos")?,
            data: deep_contracts::required(members, at, "data")?,
            evidence: deep_contracts::optional(members, at, "evidence")?,
        })
    }
    fn to_json(&self) -> Value {
        let mut members = Vec::new();
        members.push(("v".to_string(), self.v.to_json()));
        members.push(("id".to_string(), self.id.to_json()));
        members.push(("kind".to_string(), self.kind.to_json()));
        if let Some(value) = &self.subject {
            members.push(("subject".to_string(), value.to_json()));
        }
        members.push(("writer".to_string(), self.writer.to_json()));
        members.push(("actor".to_string(), self.actor.to_json()));
        members.push(("scope".to_string(), self.scope.to_json()));
        members.push(("ts".to_string(), self.ts.to_json()));
        if let Some(value) = &self.seq {
            members.push(("seq".to_string(), value.to_json()));
        }
        if let Some(value) = &self.log_pos {
            members.push(("log_pos".to_string(), value.to_json()));
        }
        members.push(("data".to_string(), self.data.to_json()));
        if let Some(value) = &self.evidence {
            members.push(("evidence".to_string(), value.to_json()));
        }
        Value::Object(members)
    }
}

/// Decodes `json` into the generated type for `schema` and returns its RFC 8785 text.
pub fn roundtrip(schema: &str, json: &str) -> Result<String, String> {
    let value = deep_contracts::parse(json)?;
    let typed = match schema {
        "action.entered@1" => <ActionEntered as Contract>::from_json(&value, "")?.to_json(),
        "action.reported@1" => <ActionReported as Contract>::from_json(&value, "")?.to_json(),
        "agent.stop@1" => <AgentStop as Contract>::from_json(&value, "")?.to_json(),
        "ask.answered@1" => <AskAnswered as Contract>::from_json(&value, "")?.to_json(),
        "ask.batched@1" => <AskBatched as Contract>::from_json(&value, "")?.to_json(),
        "ask.cancelled@1" => <AskCancelled as Contract>::from_json(&value, "")?.to_json(),
        "ask.created@1" => <AskCreated as Contract>::from_json(&value, "")?.to_json(),
        "ask.defaulted@1" => <AskDefaulted as Contract>::from_json(&value, "")?.to_json(),
        "ask.escalated@1" => <AskEscalated as Contract>::from_json(&value, "")?.to_json(),
        "ask.later@1" => <AskLater as Contract>::from_json(&value, "")?.to_json(),
        "check@1" => <Check as Contract>::from_json(&value, "")?.to_json(),
        "claim.made@1" => <ClaimMade as Contract>::from_json(&value, "")?.to_json(),
        "claim.sent_back@1" => <ClaimSentBack as Contract>::from_json(&value, "")?.to_json(),
        "claim.stalled@1" => <ClaimStalled as Contract>::from_json(&value, "")?.to_json(),
        "decision.applied@1" => <DecisionApplied as Contract>::from_json(&value, "")?.to_json(),
        "decision.created@1" => <DecisionCreated as Contract>::from_json(&value, "")?.to_json(),
        "definition.drafted@1" => <DefinitionDrafted as Contract>::from_json(&value, "")?.to_json(),
        "definition.locked@1" => <DefinitionLocked as Contract>::from_json(&value, "")?.to_json(),
        "definition.revised@1" => <DefinitionRevised as Contract>::from_json(&value, "")?.to_json(),
        "delivery.outcome@1" => <DeliveryOutcome as Contract>::from_json(&value, "")?.to_json(),
        "doc.patched@1" => <DocPatched as Contract>::from_json(&value, "")?.to_json(),
        "error@1" => <Error as Contract>::from_json(&value, "")?.to_json(),
        "evidence.put@1" => <EvidencePut as Contract>::from_json(&value, "")?.to_json(),
        "guard@1" => <Guard as Contract>::from_json(&value, "")?.to_json(),
        "hook.ack@1" => <HookAck as Contract>::from_json(&value, "")?.to_json(),
        "hook.joined@1" => <HookJoined as Contract>::from_json(&value, "")?.to_json(),
        "hook.reply@1" => <HookReply as Contract>::from_json(&value, "")?.to_json(),
        "hook.request@1" => <HookRequest as Contract>::from_json(&value, "")?.to_json(),
        "layer.rows@1" => <LayerRows as Contract>::from_json(&value, "")?.to_json(),
        "learn.applied@1" => <LearnApplied as Contract>::from_json(&value, "")?.to_json(),
        "learn.proposed@1" => <LearnProposed as Contract>::from_json(&value, "")?.to_json(),
        "learn.rolled_back@1" => <LearnRolledBack as Contract>::from_json(&value, "")?.to_json(),
        "learn.widened@1" => <LearnWidened as Contract>::from_json(&value, "")?.to_json(),
        "lease.acquired@1" => <LeaseAcquired as Contract>::from_json(&value, "")?.to_json(),
        "lease.denied@1" => <LeaseDenied as Contract>::from_json(&value, "")?.to_json(),
        "lease.released@1" => <LeaseReleased as Contract>::from_json(&value, "")?.to_json(),
        "lease.stale@1" => <LeaseStale as Contract>::from_json(&value, "")?.to_json(),
        "merge.dry_run@1" => <MergeDryRun as Contract>::from_json(&value, "")?.to_json(),
        "note.closed@1" => <NoteClosed as Contract>::from_json(&value, "")?.to_json(),
        "note.opened@1" => <NoteOpened as Contract>::from_json(&value, "")?.to_json(),
        "notice.sent@1" => <NoticeSent as Contract>::from_json(&value, "")?.to_json(),
        "notice.subscribed@1" => <NoticeSubscribed as Contract>::from_json(&value, "")?.to_json(),
        "open_item.closed@1" => <OpenItemClosed as Contract>::from_json(&value, "")?.to_json(),
        "open_item.opened@1" => <OpenItemOpened as Contract>::from_json(&value, "")?.to_json(),
        "plan.proposed@1" => <PlanProposed as Contract>::from_json(&value, "")?.to_json(),
        "pr.merged@1" => <PrMerged as Contract>::from_json(&value, "")?.to_json(),
        "reading.batch@1" => <ReadingBatch as Contract>::from_json(&value, "")?.to_json(),
        "reading.recorded@1" => <ReadingRecorded as Contract>::from_json(&value, "")?.to_json(),
        "reading.rollup@1" => <ReadingRollup as Contract>::from_json(&value, "")?.to_json(),
        "run.finished@1" => <RunFinished as Contract>::from_json(&value, "")?.to_json(),
        "run.started@1" => <RunStarted as Contract>::from_json(&value, "")?.to_json(),
        "session.attention@1" => <SessionAttention as Contract>::from_json(&value, "")?.to_json(),
        "session.child_started@1" => <SessionChildStarted as Contract>::from_json(&value, "")?.to_json(),
        "session.start@1" => <SessionStart as Contract>::from_json(&value, "")?.to_json(),
        "suggestion.filed@1" => <SuggestionFiled as Contract>::from_json(&value, "")?.to_json(),
        "suggestion.settled@1" => <SuggestionSettled as Contract>::from_json(&value, "")?.to_json(),
        "task.closed@1" => <TaskClosed as Contract>::from_json(&value, "")?.to_json(),
        "task.created@1" => <TaskCreated as Contract>::from_json(&value, "")?.to_json(),
        "tool.after@1" => <ToolAfter as Contract>::from_json(&value, "")?.to_json(),
        "tool.before@1" => <ToolBefore as Contract>::from_json(&value, "")?.to_json(),
        "transcript.archived@1" => <TranscriptArchived as Contract>::from_json(&value, "")?.to_json(),
        "user.ask@1" => <UserAsk as Contract>::from_json(&value, "")?.to_json(),
        "verdict.made@1" => <VerdictMade as Contract>::from_json(&value, "")?.to_json(),
        "verdict.stale@1" => <VerdictStale as Contract>::from_json(&value, "")?.to_json(),
        "verdict@1" => <Verdict as Contract>::from_json(&value, "")?.to_json(),
        "worktree.created@1" => <WorktreeCreated as Contract>::from_json(&value, "")?.to_json(),
        "worktree.removed@1" => <WorktreeRemoved as Contract>::from_json(&value, "")?.to_json(),
        _ => return Err(format!("no generated type for {schema}")),
    };
    Ok(deep_contracts::jcs(&typed))
}
