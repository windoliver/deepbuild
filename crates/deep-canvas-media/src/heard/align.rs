//! A token alignment with a fixed tie order (#509): the least edits that turn the expected tokens
//! into the heard ones, preferring a match or a substitution, then a missing token, then an extra.

/// One step of an alignment: `Same(i, j)` and `Sub(i, j)` pair expected token i with heard token j;
/// `Del(i)` is expected token i missing; `Ins(j)` is heard token j extra.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Same(usize, usize),
    Sub(usize, usize),
    Del(usize),
    Ins(usize),
}

/// Aligns `a` (expected) with `b` (heard), `eq` saying when two tokens match.
pub fn align<A, B>(a: &[A], b: &[B], eq: impl Fn(&A, &B) -> bool) -> Vec<Op> {
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let diag = d[i - 1][j - 1] + usize::from(!eq(&a[i - 1], &b[j - 1]));
            d[i][j] = diag.min(d[i - 1][j] + 1).min(d[i][j - 1] + 1);
        }
    }
    let (mut i, mut j) = (n, m);
    let mut out = Vec::new();
    while i > 0 || j > 0 {
        if i > 0 && j > 0 {
            let same = eq(&a[i - 1], &b[j - 1]);
            if d[i][j] == d[i - 1][j - 1] + usize::from(!same) {
                out.push(if same {
                    Op::Same(i - 1, j - 1)
                } else {
                    Op::Sub(i - 1, j - 1)
                });
                i -= 1;
                j -= 1;
                continue;
            }
        }
        if i > 0 && d[i][j] == d[i - 1][j] + 1 {
            out.push(Op::Del(i - 1));
            i -= 1;
        } else {
            out.push(Op::Ins(j - 1));
            j -= 1;
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_word_is_named_at_its_place() {
        let a = ["this", "is", "a", "test"];
        let b = ["this", "is", "a"];
        assert_eq!(
            align(&a, &b, |x, y| x == y),
            [Op::Same(0, 0), Op::Same(1, 1), Op::Same(2, 2), Op::Del(3)]
        );
        let b = ["this", "was", "a", "test", "too"];
        assert_eq!(
            align(&a, &b, |x, y| x == y),
            [
                Op::Same(0, 0),
                Op::Sub(1, 1),
                Op::Same(2, 2),
                Op::Same(3, 3),
                Op::Ins(4)
            ]
        );
    }
}
