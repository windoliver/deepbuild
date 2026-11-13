//! The closed function list's own tests: what it parses and evaluates, and where its caps refuse.

use super::*;

fn num(text: &str, vars: &[f64]) -> f64 {
    Expr::compile(text, &Nothing, 512).unwrap().eval_num(vars)
}

#[test]
fn arithmetic_and_precedence() {
    assert_eq!(num("1 + 2 * 3", &[]), 7.0);
    assert_eq!(num("-2^2", &[]), -4.0);
    assert_eq!(num("2^3^2", &[]), 512.0);
    assert_eq!(num("x > 1 ? 10 : 20", &[2.0]), 10.0);
    assert_eq!(num("2x + 1", &[3.0]), 7.0);
    assert_eq!(num("(−1)^3 · 4 ÷ 2", &[]), -2.0);
}

struct Max19;
impl Resolve for Max19 {
    fn var_max(&self, name: &str) -> Option<f64> {
        (name == "n").then_some(19.0)
    }
}

#[test]
fn a_bounded_sum_is_sin_by_its_series() {
    let e = Expr::compile(
        "sum(k, 0, n, (−1)^k · x^(2k+1) ÷ factorial(2k+1))",
        &Max19,
        512,
    )
    .unwrap();
    assert_eq!(e.vars, ["n", "x"]);
    for i in 0..1000 {
        let x = -6.0 + 12.0 * f64::from(i) / 999.0;
        let v = e.eval_num(&[19.0, x]);
        assert!((v - ops::sin(x)).abs() < 1e-12, "{x}: {v}");
    }
}

#[test]
fn refusals_name_the_call() {
    let e = Expr::compile("factorial(171)", &Nothing, 64).unwrap_err();
    assert_eq!(e.call, "factorial(171)");
    let e = Expr::compile("1 + factorial(2.5)", &Nothing, 64).unwrap_err();
    assert_eq!(e.call, "factorial(2.5)");
    let e = Expr::compile("sum(k, 0, 256, k)", &Nothing, 4096).unwrap_err();
    assert_eq!(e.call, "sum(k, 0, 256, k)");
    assert!(Expr::compile("sum(k, 0, 255, k)", &Nothing, 4096).is_ok());
    let e = Expr::compile("sum(k, 0, m, k)", &Nothing, 4096).unwrap_err();
    assert!(e.why.contains("declared max"), "{e}");
}

#[test]
fn cpow_squares_within_two_ulp() {
    let e = Expr::compile("cpow(vec2(x, y), 2)", &Nothing, 64).unwrap();
    let f = Expr::compile("vec2(x^2 - y^2, 2 x y)", &Nothing, 64).unwrap();
    for (x, y) in [(1.5, -2.25), (0.1, 0.3), (-7.0, 3.5)] {
        let (a, b) = (e.eval(&[V::S(x), V::S(y)]), f.eval(&[V::S(x), V::S(y)]));
        assert_eq!(a, b);
    }
}

#[test]
fn interval_forms_hold_through_an_expression() {
    let e = Expr::compile("sin(x) * x + sinc(x)", &Nothing, 64).unwrap();
    let b = e.bound_num(&[Iv::new(-3.0, 4.0)]);
    for i in 0..=1000 {
        let x = -3.0 + 7.0 * f64::from(i) / 1000.0;
        assert!(b.contains(e.eval_num(&[x])));
    }
}

#[test]
fn noise_forms_hold() {
    let mut s = 99u64;
    let mut next = || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        (s >> 11) as f64 / (1u64 << 53) as f64
    };
    for _ in 0..500 {
        let (a, b) = (next() * 20.0 - 10.0, next() * 20.0 - 10.0);
        let r = Iv::new(a.min(b), a.max(b));
        let nb = noise::noise_bound(&[r], Some(3));
        let fb = noise::fbm_bound(&[r], Some(3), 6, 2.0, 0.5);
        for _ in 0..40 {
            let p = r.lo + (r.hi - r.lo) * next();
            assert!(nb.contains(noise::noise(&[p], 3)));
            assert!(fb.contains(noise::fbm(&[p], 3, 6, 2.0, 0.5)));
        }
    }
}

struct MaxN;
impl Resolve for MaxN {
    fn var_max(&self, _: &str) -> Option<f64> {
        Some(3.0)
    }
}

/// Every finite point value at `xs` lies inside the form over `[lo, hi]` (x the one var, or
/// the first; `n` held over `[n_lo, n_hi]`).
fn holds(text: &str, lo: f64, hi: f64, xs: &[f64]) {
    let e = Expr::compile(text, &MaxN, 512).unwrap();
    let b = e.bound_num(&e.vars.iter().map(|_| Iv::new(lo, hi)).collect::<Vec<_>>());
    for &x in xs {
        let v = e.eval_num(&e.vars.iter().map(|_| x).collect::<Vec<_>>());
        if v.is_finite() {
            assert!(b.contains(v), "{text} at {x} reads {v}, outside {b:?}");
        }
    }
}

#[test]
fn an_undefined_argument_decides_nothing() {
    holds("min(sqrt(x), 2)", -1.0, 1.0, &[-0.5, 0.25, 1.0]);
    holds("(log(x) < 1) ? 0.5 : 100", -1.0, 0.5, &[-0.5, 0.25]);
    holds("sign(log(x))", -1.0, 0.5, &[-0.5, 0.25]);
}

#[test]
fn a_negative_base_takes_its_whole_powers() {
    let e = Expr::compile("x ^ n", &MaxN, 64).unwrap();
    let b = e.bound_num(&[Iv::new(-2.0, -1.0), Iv::new(1.0, 3.0)]);
    assert!(b.contains(4.0) && b.contains(-8.0), "{b:?}");
    holds("x ^ 2000", -1.0001, -1.0, &[-1.0001, -1.00005]);
}

#[test]
fn whole_powers_hold_libm_and_powi_alike() {
    holds(
        "pow(x, 100)",
        1.006_670_209_655_188_7,
        1.006_670_209_655_188_7,
        &[1.006_670_209_655_188_7],
    );
    holds(
        "x ^ 100",
        1.006_670_209_655_188_7,
        1.006_670_209_655_188_7,
        &[1.006_670_209_655_188_7],
    );
}

#[test]
fn a_remainder_near_a_multiple_holds() {
    holds(
        "x % 0.1",
        0.5,
        0.50001,
        &[0.5, 0.500_000_000_000_000_1, 0.500_005],
    );
    holds(
        "mod(x, 0.1)",
        0.5,
        0.50001,
        &[0.5, 0.500_000_000_000_000_1, 0.500_005],
    );
}

#[test]
fn an_ease_past_its_ends_reads_its_end() {
    holds("ease(in_quad, x)", 1.5, 2.0, &[1.5, 2.0]);
    holds("ease(in_elastic, x)", 0.0, 0.01, &[1e-9, 0.005]);
    holds("ease(out_elastic, x)", 0.99, 1.0, &[1.0 - 1e-9]);
}

#[test]
fn atan2_takes_zero_unsigned_in_both_forms() {
    holds("atan2(-x, -1)", -1.0, 0.0, &[-1.0, -0.5, 0.0]);
    holds("atan2(0, x * 0)", -1.0, -0.5, &[-1.0, -0.75, -0.5]);
    holds("carg(conj(vec2(x, 0)))", -2.0, -1.0, &[-2.0, -1.5, -1.0]);
}

/// `text` compiled at `cap` and evaluated with no vars. The canvas lint keeps threads and
/// clocks out of these crates, so a 1 MB stack and the time a refusal takes are the
/// acceptance suite's (tests/acceptance/1468, in deep-motion).
fn value(text: String, cap: usize) -> Result<f64, String> {
    Expr::compile(&text, &Nothing, cap)
        .map(|e| e.eval_num(&[]))
        .map_err(|r| r.why)
}

#[test]
fn every_level_counts_against_the_nesting_cap() {
    let cap = "the cap of 64 levels";
    // Unary plus and not, both branches of the conditional, a power's exponent and a call's
    // arguments each nest, and a minus inside a paren or an exponent adds its own level:
    // (open, close, levels each).
    let forms = [
        ("+", "", 1),
        ("1 ? ", " : 1", 1),
        ("2^-", "", 2),
        ("(-", ")", 2),
        ("!", "", 1),
        ("1 ? 1 : ", "", 1),
        ("abs(", ")", 1),
    ];
    for (open, close, levels) in forms {
        let at = |n: usize| format!("{}1{}", open.repeat(n), close.repeat(n));
        let n = 64 / levels;
        assert!(value(at(n), 512).is_ok(), "{open}: {n}");
        let e = value(at(n + 1), 512).unwrap_err();
        assert!(e.contains(cap), "{open}: {e}");
    }
}

#[test]
fn a_long_chain_is_refused_before_it_binds() {
    // Left-associative chains nest no parse but make a tree as deep as they are long.
    let chain = |n: usize| format!("{}1", "1+".repeat(n));
    assert_eq!(value(chain(127), 256), Ok(128.0));
    let e = value(chain(100_000), 256).unwrap_err();
    assert!(e.contains("twice the cap of 256"), "{e}");
}

#[test]
fn a_refusal_reads_no_further_than_it_needs() {
    // An unreadable char past the refusal is never reached, and one before it is refused.
    let deep = format!("{}1$", "(".repeat(65));
    let e = Expr::compile(&deep, &Nothing, 512).unwrap_err();
    assert!(e.why.contains("levels"), "{e}");
    let e = Expr::compile("1 + $", &Nothing, 512).unwrap_err();
    assert_eq!(
        (e.call.as_str(), e.why.as_str()),
        ("1 + $", "unexpected `$`")
    );
    let e = Expr::compile("1 2", &Nothing, 512).unwrap_err();
    assert_eq!(
        (e.call.as_str(), e.why.as_str()),
        ("1 2", "trailing text after the expression")
    );
    // At every nesting site the cap refuses before the char past it is read.
    for open in ["-", "!", "+", "abs(", "1 ? ", "1 ? 1 : ", "2^", "("] {
        let e = Expr::compile(&format!("{}$", open.repeat(65)), &Nothing, 512).unwrap_err();
        assert_eq!(e.why, "nests past the cap of 64 levels", "{open}");
    }
    // A bad number moves the lexer on, and the char after it never replaces its refusal.
    let e = Expr::compile("f(1..2 $)", &Nothing, 512).unwrap_err();
    assert!(e.why.contains("is not a number"), "{e}");
}

#[test]
fn a_dotted_name_counts_against_the_nodes_and_the_cap_wins_over_what_follows() {
    // A table's dotted name reads no further than the node bound lets it.
    let long = format!("table({}a + 1)", "a.".repeat(1_000_000));
    let e = Expr::compile(&long, &Nothing, 512).unwrap_err();
    assert!(e.why.contains("twice the cap of 512"), "{e}");
    // A name that ends the call is read as one, so only its parts' count refuses it.
    let name = format!("table({}a)", "a.".repeat(1_000_000));
    let e = Expr::compile(&name, &Nothing, 512).unwrap_err();
    assert!(e.why.contains("twice the cap of 512"), "{e}");
    // A refusal for the cap stands, whatever char comes after where it stopped.
    let deep = format!("{}$", "(".repeat(65));
    let e = Expr::compile(&deep, &Nothing, 512).unwrap_err();
    assert!(e.why.contains("the cap of 64 levels"), "{e}");
}

#[test]
fn the_node_bound_sits_at_twice_the_cap_and_a_name_counts_as_read() {
    // At cap 512 the parse takes 1,024 nodes as written and refuses the 1,025th.
    let over = |t: String| {
        Expr::compile(&t, &Nothing, 512)
            .err()
            .is_some_and(|e| e.why.contains("twice the cap of 512"))
    };
    // A sum of k + 1 ones is 2k + 1 nodes; abs around it adds one.
    let sum = |k: usize| format!("{}1", "1+".repeat(k));
    assert!(!over(sum(511)) && over(sum(512)));
    let e = Expr::compile(&sum(512), &Nothing, 512).unwrap_err();
    assert_eq!(
        e.why,
        "takes more than 1024 nodes as written, twice the cap of 512"
    );
    assert!(!over(format!("abs({})", sum(511))));
    // A table's name read whole counts one node; read as `p.t + …`, its parts count once.
    assert!(!over(format!("table(p.t, {})", sum(510))));
    assert!(over(format!("table(p.t, {})", sum(511))));
    assert!(!over(format!("table(p.t + {})", sum(509))));
    assert!(over(format!("table(p.t + {})", sum(510))));
    // A name read whole never ends on a dot.
    let e = Expr::compile("table(p.t., 1)", &Nothing, 512).unwrap_err();
    assert_eq!(e.why, "a `.` names no component");
    // Every other node counts too: the first term past the bound tips each of these chains.
    for (unit, k) in [
        ("1*", 512),
        ("+1+", 512),
        ("-1+", 342),
        ("!1+", 342),
        ("2^1+", 256),
        ("(1?1:1)+", 205),
    ] {
        let chain = |k: usize| format!("{}1", unit.repeat(k));
        assert!(!over(chain(k - 1)) && over(chain(k)), "{unit}");
    }
}

#[test]
fn the_lazy_lexer_reads_every_token_form_and_a_refusal_names_its_own_text() {
    let value = |t: &str| Expr::compile(t, &Nothing, 512).map(|e| e.eval_num(&[]));
    let forms = [
        ("1e5 + 1E+5 + 1e−2 * 100", 200_001.0),
        (".5 + 2 ÷ 4", 1.0),
        ("(1 == 1) + (1 != 2) + (1 <= 1) + (2 >= 1)", 4.0),
        ("(1 && 1) + (0 || 1) + (1 ≤ 2) + (2 ≥ 1) + (1 ≠ 2)", 5.0),
        ("2 × 3\t+\n1\u{a0}+ 1", 8.0),
    ];
    for (text, want) in forms {
        assert_eq!(value(text).ok(), Some(want), "{text}");
    }
    assert_eq!(value("1e-2 * 100 + 7 % 4").ok(), Some(4.0));
    assert_eq!(
        value("(1 ≤ 1) + (1 ≥ 1) + (1 < 2) + (1 && 0)").ok(),
        Some(3.0)
    );
    // An `e` with no digits after it is a name, never an exponent, and a name may start `_`.
    assert!(value("2e + 1").is_ok() && value("_x").is_ok());
    for (text, call) in [
        ("factorial(2.5) + 1", "factorial(2.5)"),
        ("é + factorial(2.5) + 1", "factorial(2.5)"),
        ("1 + 1..2", "1..2"),
    ] {
        assert_eq!(
            Expr::compile(text, &Nothing, 512).unwrap_err().call,
            call,
            "{text}"
        );
    }
}

struct OneTable;
impl Resolve for OneTable {
    fn table(&self, name: &str) -> Option<Table> {
        let t = Table::new(vec![0.0, 1.0], vec![0.0, 1.0], crate::table::Mode::Linear);
        (name == "p.t").then(|| t.unwrap())
    }
}

#[test]
fn a_dotted_table_name_counts_once() {
    // 7 towers of 63 tables take 454 nodes bound and 896 as written; were each part of a
    // name counted, they would pass twice the cap of 512.
    let tower = format!("{}x{}", "table(p.t, ".repeat(63), ")".repeat(63));
    let text = vec![tower; 7].join(" + ");
    let e = Expr::compile(&text, &OneTable, 512).unwrap();
    assert_eq!(e.size, 454);
}
