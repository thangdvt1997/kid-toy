import { formatAgeRange, formatVnd } from "./format";

describe("formatVnd", () => {
  it("groups with Vietnamese thousands separators", () => {
    expect(formatVnd("450000", "vi")).toBe("450.000 ₫");
  });

  it("groups with English thousands separators", () => {
    expect(formatVnd("450000", "en")).toBe("450,000 ₫");
  });

  it("formats zero", () => {
    expect(formatVnd("0", "vi")).toBe("0 ₫");
  });

  it("preserves full precision for a 15-digit amount via the BigInt path", () => {
    const result = formatVnd("123456789012345", "vi");
    expect(result).toContain("123.456.789.012.345");
    expect(result).not.toMatch(/e\+/i);
  });
});

describe("formatAgeRange", () => {
  it("formats a Vietnamese age range", () => {
    expect(formatAgeRange(0, 3, "vi")).toBe("0-3 tuổi");
  });

  it("formats an English age range", () => {
    expect(formatAgeRange(6, 12, "en")).toBe("Ages 6-12");
  });
});
