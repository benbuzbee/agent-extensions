// Pure-unit tests for the portable cookie reader. Runs in plain Node (no
// Workers pool) -- it only needs the standard `Request`, which Node provides.
// This also anchors the "core" project so the test split has coverage on both
// sides; the code-owning phases layer richer oauth/session unit tests on top.
import { describe, it, expect } from "vitest";
import { readCookie, SESSION_COOKIE } from "../../src/core/cookies";

const reqWith = (cookie?: string) =>
  new Request("https://example.test/", {
    headers: cookie ? { Cookie: cookie } : {},
  });

describe("readCookie", () => {
  it("returns null when there is no Cookie header", () => {
    expect(readCookie(reqWith(), SESSION_COOKIE)).toBeNull();
  });

  it("reads a single named cookie", () => {
    expect(readCookie(reqWith("sid=abc123"), "sid")).toBe("abc123");
  });

  it("picks the right cookie out of several and trims whitespace", () => {
    const req = reqWith("a=1; sid=abc123; oauth_state=n.s");
    expect(readCookie(req, "sid")).toBe("abc123");
    expect(readCookie(req, "oauth_state")).toBe("n.s");
  });

  it("returns null for a name that is not present", () => {
    expect(readCookie(reqWith("a=1; b=2"), "sid")).toBeNull();
  });
});
