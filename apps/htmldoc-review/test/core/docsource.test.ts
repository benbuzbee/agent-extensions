// Pure-unit tests for the portable doc-request parser. Runs in plain Node (no
// Workers pool): parseDocRequest is dependency-free string logic, so it does
// not need Miniflare/KV. The fetchDoc network path (URL shape, ?ref encoding)
// is covered by the worker integration suite, which can mock globalThis.fetch.
import { describe, it, expect } from "vitest";
import { parseDocRequest, InvalidPathError } from "../../src/core/docsource";

describe("parseDocRequest", () => {
  it("splits the first segment as repo and the remainder as the doc path", () => {
    expect(parseDocRequest("/app-ios/docs/foo.html")).toEqual({
      repo: "app-ios",
      docPath: "docs/foo.html",
    });
  });

  it("handles a single-file doc path", () => {
    expect(parseDocRequest("/app-ios/guide.html")).toEqual({
      repo: "app-ios",
      docPath: "guide.html",
    });
  });

  it("tolerates leading slashes", () => {
    expect(parseDocRequest("///app-ios/guide.html")).toEqual({
      repo: "app-ios",
      docPath: "guide.html",
    });
  });

  it("throws InvalidPathError when there is no doc path (bare repo)", () => {
    expect(() => parseDocRequest("/app-ios")).toThrow(InvalidPathError);
  });

  it("throws InvalidPathError on the root path", () => {
    expect(() => parseDocRequest("/")).toThrow(InvalidPathError);
  });

  it("throws InvalidPathError when the doc path is empty (trailing slash only)", () => {
    expect(() => parseDocRequest("/app-ios/")).toThrow(InvalidPathError);
  });
});
