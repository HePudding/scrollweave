type Fn = (t: number) => number;
const functions: Record<
  string,
  { arity: number; run: (...v: number[]) => number }
> = {
  sin: { arity: 1, run: Math.sin },
  cos: { arity: 1, run: Math.cos },
  abs: { arity: 1, run: Math.abs },
  sqrt: { arity: 1, run: Math.sqrt },
  exp: { arity: 1, run: Math.exp },
  log: { arity: 1, run: Math.log },
  floor: { arity: 1, run: Math.floor },
  ceil: { arity: 1, run: Math.ceil },
  round: { arity: 1, run: Math.round },
  pow: { arity: 2, run: Math.pow },
  min: { arity: 2, run: Math.min },
  max: { arity: 2, run: Math.max },
  clamp: { arity: 3, run: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) },
};
const cache = new Map<string, Fn>();

/** A bounded arithmetic language; never executes JavaScript. t is segment progress. */
export function compileExpression(formula: string): Fn {
  const cached = cache.get(formula);
  if (cached) return cached;
  if (!formula.trim() || formula.length > 256)
    throw Error("公式需要 1–256 个字符");
  const tokens: string[] = [];
  let rest = formula;
  while (rest.trim()) {
    const match =
      /^\s*(\d*\.?\d+(?:e[+-]?\d+)?|[a-zA-Z]+|\*\*|[+\-*/%^(),])/.exec(rest);
    if (!match) throw Error("只支持数字、t、数学函数和运算符");
    tokens.push(match[1]);
    rest = rest.slice(match[0].length);
    if (tokens.length > 128) throw Error("公式过长，请简化");
  }
  let cursor = 0;
  const requireToken = (token: string) => {
    if (tokens[cursor++] !== token) throw Error(`缺少 ${token}`);
  };
  const parse = (min = 0, depth = 0): Fn => {
    if (depth > 32) throw Error("括号嵌套过深");
    const token = tokens[cursor++];
    let left: Fn;
    if (token === "+" || token === "-") {
      const operand = parse(3, depth + 1);
      left = token === "-" ? (t) => -operand(t) : operand;
    } else if (token === "(") {
      left = parse(0, depth + 1);
      requireToken(")");
    } else if (token === "t") left = (t) => t;
    else if (token === "pi") left = () => Math.PI;
    else if (token === "e") left = () => Math.E;
    else if (token && /^\d*\.?\d/.test(token)) left = () => Number(token);
    else if (token && Object.hasOwn(functions, token)) {
      const fn = functions[token],
        args: Fn[] = [];
      requireToken("(");
      for (let i = 0; i < fn.arity; i++) {
        if (i) requireToken(",");
        args.push(parse(0, depth + 1));
      }
      requireToken(")");
      left = (t) => fn.run(...args.map((arg) => arg(t)));
    } else throw Error(`无法识别 ${token ?? "公式末尾"}`);
    while (cursor < tokens.length) {
      const op = tokens[cursor];
      const priority =
        op === "+" || op === "-"
          ? 1
          : ["*", "/", "%"].includes(op)
            ? 2
            : op === "^" || op === "**"
              ? 3
              : 0;
      if (!priority || priority < min) break;
      cursor++;
      const right = parse(priority + (priority === 3 ? 0 : 1), depth + 1),
        previous = left;
      left = (t) => {
        const a = previous(t),
          b = right(t);
        switch (op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return a / b;
          case "%":
            return a % b;
          default:
            return a ** b;
        }
      };
    }
    return left;
  };
  const result = parse();
  if (cursor !== tokens.length) throw Error("运算符或括号不完整");
  for (let i = 0; i <= 200; i++) {
    const value = result(i / 200);
    if (!Number.isFinite(value) || Math.abs(value) > 10)
      throw Error("曲线在 0–1 区间需为有限值，幅度不超过 10");
  }
  if (Math.abs(result(0)) > 1e-6 || Math.abs(result(1) - 1) > 1e-6)
    throw Error("曲线起点需为 0，终点需为 1：f(0)=0，f(1)=1");
  const safe: Fn = (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const value = result(t);
    return Number.isFinite(value) && Math.abs(value) <= 10 ? value : t;
  };
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(formula, safe);
  return safe;
}
export function expressionError(formula: string): string | null {
  try {
    compileExpression(formula);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
