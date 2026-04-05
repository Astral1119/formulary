import { describe, it, expect } from "vitest";
import { addPrefixes, stripPrefixes } from "../src/prefix.js";

// ─── All 22 charter formulas (without leading =) ───────────────────────────

const CHARTER_FORMULAS: Record<string, string> = {
  ERR: `LAMBDA(_ctx, _trace,
  LAMBDA(msg, [arg],
    IF(ISERROR(_ctx), "error",
    IF(msg = "show",
      "Error: " & _ctx & IF(AND(ISLOGICAL(_trace)), "",
        " | " & TEXTJOIN(" > ", TRUE, _trace)),
    IF(msg = "ctx", _ctx,
    IF(msg = "trace", _trace,
    IF(msg = "_push", ERR(_ctx, IF(AND(ISLOGICAL(_trace)), HSTACK(arg), HSTACK(_trace, arg))),
    ERR(_ctx, _trace))))))))`,

  PASS: `LAMBDA(msg, [arg],
  IF(ISERROR(msg), "__not_handled__", #VALUE!))`,

  HASH: `LAMBDA(val,
  IF(ISLOGICAL(val),
    IF(val, 67918732, 84696351),
  IF(ISNUMBER(val),
    IF(AND(val = INT(val), val >= 0, val < 2^32),
      IF(val = 0, 46947589,
      LET(
        _a, BITXOR(val, BITRSHIFT(val, 16)),
        _b, LET(lo, MOD(_a, 2^16), hi, INT(_a / 2^16),
          MOD(MOD(hi * 569420461, 2^16) * 2^16 + lo * 569420461, 2^32)),
        _c, BITXOR(_b, BITRSHIFT(_b, 15)),
        _d, LET(lo, MOD(_c, 2^16), hi, INT(_c / 2^16),
          MOD(MOD(hi * 3545902487, 2^16) * 2^16 + lo * 3545902487, 2^32)),
        BITXOR(_d, BITRSHIFT(_d, 15)))),
      HASH(TEXT(val, "0.###############"))),
  IF(ISTEXT(val),
    IF(val = "", 2166136261,
    REDUCE(2166136261, SEQUENCE(LEN(val)),
      LAMBDA(acc, _i, LET(
        _x, BITXOR(acc, CODE(MID(val, _i, 1))),
        lo, MOD(_x, 2^16),
        hi, INT(_x / 2^16),
        MOD(MOD(hi * 16777619, 2^16) * 2^16 + lo * 16777619, 2^32))))),
  IF(ISERROR(val),
    HASH("err" & ERROR.TYPE(val)),
  0)))))`,

  "ARR.SET": `LAMBDA(arr, _i, val, LET(
  _nc, COLUMNS(arr),
  IF(_nc = 1, HSTACK(val),
  IF(_i = 1,
    HSTACK(val, INDEX(arr, 1, SEQUENCE(, _nc - 1, 2))),
  IF(_i = _nc,
    HSTACK(INDEX(arr, 1, SEQUENCE(, _nc - 1)), val),
  HSTACK(
    INDEX(arr, 1, SEQUENCE(, _i - 1)),
    val,
    INDEX(arr, 1, SEQUENCE(, _nc - _i, _i + 1))))))))`,

  WITH: `LAMBDA(_k1, _v1, [_k2], [_v2], [_k3], [_v3], [_k4], [_v4],
  [_k5], [_v5], [_k6], [_v6], [_k7], [_v7], [_k8], [_v8],
  LET(
    _keys, FILTER(
      HSTACK(_k1,
        IF(ISOMITTED(_k2), "", _k2), IF(ISOMITTED(_k3), "", _k3),
        IF(ISOMITTED(_k4), "", _k4), IF(ISOMITTED(_k5), "", _k5),
        IF(ISOMITTED(_k6), "", _k6), IF(ISOMITTED(_k7), "", _k7),
        IF(ISOMITTED(_k8), "", _k8)),
      HSTACK(TRUE,
        NOT(ISOMITTED(_k2)), NOT(ISOMITTED(_k3)), NOT(ISOMITTED(_k4)),
        NOT(ISOMITTED(_k5)), NOT(ISOMITTED(_k6)), NOT(ISOMITTED(_k7)),
        NOT(ISOMITTED(_k8)))),
    _n, COLUMNS(_keys),
    LAMBDA(_key,
      IF(_key = "__keys__", _keys,
      IF(_key = "__size__", _n,
      IF(_key = "__pairs__",
        MAP(SEQUENCE(, _n * 2), LAMBDA(_i,
          CHOOSE(_i, _k1, _v1, _k2, _v2, _k3, _v3, _k4, _v4,
            _k5, _v5, _k6, _v6, _k7, _v7, _k8, _v8))),
      LET(
        _idx, IFERROR(XMATCH(_key, _keys), 0),
        IF(_idx = 0, #N/A,
        CHOOSE(_idx, _v1, _v2, _v3, _v4, _v5, _v6, _v7, _v8)))))))))`,

  OK: `LAMBDA(_val, _fn,
  IF(IFERROR(_val(#NULL!), "") = "error", _val, _fn(_val)))`,

  SHOW: `LAMBDA(val,
  IF(
    AND(ROWS(val) = 1, COLUMNS(val) = 1),
    LET(
      _probe, IFERROR(val(#NULL!), #N/A),
      IF(ISNA(_probe), val, SHOW(val("show")))),
    MAP(val, LAMBDA(_v, LET(
      _probe, IFERROR(_v(#NULL!), #N/A),
      IF(ISNA(_probe), _v, SHOW(_v("show"))))))))`,

  PIPE: `LAMBDA(obj, _steps,
  REDUCE(obj, SEQUENCE(INT(COLUMNS(_steps) / 2)),
    LAMBDA(acc, _i,
      acc(INDEX(_steps, 1, _i * 2 - 1), INDEX(_steps, 1, _i * 2)))))`,

  WHEN: `LAMBDA(obj, _cases, [default], LET(
  _t, IFERROR(obj(#NULL!), ""),
  _n, INT(COLUMNS(_cases) / 2),
  _types, INDEX(_cases, 1, SEQUENCE(, _n, 1, 2)),
  _i, IFERROR(XMATCH(_t, _types), 0),
  IF(_i > 0,
    INDEX(_cases, 1, _i * 2)(obj),
  IF(ISOMITTED(default), #VALUE!,
    default(obj)))))`,

  TRY: `LAMBDA(_val, _ctx,
  IF(ISERROR(_val),
    ERR(_ctx & " (" & CHOOSE(ERROR.TYPE(_val),
      "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A")
      & ")", FALSE),
    _val))`,

  OBJ: `LAMBDA(_type, handler,
  LAMBDA(msg, [arg],
    IF(ISERROR(msg), _type,
    LET(
      _raw, handler(msg, arg),
      IF(ISERROR(_raw),
        ERR(_type & ":" & msg & " (" &
          CHOOSE(ERROR.TYPE(_raw), "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A")
          & ")", FALSE),
      LET(
        probe, IFERROR(_raw(#NULL!), ""),
        IF(probe = "error",
          _raw,
        IF(probe = "__not_handled__",
          LET(
            midx, XMATCH(msg, {"type", "show", "eq", "hash"}),
            IF(ISERROR(midx),
              ERR(_type & ":doesNotUnderstand(" & msg & ")", FALSE),
            CHOOSE(midx,
              _type,
              "<" & _type & ">",
              FALSE,
              HASH(_type)))),
          _raw))))))))`,

  GUARD: `LAMBDA(_expr, _ctx,
  IF(ISERROR(_expr),
    ERR(_ctx, FALSE),
  LET(
    _probe, IFERROR(_expr(#NULL!), ""),
    IF(_probe = "error",
      _expr("_push", _ctx),
      _expr))))`,

  GIVEN: `LAMBDA(_vals, _fn, LET(
  _keys, _vals("__keys__"),
  _n, _vals("__size__"),
  _errs, TEXTJOIN("; ", TRUE,
    MAP(SEQUENCE(, _n), LAMBDA(_i, LET(
      _v, _vals(INDEX(_keys, 1, _i)),
      IF(IFERROR(_v(#NULL!), "") = "error", _v("ctx"), ""))))),
  IF(_errs = "", _fn(_vals), ERR(_errs, FALSE))))`,

  EXPECT: `LAMBDA(_val, _check, _ctx,
  IF(IFERROR(_val(#NULL!), "") = "error", _val,
  IF(ISERROR(_val), ERR(_ctx & ": got error", FALSE),
  IF(ISTEXT(_check),
    IF(IFERROR(_val(#NULL!), "") = _check, _val,
    ERR(_ctx & ": expected " & _check & ", got " & IFERROR(_val(#NULL!), "scalar"), FALSE)),
  LET(
    _result, _check(_val),
    IF(_result = TRUE, _val,
    IF(ISTEXT(_result), ERR(_ctx & ": " & _result, FALSE),
    ERR(_ctx & ": failed check", FALSE))))))))`,

  IS: `LAMBDA(_type, LAMBDA(_val, [_ctx], LET(
  _probe, IFERROR(_val(#NULL!), ""),
  IF(_probe = "error", _val,
  IF(_probe = _type, _val,
  ERR(IF(ISOMITTED(_ctx), "expected " & _type, _ctx & ": expected " & _type)
    & ", got " & IF(_probe = "", "non-object", _probe), FALSE))))))`,

  "IS.NUM": `LAMBDA(_val, [_ctx], LET(
  _pre, IF(ISOMITTED(_ctx), "", _ctx & ": "),
  IF(IFERROR(_val(#NULL!), "") = "error", _val,
  IF(ISERROR(_val), ERR(_pre & CHOOSE(ERROR.TYPE(_val), "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"), FALSE),
  IF(ISNUMBER(_val), _val,
  ERR(_pre & "must be a number", FALSE))))))`,

  "IS.STR": `LAMBDA(_val, [_ctx], LET(
  _pre, IF(ISOMITTED(_ctx), "", _ctx & ": "),
  IF(IFERROR(_val(#NULL!), "") = "error", _val,
  IF(ISERROR(_val), ERR(_pre & CHOOSE(ERROR.TYPE(_val), "#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"), FALSE),
  IF(ISTEXT(_val), _val,
  ERR(_pre & "must be a string", FALSE))))))`,

  VALIDATE: `LAMBDA(_keys, _vals, _checks, [_fn], LET(
  _n, COLUMNS(_keys),
  _single, AND(COLUMNS(_checks) = 1),
  _validated, MAP(SEQUENCE(, _n), LAMBDA(_i, LET(
    _k, INDEX(_keys, 1, _i),
    _v, INDEX(_vals, 1, _i),
    _c, IF(_single, _checks, INDEX(_checks, 1, _i)),
    _raw, _c(_v),
    LET(_probe, IFERROR(_raw(#NULL!), ""),
      IF(_probe = "error", ERR(_k & ": " & _raw("ctx"), _raw("trace")),
      IF(IFERROR(_raw = TRUE, FALSE), _v,
      IF(IFERROR(_raw = FALSE, FALSE), ERR(_k & ": failed check", FALSE),
      IF(ISTEXT(_raw), ERR(_k & ": " & _raw, FALSE),
      _raw)))))))),
  _lookup, LAMBDA(_key,
    IF(_key = "__keys__", _keys,
    IF(_key = "__size__", _n,
    IF(_key = "__pairs__",
      MAP(SEQUENCE(, _n * 2), LAMBDA(_i,
        IF(MOD(_i, 2) = 1,
          INDEX(_keys, 1, INT((_i + 1) / 2)),
          INDEX(_validated, 1, INT(_i / 2))))),
    LET(
      _idx, IFERROR(XMATCH(_key, _keys), 0),
      IF(_idx = 0, #N/A,
      INDEX(_validated, 1, _idx))))))),
  IF(ISOMITTED(_fn), _lookup,
  LET(
    _errs, TEXTJOIN("; ", TRUE,
      MAP(SEQUENCE(, _n), LAMBDA(_i, LET(
        _v, INDEX(_validated, 1, _i),
        IF(IFERROR(_v(#NULL!), "") = "error", _v("ctx"), ""))))),
    IF(_errs = "", _fn(_lookup), ERR(_errs, FALSE))))))`,

  DICT: `LAMBDA(_keys, _vals, LET(
  _mt, AND(ISLOGICAL(_keys)),
  _nc, IF(_mt, 0, COLUMNS(_keys)),
  LAMBDA(msg, [arg],
    IF(ISERROR(msg), "dict",
    IF(msg = "get",
      IF(_mt, #N/A, INDEX(_vals, 1, XMATCH(arg, _keys))),
    IF(msg = "set",
      DICT(
        IF(_mt, HSTACK(arg("key")), HSTACK(_keys, arg("key"))),
        IF(_mt, HSTACK(arg("val")), HSTACK(_vals, arg("val")))),
    IF(msg = "show",
      IF(_mt, "dict()",
      "dict(" & TEXTJOIN(", ", TRUE,
        MAP(SEQUENCE(, _nc), LAMBDA(_j,
          INDEX(_keys, 1, _j) & ":" & INDEX(_vals, 1, _j)))) & ")"),
    IF(msg = "has",
      IF(_mt, FALSE, ISNUMBER(XMATCH(arg, _keys))),
    IF(msg = "size", _nc,
    IF(msg = "keys", IF(_mt, "", _keys),
    IF(msg = "values", IF(_mt, "", _vals),
    IF(msg = "delete",
      IF(_mt, DICT(FALSE, FALSE),
      IF(_nc = 1, DICT(FALSE, FALSE),
      DICT(
        FILTER(_keys, SEQUENCE(, _nc) <> XMATCH(arg, _keys)),
        FILTER(_vals, SEQUENCE(, _nc) <> XMATCH(arg, _keys))))),
    #VALUE!))))))))))))`,

  "DICT.EMPTY": `DICT(FALSE, FALSE)`,

  RECORD: `LAMBDA(_type, _input, [_values], LET(
  _has_vals, NOT(ISOMITTED(_values)),
  _is_with, IF(_has_vals, FALSE, IFERROR(_input("__size__") > 0, FALSE)),
  _is_vstack, IF(OR(_has_vals, _is_with), FALSE, IFERROR(ROWS(_input) = 2, FALSE)),
  _hdrs, IF(_has_vals, _input, IF(_is_vstack, INDEX(_input, 1, 0), "")),
  _vals, IF(_has_vals, _values, IF(_is_vstack, INDEX(_input, 2, 0), "")),
  _pairs, IF(OR(_has_vals, _is_vstack),
    MAP(SEQUENCE(, COLUMNS(_hdrs) * 2), LAMBDA(_i,
      IF(MOD(_i, 2) = 1,
        INDEX(_hdrs, 1, INT((_i + 1) / 2)),
        INDEX(_vals, 1, INT(_i / 2))))),
    IF(_is_with, _input("__pairs__"), _input)),
  IF(ISERROR(COLUMNS(_pairs)), ERR(_type & ":construction", FALSE),
  LET(
    _n, INT(COLUMNS(_pairs) / 2),
    _keys, INDEX(_pairs, 1, SEQUENCE(, _n, 1, 2)),
    OBJ(_type,
      LAMBDA(msg, [arg], LET(
        ki, IFERROR(XMATCH(msg, _keys), 0),
        IF(ki > 0,
          INDEX(_pairs, 1, ki * 2),
        LET(
          mi, XMATCH(msg, {"keys", "show", "eq", "hash", "update"}),
          IF(ISERROR(mi), PASS,
          CHOOSE(mi,
            _keys,
            _type & "(" & TEXTJOIN(", ", TRUE,
              MAP(SEQUENCE(, _n), LAMBDA(_i,
                IFERROR(
                  INDEX(_keys, 1, _i) & ":" & SHOW(INDEX(_pairs, 1, _i * 2)),
                  INDEX(_keys, 1, _i) & ":<error>")))) & ")",
            IF(IFERROR(arg(#NULL!), "") = _type,
              AND(MAP(_keys, LAMBDA(k, arg(k) = RECORD(_type, _pairs)(k))))),
            REDUCE(HASH(_type), SEQUENCE(_n),
              LAMBDA(acc, _i, LET(
                _h, HASH(INDEX(_pairs, 1, _i * 2)),
                lo, MOD(BITXOR(acc, _h), 2^16),
                hi, INT(BITXOR(acc, _h) / 2^16),
                MOD(MOD(hi * 16777619, 2^16) * 2^16 + lo * 16777619, 2^32)))),
            RECORD(_type,
              REDUCE(_pairs, SEQUENCE(_n),
                LAMBDA(_p, _i, LET(
                  _k, INDEX(_keys, 1, _i),
                  _nv, arg(_k),
                  IF(ISNA(_nv), _p,
                    ARR.SET(_p, _i * 2, _nv)))))))))))))))))`,

  ENUM: `LAMBDA(_type, _variant, [_data],
  OBJ(_type & "." & _variant,
    LAMBDA(msg, [arg], LET(
      mi, XMATCH(msg, {"variant", "data", "is", "eq", "hash", "keys"}),
      IF(ISERROR(mi), PASS,
      CHOOSE(mi,
        _variant,
        IF(ISOMITTED(_data), #N/A, _data),
        arg = _variant,
        AND(
          IFERROR(arg(#NULL!), "") = _type & "." & _variant,
          IF(ISOMITTED(_data), TRUE,
          LET(_other, IFERROR(arg("data"), #N/A),
            IF(ISNA(_other), FALSE, _other = _data)))),
        HASH(_type & "." & _variant),
        IF(ISOMITTED(_data), HSTACK("variant"), HSTACK("variant", "data"))))))))`,
};

// ─── Roundtrip tests ────────────────────────────────────────────────────────

describe("prefix roundtrip", () => {
  for (const [name, formula] of Object.entries(CHARTER_FORMULAS)) {
    it(`roundtrips: ${name}`, () => {
      const prefixed = addPrefixes(formula);
      const stripped = stripPrefixes(prefixed);
      expect(stripped).toBe(formula);
    });
  }

  it("roundtrips with leading =", () => {
    const formula = "=LAMBDA(x, x + 1)";
    expect(stripPrefixes(addPrefixes(formula))).toBe(formula);
  });
});

// ─── addPrefixes specific behavior ──────────────────────────────────────────

describe("addPrefixes", () => {
  it("prefixes XLFN function names", () => {
    expect(addPrefixes("MAP(arr, fn)")).toBe("_xlfn.MAP(arr, fn)");
    expect(addPrefixes("HSTACK(a, b)")).toBe("_xlfn.HSTACK(a, b)");
    expect(addPrefixes("SEQUENCE(10)")).toBe("_xlfn.SEQUENCE(10)");
    expect(addPrefixes("FILTER(a, b)")).toBe("_xlfn._xlws.FILTER(a, b)");
    expect(addPrefixes("XMATCH(a, b)")).toBe("_xlfn.XMATCH(a, b)");
    expect(addPrefixes("TEXTJOIN(d, i, arr)")).toBe("_xlfn.TEXTJOIN(d, i, arr)");
    expect(addPrefixes("ISOMITTED(x)")).toBe("_xlfn.ISOMITTED(x)");
    expect(addPrefixes("SWITCH(a, b, c)")).toBe("_xlfn.SWITCH(a, b, c)");
    expect(addPrefixes("IFS(a, b)")).toBe("_xlfn.IFS(a, b)");
    expect(addPrefixes("CONCAT(a, b)")).toBe("_xlfn.CONCAT(a, b)");
    expect(addPrefixes("UNIQUE(arr)")).toBe("_xlfn.UNIQUE(arr)");
  });

  it("does not prefix non-XLFN functions", () => {
    expect(addPrefixes("IF(a, b, c)")).toBe("IF(a, b, c)");
    expect(addPrefixes("SUM(a, b)")).toBe("SUM(a, b)");
    expect(addPrefixes("INDEX(arr, 1, 2)")).toBe("INDEX(arr, 1, 2)");
    expect(addPrefixes("ISERROR(x)")).toBe("ISERROR(x)");
  });

  it("prefixes LAMBDA params and body references", () => {
    expect(addPrefixes("LAMBDA(x, x + 1)")).toBe(
      "_xlfn.LAMBDA(_xlpm.x, _xlpm.x + 1)",
    );
  });

  it("prefixes LAMBDA params with multiple params", () => {
    expect(addPrefixes("LAMBDA(a, b, a + b)")).toBe(
      "_xlfn.LAMBDA(_xlpm.a, _xlpm.b, _xlpm.a + _xlpm.b)",
    );
  });

  it("prefixes optional LAMBDA params (brackets → _xlop.)", () => {
    expect(addPrefixes("LAMBDA(x, [y], x + y)")).toBe(
      "_xlfn.LAMBDA(_xlpm.x, _xlop.y, _xlpm.x + _xlpm.y)",
    );
  });

  it("prefixes LET bindings and body references", () => {
    expect(addPrefixes("LET(x, 1, x + 1)")).toBe(
      "_xlfn.LET(_xlpm.x, 1, _xlpm.x + 1)",
    );
  });

  it("handles LET sequential scoping", () => {
    // x is not in scope for its own value, but is in scope for y's value
    expect(addPrefixes("LET(x, 1, y, x + 1, x + y)")).toBe(
      "_xlfn.LET(_xlpm.x, 1, _xlpm.y, _xlpm.x + 1, _xlpm.x + _xlpm.y)",
    );
  });

  it("handles nested LET", () => {
    expect(
      addPrefixes("LET(_a, 1, _b, LET(lo, MOD(_a, 10), lo + _a), _b)"),
    ).toBe(
      "_xlfn.LET(_xlpm._a, 1, _xlpm._b, _xlfn.LET(_xlpm.lo, MOD(_xlpm._a, 10), _xlpm.lo + _xlpm._a), _xlpm._b)",
    );
  });

  it("does not prefix self-references (named function calling itself)", () => {
    // ERR calls ERR — ERR is not in scope, should stay unprefixed
    expect(addPrefixes("LAMBDA(x, ERR(x))")).toBe(
      "_xlfn.LAMBDA(_xlpm.x, ERR(_xlpm.x))",
    );
  });

  it("handles nested LAMBDA (inner shadows outer)", () => {
    expect(addPrefixes("LAMBDA(x, LAMBDA(y, x + y))")).toBe(
      "_xlfn.LAMBDA(_xlpm.x, _xlfn.LAMBDA(_xlpm.y, _xlpm.x + _xlpm.y))",
    );
  });

  it("handles LAMBDA inside MAP", () => {
    expect(addPrefixes("MAP(arr, LAMBDA(x, x + 1))")).toBe(
      "_xlfn.MAP(arr, _xlfn.LAMBDA(_xlpm.x, _xlpm.x + 1))",
    );
  });

  it("handles REDUCE with LAMBDA", () => {
    expect(addPrefixes("REDUCE(0, arr, LAMBDA(acc, val, acc + val))")).toBe(
      "_xlfn.REDUCE(0, arr, _xlfn.LAMBDA(_xlpm.acc, _xlpm.val, _xlpm.acc + _xlpm.val))",
    );
  });

  it("handles LET inside LAMBDA body", () => {
    expect(addPrefixes("LAMBDA(x, LET(y, x + 1, y * 2))")).toBe(
      "_xlfn.LAMBDA(_xlpm.x, _xlfn.LET(_xlpm.y, _xlpm.x + 1, _xlpm.y * 2))",
    );
  });

  it("prefixes scoped identifier used in function position", () => {
    // A LET-bound identifier used as a function call
    expect(addPrefixes("LET(_fn, LAMBDA(x, x), _fn(5))")).toBe(
      "_xlfn.LET(_xlpm._fn, _xlfn.LAMBDA(_xlpm.x, _xlpm.x), _xlpm._fn(5))",
    );
  });

  it("handles ERR formula correctly", () => {
    const result = addPrefixes(CHARTER_FORMULAS.ERR);
    // LAMBDA → _xlfn.LAMBDA
    expect(result).toContain("_xlfn.LAMBDA");
    // params get _xlpm.
    expect(result).toContain("_xlpm._ctx");
    expect(result).toContain("_xlpm._trace");
    expect(result).toContain("_xlpm.msg");
    expect(result).toContain("_xlop.arg");
    // self-reference stays unprefixed
    expect(result).toContain("ERR(_xlpm._ctx");
    // HSTACK/TEXTJOIN get _xlfn.
    expect(result).toContain("_xlfn.HSTACK");
    expect(result).toContain("_xlfn.TEXTJOIN");
    // IF/ISERROR stay unprefixed
    expect(result).not.toContain("_xlfn.IF");
    expect(result).not.toContain("_xlfn.ISERROR");
  });

  it("handles WITH formula (many optional params)", () => {
    const result = addPrefixes(CHARTER_FORMULAS.WITH);
    // All params get _xlpm.
    expect(result).toContain("_xlpm._k1");
    expect(result).toContain("_xlop._k2");
    expect(result).toContain("_xlop._v8");
    // FILTER, HSTACK, ISOMITTED get _xlfn.
    expect(result).toContain("_xlfn._xlws.FILTER");
    expect(result).toContain("_xlfn.HSTACK");
    expect(result).toContain("_xlfn.ISOMITTED");
    // MAP, SEQUENCE, XMATCH get _xlfn.
    expect(result).toContain("_xlfn.MAP");
    expect(result).toContain("_xlfn.SEQUENCE");
    expect(result).toContain("_xlfn.XMATCH");
    // LET bindings get _xlpm.
    expect(result).toContain("_xlpm._keys");
    expect(result).toContain("_xlpm._n");
    expect(result).toContain("_xlpm._idx");
  });

  it("handles DICT formula (self-reference + complex nesting)", () => {
    const result = addPrefixes(CHARTER_FORMULAS.DICT);
    // Outer LAMBDA params
    expect(result).toContain("_xlpm._keys");
    expect(result).toContain("_xlpm._vals");
    // Inner LAMBDA params
    expect(result).toContain("_xlpm.msg");
    expect(result).toContain("_xlop.arg");
    // Self-reference DICT stays unprefixed
    expect(result).toContain("DICT(");
    expect(result).not.toContain("_xlfn.DICT");
    expect(result).not.toContain("_xlpm.DICT");
  });

  it("handles DICT.EMPTY (no LAMBDA/LET, self-reference only)", () => {
    // DICT is not an XLFN function, so it stays as-is
    expect(addPrefixes("DICT(FALSE, FALSE)")).toBe("DICT(FALSE, FALSE)");
  });

  it("handles HASH formula (deeply nested LET)", () => {
    const result = addPrefixes(CHARTER_FORMULAS.HASH);
    // Outer LAMBDA param
    expect(result).toContain("_xlpm.val");
    // REDUCE/SEQUENCE get _xlfn.
    expect(result).toContain("_xlfn.REDUCE");
    expect(result).toContain("_xlfn.SEQUENCE");
    // Inner LAMBDA params
    expect(result).toContain("_xlpm.acc");
    expect(result).toContain("_xlpm._i");
    // Nested LET bindings
    expect(result).toContain("_xlpm._a");
    expect(result).toContain("_xlpm._b");
    expect(result).toContain("_xlpm._c");
    expect(result).toContain("_xlpm._d");
    expect(result).toContain("_xlpm.lo");
    expect(result).toContain("_xlpm.hi");
    // Self-reference HASH stays unprefixed
    expect(result).toMatch(/[^.]HASH\(/);
  });

  it("preserves whitespace", () => {
    expect(addPrefixes("LAMBDA( x , x + 1 )")).toBe(
      "_xlfn.LAMBDA( _xlpm.x , _xlpm.x + 1 )",
    );
  });

  it("handles empty formula", () => {
    expect(addPrefixes("")).toBe("");
  });

  it("handles formula with no XLFN/scope content", () => {
    expect(addPrefixes("IF(A1 > 0, SUM(B1:B10), 0)")).toBe(
      "IF(A1 > 0, SUM(B1:B10), 0)",
    );
  });
});

// ─── stripPrefixes specific behavior ────────────────────────────────────────

describe("stripPrefixes", () => {
  it("strips _xlfn. from function names", () => {
    expect(stripPrefixes("_xlfn.LAMBDA(_xlpm.x, _xlpm.x)")).toBe(
      "LAMBDA(x, x)",
    );
  });

  it("strips _xlpm. from identifiers", () => {
    expect(stripPrefixes("_xlpm._ctx + _xlpm._trace")).toBe("_ctx + _trace");
  });

  it("strips both prefixes in mixed formula", () => {
    expect(
      stripPrefixes(
        "_xlfn.LAMBDA(_xlpm.x, IF(_xlpm.x > 0, _xlfn.HSTACK(_xlpm.x), 0))",
      ),
    ).toBe("LAMBDA(x, IF(x > 0, HSTACK(x), 0))");
  });

  it("passes through non-prefixed formula unchanged", () => {
    expect(stripPrefixes("IF(A1, SUM(B1:B10), 0)")).toBe(
      "IF(A1, SUM(B1:B10), 0)",
    );
  });

  it("handles empty formula", () => {
    expect(stripPrefixes("")).toBe("");
  });
});
