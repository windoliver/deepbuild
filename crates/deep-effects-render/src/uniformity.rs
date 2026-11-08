//! WGSL's uniformity rule for implicit derivatives (#431; WGSL: Uniformity Analysis), applied by
//! the core's validate step to naga's module. naga 30 builds with its fragment-stage derivative
//! requirements switched off (`DISABLE_UNIFORMITY_REQ_FOR_FRAGMENT_STAGE`), so a module whose
//! `dpdx`, `dpdy`, `fwidth` or implicit-level sample may run where pixels of a quad have parted
//! would otherwise reach a pipeline; the WebGPU CTS's uniformity tests require its creation to
//! fail. The operator check refuses such a graph first, naming its step; this is the stage after
//! it, which names none.
//!
//! A value is non-uniform when it reads a fragment input, a texture, a call's result or a local
//! that a non-uniform value or a non-uniform branch stores; control flow parts at a branch on a
//! non-uniform value, and a loop's body does once a break or return in it may be taken apart.

use std::collections::BTreeSet;

use naga::{AddressSpace, Block, Expression, Function, Handle, Module, SampleLevel, Statement};

/// The first derivative a function of `module` may take in non-uniform control flow, as an error.
pub fn check(module: &Module) -> Result<(), String> {
    // Which functions take a derivative, themselves or through a call, to a fixed point.
    let mut holds = vec![false; module.functions.len()];
    loop {
        let mut changed = false;
        for (h, f) in module.functions.iter() {
            if !holds[h.index()] && takes(f, &holds) {
                holds[h.index()] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let functions = module
        .functions
        .iter()
        .map(|(_, f)| f)
        .chain(module.entry_points.iter().map(|e| &e.function));
    for f in functions {
        let mut a = Analysis {
            module,
            f,
            holds: &holds,
            locals: BTreeSet::new(),
        };
        a.settle();
        a.walk(&f.body, false)?;
    }
    Ok(())
}

/// Whether an expression needs uniform control flow: a derivative or an implicit-level sample.
fn requires(e: &Expression) -> bool {
    matches!(
        e,
        Expression::Derivative { .. }
            | Expression::ImageSample {
                level: SampleLevel::Auto | SampleLevel::Bias(_),
                ..
            }
    )
}

/// Whether a function's own expressions or calls take a derivative.
fn takes(f: &Function, holds: &[bool]) -> bool {
    fn calls(b: &Block, holds: &[bool]) -> bool {
        b.iter().any(|s| match s {
            Statement::Call { function, .. } => holds[function.index()],
            Statement::Block(b) => calls(b, holds),
            Statement::If { accept, reject, .. } => calls(accept, holds) || calls(reject, holds),
            Statement::Switch { cases, .. } => cases.iter().any(|c| calls(&c.body, holds)),
            Statement::Loop {
                body, continuing, ..
            } => calls(body, holds) || calls(continuing, holds),
            _ => false,
        })
    }
    f.expressions.iter().any(|(_, e)| requires(e)) || calls(&f.body, holds)
}

struct Analysis<'a> {
    module: &'a Module,
    f: &'a Function,
    holds: &'a [bool],
    /// The locals a non-uniform value or a non-uniform branch stores.
    locals: BTreeSet<Handle<naga::LocalVariable>>,
}

impl Analysis<'_> {
    fn non_uniform(&self, h: Handle<Expression>) -> bool {
        let nu = |x: Handle<Expression>| self.non_uniform(x);
        match &self.f.expressions[h] {
            Expression::Literal(_)
            | Expression::Constant(_)
            | Expression::Override(_)
            | Expression::ZeroValue(_)
            | Expression::ImageQuery { .. } => false,
            Expression::GlobalVariable(g) => !matches!(
                self.module.global_variables[*g].space,
                AddressSpace::Uniform | AddressSpace::Handle
            ),
            Expression::LocalVariable(l) => self.locals.contains(l),
            Expression::Load { pointer } => nu(*pointer),
            Expression::Compose { components, .. } => components.iter().any(|c| nu(*c)),
            Expression::Access { base, index } => nu(*base) || nu(*index),
            Expression::AccessIndex { base, .. } => nu(*base),
            Expression::Splat { value, .. } => nu(*value),
            Expression::Swizzle { vector, .. } => nu(*vector),
            Expression::Unary { expr, .. } | Expression::As { expr, .. } => nu(*expr),
            Expression::Binary { left, right, .. } => nu(*left) || nu(*right),
            Expression::Select {
                condition,
                accept,
                reject,
            } => nu(*condition) || nu(*accept) || nu(*reject),
            Expression::Relational { argument, .. } => nu(*argument),
            Expression::Math {
                arg,
                arg1,
                arg2,
                arg3,
                ..
            } => nu(*arg) || [arg1, arg2, arg3].into_iter().flatten().any(|x| nu(*x)),
            Expression::ArrayLength(e) => nu(*e),
            // Fragment inputs, textures, calls and the rest.
            _ => true,
        }
    }

    fn local_of(&self, pointer: Handle<Expression>) -> Option<Handle<naga::LocalVariable>> {
        match &self.f.expressions[pointer] {
            Expression::LocalVariable(l) => Some(*l),
            Expression::Access { base, .. } | Expression::AccessIndex { base, .. } => {
                self.local_of(*base)
            }
            _ => None,
        }
    }

    /// Whether a break or return in `b` may be taken apart, `under` a non-uniform branch.
    fn exits(&self, b: &Block, under: bool) -> bool {
        b.iter().any(|s| match s {
            Statement::Break | Statement::Return { .. } => under,
            Statement::Block(b) => self.exits(b, under),
            Statement::If {
                condition,
                accept,
                reject,
            } => {
                let d = under || self.non_uniform(*condition);
                self.exits(accept, d) || self.exits(reject, d)
            }
            Statement::Switch { selector, cases } => {
                let d = under || self.non_uniform(*selector);
                cases.iter().any(|c| self.exits(&c.body, d))
            }
            _ => false,
        })
    }

    fn loop_parts(
        &self,
        body: &Block,
        continuing: &Block,
        break_if: Option<Handle<Expression>>,
        divergent: bool,
    ) -> bool {
        divergent
            || self.exits(body, false)
            || self.exits(continuing, false)
            || break_if.is_some_and(|b| self.non_uniform(b))
    }

    /// Marks the locals stored non-uniformly, to a fixed point.
    fn settle(&mut self) {
        loop {
            let before = self.locals.len();
            let mut found = BTreeSet::new();
            self.mark(&self.f.body, false, &mut found);
            self.locals.extend(found);
            if self.locals.len() == before {
                break;
            }
        }
    }

    fn mark(&self, b: &Block, divergent: bool, found: &mut BTreeSet<Handle<naga::LocalVariable>>) {
        for s in b.iter() {
            match s {
                Statement::Block(b) => self.mark(b, divergent, found),
                Statement::If {
                    condition,
                    accept,
                    reject,
                } => {
                    let d = divergent || self.non_uniform(*condition);
                    self.mark(accept, d, found);
                    self.mark(reject, d, found);
                }
                Statement::Switch { selector, cases } => {
                    let d = divergent || self.non_uniform(*selector);
                    for c in cases {
                        self.mark(&c.body, d, found);
                    }
                }
                Statement::Loop {
                    body,
                    continuing,
                    break_if,
                } => {
                    let d = self.loop_parts(body, continuing, *break_if, divergent);
                    self.mark(body, d, found);
                    self.mark(continuing, d, found);
                }
                Statement::Store { pointer, value } => {
                    if let Some(l) = self.local_of(*pointer) {
                        if divergent || self.non_uniform(*value) {
                            found.insert(l);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn walk(&self, b: &Block, divergent: bool) -> Result<(), String> {
        for s in b.iter() {
            match s {
                Statement::Emit(range) if divergent => {
                    if range.clone().any(|e| requires(&self.f.expressions[e])) {
                        return Err(self.refusal());
                    }
                }
                Statement::Call { function, .. } if divergent && self.holds[function.index()] => {
                    return Err(self.refusal());
                }
                Statement::Block(b) => self.walk(b, divergent)?,
                Statement::If {
                    condition,
                    accept,
                    reject,
                } => {
                    let d = divergent || self.non_uniform(*condition);
                    self.walk(accept, d)?;
                    self.walk(reject, d)?;
                }
                Statement::Switch { selector, cases } => {
                    let d = divergent || self.non_uniform(*selector);
                    for c in cases {
                        self.walk(&c.body, d)?;
                    }
                }
                Statement::Loop {
                    body,
                    continuing,
                    break_if,
                } => {
                    let d = self.loop_parts(body, continuing, *break_if, divergent);
                    self.walk(body, d)?;
                    self.walk(continuing, d)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn refusal(&self) -> String {
        format!(
            "{}: a derivative or an implicit-level sample in non-uniform control flow (WGSL's uniformity rule), after a branch or a loop exit that pixels of a quad may take apart",
            self.f.name.as_deref().unwrap_or("a function")
        )
    }
}
