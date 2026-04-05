import { describe, it, expect } from "vitest";
import { tokenize, reconstruct, TokenType, refactor } from "../src/refactoring/index.js";

// ─── Tokenizer ───────────────────────────────────────────────────────────────

describe("tokenizer", () => {
  describe("roundtrip preservation", () => {
    const formulas = [
      "=A1+B2",
      "= ADD ( 1 , 2 )",
      '=CONCAT("hello ""world""", A1)',
      "=IF(A1>0, SUM(B1:B10), 0)",
      "=LET(x, 1, y, 2, x+y)",
      "=LAMBDA(a, b, a+b)(1, 2)",
      "={1,2,3;4,5,6}",
      '=""',
      "=1.5e10+2",
      "=A1:B2",
      "=Sheet1!A1",
      "=--1",
      "=+A1",
      "=A1>=B1",
      "=A1<>B1",
    ];

    for (const f of formulas) {
      it(`roundtrips: ${f}`, () => {
        expect(reconstruct(tokenize(f))).toBe(f);
      });
    }
  });

  describe("token types", () => {
    it("classifies identifiers", () => {
      const tokens = tokenize("SUM").filter((t) => t.type !== TokenType.Whitespace);
      expect(tokens[0].type).toBe(TokenType.Identifier);
    });

    it("classifies strings", () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0].type).toBe(TokenType.String);
    });

    it("classifies numbers", () => {
      const tokens = tokenize("123.45");
      expect(tokens[0].type).toBe(TokenType.Number);
    });

    it("classifies scientific notation", () => {
      const tokens = tokenize("1e10");
      expect(tokens[0].type).toBe(TokenType.Number);
    });

    it("classifies operators", () => {
      const tokens = tokenize("+");
      expect(tokens[0].type).toBe(TokenType.Operator);
    });

    it("classifies semicolons (GS array separator)", () => {
      const tokens = tokenize(";");
      expect(tokens[0].type).toBe(TokenType.Semicolon);
    });

    it("classifies curly braces (array literals)", () => {
      const tokens = tokenize("{1}");
      expect(tokens[0].type).toBe(TokenType.LBrace);
      expect(tokens[2].type).toBe(TokenType.RBrace);
    });

    it("handles dotted identifiers (e.g. CHARTER.RECORD)", () => {
      const tokens = tokenize("CHARTER.RECORD");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.Identifier);
      expect(tokens[0].value).toBe("CHARTER.RECORD");
    });
  });

  describe("edge cases", () => {
    it("empty string", () => {
      expect(tokenize("")).toEqual([]);
    });

    it("just an equals sign", () => {
      const tokens = tokenize("=");
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.Operator);
    });

    it("string containing parentheses", () => {
      const tokens = tokenize('="FUNC(x)"');
      const stringTokens = tokens.filter((t) => t.type === TokenType.String);
      expect(stringTokens).toHaveLength(1);
      expect(stringTokens[0].value).toBe('"FUNC(x)"');
    });

    it("consecutive operators", () => {
      const tokens = tokenize("=--A1");
      expect(reconstruct(tokens)).toBe("=--A1");
    });
  });
});

// ─── Refactorer ──────────────────────────────────────────────────────────────

describe("refactor", () => {
  describe("basic renaming", () => {
    it("renames a function call", () => {
      expect(
        refactor("=MY_FUNC(x)", new Map([["MY_FUNC", "MY_FUNC_1"]])),
      ).toBe("=MY_FUNC_1(x)");
    });

    it("renames multiple functions", () => {
      expect(
        refactor("=A(x) + B(y)", new Map([["A", "A1"], ["B", "B1"]])),
      ).toBe("=A1(x) + B1(y)");
    });

    it("renames identifier used as argument", () => {
      expect(
        refactor("=SUM(MY_VAR, 1)", new Map([["MY_VAR", "RENAMED"]])),
      ).toBe("=SUM(RENAMED, 1)");
    });

    it("does not rename identifiers not in the map", () => {
      expect(
        refactor("=FOO(x) + BAR(y)", new Map([["FOO", "FOO_1"]])),
      ).toBe("=FOO_1(x) + BAR(y)");
    });

    it("handles empty rename map as identity", () => {
      const formula = "=SUM(A1, B2) + LET(x, 1, x)";
      expect(refactor(formula, new Map())).toBe(formula);
    });

    it("preserves whitespace exactly", () => {
      expect(
        refactor("= MY_FUNC ( x , y )", new Map([["MY_FUNC", "R"]])),
      ).toBe("= R ( x , y )");
    });

    it("renames nested function calls", () => {
      expect(
        refactor("=OUTER(INNER(x))", new Map([["OUTER", "O"], ["INNER", "I"]])),
      ).toBe("=O(I(x))");
    });
  });

  describe("LET scoping", () => {
    it("shadows variable in body", () => {
      expect(
        refactor("=LET(X, 1, X + 1)", new Map([["X", "RENAMED"]])),
      ).toBe("=LET(X, 1, X + 1)");
    });

    it("does not shadow value of first binding", () => {
      // The value of the first LET binding is evaluated BEFORE the name enters scope
      expect(
        refactor("=LET(X, X + 1, X)", new Map([["X", "R"]])),
      ).toBe("=LET(X, R + 1, X)");
    });

    it("incremental scoping across multiple bindings", () => {
      // LET(X, val_x, Y, val_y, body)
      // val_x: X not yet in scope → rename
      // val_y: X in scope (from first binding) → don't rename
      // body: both X and Y in scope → don't rename either
      expect(
        refactor("=LET(X, X + 1, Y, X + 2, X + Y)", new Map([["X", "R"]])),
      ).toBe("=LET(X, R + 1, Y, X + 2, X + Y)");
    });

    it("nested LET shadows outer scope", () => {
      expect(
        refactor(
          "=LET(a, FUNC(1), LET(FUNC, 99, FUNC + a))",
          new Map([["FUNC", "F1"]]),
        ),
      ).toBe("=LET(a, F1(1), LET(FUNC, 99, FUNC + a))");
    });

    it("LET inside function argument", () => {
      expect(
        refactor(
          "=IF(TRUE, LET(X, 1, X), X)",
          new Map([["X", "R"]]),
        ),
      ).toBe("=IF(TRUE, LET(X, 1, X), R)");
    });

    it("LET with function call as value", () => {
      expect(
        refactor(
          "=LET(result, MY_FUNC(1), result + 1)",
          new Map([["MY_FUNC", "RENAMED"]]),
        ),
      ).toBe("=LET(result, RENAMED(1), result + 1)");
    });

    it("LET binding shadows function name in body", () => {
      // If you LET-bind a name that matches a function, the body sees the LET binding
      expect(
        refactor(
          "=LET(MY_FUNC, 5, MY_FUNC + MY_FUNC)",
          new Map([["MY_FUNC", "R"]]),
        ),
      ).toBe("=LET(MY_FUNC, 5, MY_FUNC + MY_FUNC)");
    });

    it("LET value before binding uses outer scope", () => {
      expect(
        refactor(
          "=LET(MY_FUNC, MY_FUNC(1), MY_FUNC)",
          new Map([["MY_FUNC", "R"]]),
        ),
      ).toBe("=LET(MY_FUNC, R(1), MY_FUNC)");
    });
  });

  describe("LAMBDA scoping", () => {
    it("shadows parameter in body", () => {
      expect(
        refactor(
          "=LAMBDA(X, X + 1)",
          new Map([["X", "R"]]),
        ),
      ).toBe("=LAMBDA(X, X + 1)");
    });

    it("renames non-shadowed references in body", () => {
      expect(
        refactor(
          "=LAMBDA(x, FUNC(x))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=LAMBDA(x, R(x))");
    });

    it("multiple parameters all shadow", () => {
      expect(
        refactor(
          "=LAMBDA(A, B, C, A + B + C)",
          new Map([["A", "X"], ["B", "Y"], ["C", "Z"]]),
        ),
      ).toBe("=LAMBDA(A, B, C, A + B + C)");
    });

    it("deeply nested LAMBDA", () => {
      expect(
        refactor(
          "=LAMBDA(x, LAMBDA(y, FUNC(x, y)))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=LAMBDA(x, LAMBDA(y, R(x, y)))");
    });

    it("inner LAMBDA shadows outer reference", () => {
      expect(
        refactor(
          "=LAMBDA(x, LAMBDA(x, x + 1))",
          new Map([["x", "R"]]),
        ),
      ).toBe("=LAMBDA(x, LAMBDA(x, x + 1))");
    });

    it("LAMBDA used with MAP", () => {
      expect(
        refactor(
          "=MAP(A1:A10, LAMBDA(cell, FUNC(cell)))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=MAP(A1:A10, LAMBDA(cell, R(cell)))");
    });

    it("IIFE (immediately invoked lambda)", () => {
      expect(
        refactor(
          "=LAMBDA(x, FUNC(x))(FUNC(1))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=LAMBDA(x, R(x))(R(1))");
    });

    it("renames outside LAMBDA but not shadowed inside", () => {
      expect(
        refactor(
          "=MY_FUNC(1) + LAMBDA(x, MY_FUNC(x))(2)",
          new Map([["MY_FUNC", "R"]]),
        ),
      ).toBe("=R(1) + LAMBDA(x, R(x))(2)");
    });
  });

  describe("LET + LAMBDA combined", () => {
    it("LET binding used inside LAMBDA body", () => {
      expect(
        refactor(
          "=LET(f, FUNC(1), MAP(A1:A10, LAMBDA(x, f + x)))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=LET(f, R(1), MAP(A1:A10, LAMBDA(x, f + x)))");
    });

    it("LAMBDA parameter shadows LET binding", () => {
      expect(
        refactor(
          "=LET(X, 1, LAMBDA(X, X + 1)(2))",
          new Map([["X", "R"]]),
        ),
      ).toBe("=LET(X, 1, LAMBDA(X, X + 1)(2))");
    });

    it("LET inside LAMBDA body", () => {
      expect(
        refactor(
          "=LAMBDA(x, LET(FUNC, x, FUNC + 1))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=LAMBDA(x, LET(FUNC, x, FUNC + 1))");
    });

    it("complex nesting: LET > LAMBDA > LET", () => {
      expect(
        refactor(
          "=LET(a, FUNC(1), LAMBDA(b, LET(c, FUNC(b), c + a))(2))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=LET(a, R(1), LAMBDA(b, LET(c, R(b), c + a))(2))");
    });

    it("REDUCE with accumulator", () => {
      expect(
        refactor(
          "=REDUCE(0, A1:A10, LAMBDA(acc, val, acc + FUNC(val)))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=REDUCE(0, A1:A10, LAMBDA(acc, val, acc + R(val)))");
    });
  });

  describe("LET and LAMBDA are not renamed", () => {
    it("LET itself is never renamed", () => {
      expect(
        refactor("=LET(x, 1, x)", new Map([["LET", "BROKEN"]])),
      ).toBe("=LET(x, 1, x)");
    });

    it("LAMBDA itself is never renamed", () => {
      expect(
        refactor("=LAMBDA(x, x)", new Map([["LAMBDA", "BROKEN"]])),
      ).toBe("=LAMBDA(x, x)");
    });

    it("case-insensitive LET/LAMBDA detection", () => {
      expect(
        refactor("=let(X, X + 1, X)", new Map([["X", "R"]])),
      ).toBe("=let(X, R + 1, X)");
    });

    it("case-insensitive LAMBDA detection", () => {
      expect(
        refactor("=lambda(X, X + 1)", new Map([["X", "R"]])),
      ).toBe("=lambda(X, X + 1)");
    });
  });

  describe("realistic formulas", () => {
    it("charter-style OBJ constructor", () => {
      const formula =
        '=LAMBDA(_type, _handler, LAMBDA(_msg, _arg, LET(_result, _handler(_msg, _arg), IF(ISERROR(_result), ERR(_type, _result), _result))))';
      expect(
        refactor(formula, new Map([["ERR", "CHARTER.ERR"]])),
      ).toBe(
        '=LAMBDA(_type, _handler, LAMBDA(_msg, _arg, LET(_result, _handler(_msg, _arg), IF(ISERROR(_result), CHARTER.ERR(_type, _result), _result))))',
      );
    });

    it("RECORD field access pattern", () => {
      expect(
        refactor(
          '=LET(_r, RECORD("point", WITH("x", 1, "y", 2)), SHOW(_r("x")))',
          new Map([["RECORD", "R"], ["WITH", "W"], ["SHOW", "S"]]),
        ),
      ).toBe(
        '=LET(_r, R("point", W("x", 1, "y", 2)), S(_r("x")))',
      );
    });

    it("MAP + LAMBDA + named function", () => {
      expect(
        refactor(
          "=MAP(SEQUENCE(10), LAMBDA(n, IS_PRIME(n)))",
          new Map([["IS_PRIME", "PRIME.CHECK"]]),
        ),
      ).toBe("=MAP(SEQUENCE(10), LAMBDA(n, PRIME.CHECK(n)))");
    });

    it("formula with string literals containing function names", () => {
      // Function names inside strings should NOT be renamed
      expect(
        refactor(
          '=LET(label, "MY_FUNC result: ", label & MY_FUNC(1))',
          new Map([["MY_FUNC", "R"]]),
        ),
      ).toBe('=LET(label, "MY_FUNC result: ", label & R(1))');
    });

    it("formula with semicolons (GS locale separator)", () => {
      expect(
        refactor(
          "=IF(TRUE; FUNC(1); FUNC(2))",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("=IF(TRUE; R(1); R(2))");
    });

    it("array literal with functions", () => {
      expect(
        refactor(
          "={FUNC(1), FUNC(2); FUNC(3), FUNC(4)}",
          new Map([["FUNC", "R"]]),
        ),
      ).toBe("={R(1), R(2); R(3), R(4)}");
    });

    it("multiple renames in complex formula", () => {
      const formula =
        "=LET(data, FETCH_DATA(url), processed, TRANSFORM(data), RENDER(processed))";
      expect(
        refactor(
          formula,
          new Map([
            ["FETCH_DATA", "NET.FETCH"],
            ["TRANSFORM", "DATA.XFORM"],
            ["RENDER", "UI.RENDER"],
          ]),
        ),
      ).toBe(
        "=LET(data, NET.FETCH(url), processed, DATA.XFORM(data), UI.RENDER(processed))",
      );
    });
  });
});
