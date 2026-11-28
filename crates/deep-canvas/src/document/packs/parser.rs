use super::{well_named_member, Expr, MAX_NEST};

pub(super) struct Parser {
    pub(super) tokens: Vec<String>,
    pub(super) at: usize,
    pub(super) depth: usize,
}

impl Parser {
    fn nest<T>(&mut self, f: impl FnOnce(&mut Self) -> Result<T, String>) -> Result<T, String> {
        if self.depth == MAX_NEST {
            return Err(format!("nests past the cap of {MAX_NEST} levels"));
        }
        self.depth += 1;
        let e = f(self);
        self.depth -= 1;
        e
    }

    fn peek(&self) -> Option<&str> {
        self.tokens.get(self.at).map(String::as_str)
    }

    fn take(&mut self) -> Option<String> {
        let t = self.tokens.get(self.at).cloned();
        self.at += 1;
        t
    }

    pub(super) fn cond(&mut self) -> Result<Expr, String> {
        let c = self.or()?;
        if self.peek() != Some("?") {
            return Ok(c);
        }
        self.at += 1;
        let a = self.nest(Self::cond)?;
        if self.take().as_deref() != Some(":") {
            return Err("missing `:`".into());
        }
        let b = self.nest(Self::cond)?;
        Ok(Expr::Cond(Box::new(c), Box::new(a), Box::new(b)))
    }

    fn or(&mut self) -> Result<Expr, String> {
        let mut left = self.and()?;
        while self.peek() == Some("||") {
            self.at += 1;
            left = Expr::Logic("||", Box::new(left), Box::new(self.and()?));
        }
        Ok(left)
    }

    fn and(&mut self) -> Result<Expr, String> {
        let mut left = self.compare()?;
        while self.peek() == Some("&&") {
            self.at += 1;
            left = Expr::Logic("&&", Box::new(left), Box::new(self.compare()?));
        }
        Ok(left)
    }

    fn compare(&mut self) -> Result<Expr, String> {
        let left = self.sum()?;
        let op = match self.peek() {
            Some("==") => "==",
            Some("!=") => "!=",
            Some("<") => "<",
            Some("<=") => "<=",
            Some(">") => ">",
            Some(">=") => ">=",
            _ => return Ok(left),
        };
        self.at += 1;
        Ok(Expr::Logic(op, Box::new(left), Box::new(self.sum()?)))
    }

    fn sum(&mut self) -> Result<Expr, String> {
        let mut left = self.product()?;
        while let Some(op @ ("+" | "-")) = self.peek() {
            let op = op.chars().next().unwrap_or('+');
            self.at += 1;
            let right = self.product()?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn product(&mut self) -> Result<Expr, String> {
        let mut left = self.unary()?;
        while let Some(op @ ("*" | "/" | "%")) = self.peek() {
            let op = op.chars().next().unwrap_or('*');
            self.at += 1;
            let right = self.unary()?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn unary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            Some("-") => {
                self.at += 1;
                Ok(Expr::Neg(Box::new(self.nest(Self::unary)?)))
            }
            Some("!") => {
                self.at += 1;
                Ok(Expr::Not(Box::new(self.nest(Self::unary)?)))
            }
            _ => self.postfix(),
        }
    }

    fn postfix(&mut self) -> Result<Expr, String> {
        let mut e = self.atom()?;
        loop {
            match self.peek() {
                Some("[") => {
                    self.at += 1;
                    let i = self.nest(Self::cond)?;
                    if self.take().as_deref() != Some("]") {
                        return Err("missing `]`".into());
                    }
                    e = Expr::Index(Box::new(e), Box::new(i));
                }
                Some(".") => {
                    self.at += 1;
                    match self.take() {
                        Some(name) if well_named_member(&name) => {
                            e = Expr::Member(Box::new(e), name)
                        }
                        _ => return Err("a member is a name".into()),
                    }
                }
                _ => return Ok(e),
            }
        }
    }

    fn atom(&mut self) -> Result<Expr, String> {
        let Some(t) = self.take() else {
            return Err("expression ends early".into());
        };
        if t == "(" {
            let e = self.nest(Self::cond)?;
            if self.take().as_deref() != Some(")") {
                return Err("missing `)`".into());
            }
            return Ok(e);
        }
        if let Ok(n) = t.parse::<f64>() {
            return Ok(Expr::Num(n));
        }
        if t.starts_with(|c: char| c.is_ascii_digit())
            && t.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        {
            return Ok(Expr::Name(t));
        }
        match t.as_str() {
            "pi" => return Ok(Expr::Num(std::f64::consts::PI)),
            "tau" => return Ok(Expr::Num(std::f64::consts::TAU)),
            _ => {}
        }
        if well_named_member(&t) {
            if self.peek() == Some("(") {
                self.at += 1;
                let args = self.nest(Self::args)?;
                return Ok(Expr::Call(t, args));
            }
            return Ok(Expr::Name(t));
        }
        Err(format!("unexpected `{t}`"))
    }

    fn args(&mut self) -> Result<Vec<Expr>, String> {
        let mut args = Vec::new();
        if self.peek() == Some(")") {
            self.at += 1;
            return Ok(args);
        }
        loop {
            args.push(self.cond()?);
            match self.take().as_deref() {
                Some(",") => continue,
                Some(")") => return Ok(args),
                _ => return Err("missing `)`".into()),
            }
        }
    }
}
