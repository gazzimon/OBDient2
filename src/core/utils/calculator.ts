// Arithmetic for the assistant's `calculate` tool: language models get sums
// wrong (it estimated fuel 3× low on 2026-10-18), so the phone does the maths.
//
// A small recursive-descent parser, never eval(): numbers (dot decimals),
// + - * / % ^, parentheses, and a few functions. Anything else is an error the
// model can read and fix.

const MAX_LENGTH = 200;

const FUNCTIONS: Readonly<Record<string, (...a: number[]) => number>> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, digits = 0) => Math.round(x * 10 ** digits) / 10 ** digits,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  log10: Math.log10,
  ln: Math.log,
};
const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI };

export class CalcError extends Error {
  name = 'CalcError';
}

export function calculate(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new CalcError(`La expresión supera ${MAX_LENGTH} caracteres.`);
  const tokens = tokenize(expression);
  let i = 0;
  const peek = () => tokens[i];
  const take = (expected?: string) => {
    const t = tokens[i++];
    if (expected !== undefined && t !== expected) throw new CalcError(`Se esperaba "${expected}".`);
    return t;
  };

  // expr := term (('+'|'-') term)*
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term();
    return v;
  };
  // term := power (('*'|'/'|'%') power)*
  const term = (): number => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = take();
      const r = power();
      if ((op === '/' || op === '%') && r === 0) throw new CalcError('División por cero.');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  // power := unary ('^' power)?   (right-associative)
  const power = (): number => {
    const base = unary();
    return peek() === '^' ? (take(), base ** power()) : base;
  };
  // unary := '-' unary | '+' unary | primary
  const unary = (): number => {
    if (peek() === '-') return take(), -unary();
    if (peek() === '+') return take(), unary();
    return primary();
  };
  // primary := number | '(' expr ')' | name | name '(' expr (',' expr)* ')'
  const primary = (): number => {
    const t = take();
    if (t === undefined) throw new CalcError('La expresión está incompleta.');
    if (t === '(') {
      const v = expr();
      take(')');
      return v;
    }
    if (/^\d/.test(t)) return Number(t);
    if (/^[a-z]/.test(t)) {
      // Own names only: never constructor, toString… from the prototype.
      if (Object.hasOwn(CONSTANTS, t)) return CONSTANTS[t]!;
      const fn = Object.hasOwn(FUNCTIONS, t) ? FUNCTIONS[t] : undefined;
      if (!fn) throw new CalcError(`Función desconocida: ${t}.`);
      take('(');
      const args = [expr()];
      while (peek() === ',') {
        take();
        args.push(expr());
      }
      take(')');
      return fn(...args);
    }
    throw new CalcError(`Símbolo inesperado: "${t}".`);
  };

  const value = expr();
  if (i < tokens.length) throw new CalcError(`Sobra "${tokens[i]}".`);
  if (!Number.isFinite(value)) throw new CalcError('El resultado no es un número finito.');
  return Number(value.toPrecision(10));
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([a-z][a-z0-9]*)|([-+*/%^(),]))/giy;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    m = re.exec(s);
    if (!m) {
      if (/^\s*$/.test(s.slice(pos))) break;
      throw new CalcError(`Carácter no válido: "${s.slice(pos).trim()[0]}". Usá punto para los decimales.`);
    }
    out.push((m[1] ?? m[2]?.toLowerCase() ?? m[3])!);
    pos = re.lastIndex;
  }
  return out;
}
