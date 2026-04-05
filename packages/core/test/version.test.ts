import { describe, it, expect } from "vitest";
import { parseSemVer, compareSemVer, satisfies } from "../src/version.js";

describe("parseSemVer", () => {
  it("parses valid versions", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseSemVer("10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it("rejects invalid versions", () => {
    expect(parseSemVer("1.2")).toBeNull();
    expect(parseSemVer("abc")).toBeNull();
    expect(parseSemVer("1.2.3-beta")).toBeNull();
  });
});

describe("compareSemVer", () => {
  it("compares versions correctly", () => {
    expect(compareSemVer(parseSemVer("1.0.0")!, parseSemVer("2.0.0")!)).toBeLessThan(0);
    expect(compareSemVer(parseSemVer("1.0.0")!, parseSemVer("1.0.0")!)).toBe(0);
    expect(compareSemVer(parseSemVer("1.1.0")!, parseSemVer("1.0.0")!)).toBeGreaterThan(0);
    expect(compareSemVer(parseSemVer("1.0.1")!, parseSemVer("1.0.0")!)).toBeGreaterThan(0);
  });
});

describe("satisfies", () => {
  it("handles exact match", () => {
    expect(satisfies("1.0.0", "1.0.0")).toBe(true);
    expect(satisfies("1.0.1", "1.0.0")).toBe(false);
  });

  it("handles >= constraint", () => {
    expect(satisfies("1.0.0", ">=1.0.0")).toBe(true);
    expect(satisfies("2.0.0", ">=1.0.0")).toBe(true);
    expect(satisfies("0.9.0", ">=1.0.0")).toBe(false);
  });

  it("handles ^ constraint", () => {
    expect(satisfies("1.0.0", "^1.0.0")).toBe(true);
    expect(satisfies("1.5.0", "^1.0.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfies("0.9.0", "^1.0.0")).toBe(false);
  });

  it("handles ~ constraint", () => {
    expect(satisfies("1.2.0", "~1.2.0")).toBe(true);
    expect(satisfies("1.2.5", "~1.2.0")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.0")).toBe(false);
  });

  it("handles empty specifier as any", () => {
    expect(satisfies("1.0.0", "")).toBe(true);
    expect(satisfies("99.99.99", "")).toBe(true);
  });
});
