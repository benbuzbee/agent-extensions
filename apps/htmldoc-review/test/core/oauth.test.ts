// Pure-unit tests for the OAuth primitives in src/core/oauth.ts. These run in a
// plain Node environment via vanilla Vitest (NO Workers pool): every helper here
// depends only on Web Crypto / btoa, both of which Node provides, so no
// Miniflare or KV is needed. The full beginLogin/completeLogin flows (which need
// a real Request and the session store) are covered by the worker suite; here we
// pin the security-critical building blocks: the state HMAC sign/verify pair,
// the constant-time compare, URL-safe base64, and the state-cookie clear string.
import { describe, it, expect } from "vitest";
import {
  b64url,
  hmac,
  timingSafeEqual,
  clearStateCookieString,
} from "../../src/core/oauth";

describe("b64url", () => {
  it("encodes empty input as the empty string", () => {
    expect(b64url(new Uint8Array([]))).toBe("");
  });

  it("strips padding that standard base64 would add", () => {
    // "f" -> base64 "Zg==" ; "fo" -> "Zm8=" ; both lose their '=' padding.
    expect(b64url(new TextEncoder().encode("f"))).toBe("Zg");
    expect(b64url(new TextEncoder().encode("fo"))).toBe("Zm8");
    expect(b64url(new TextEncoder().encode("foo"))).toBe("Zm9v");
  });

  it("uses the URL-safe alphabet (- and _ instead of + and /)", () => {
    // 0xFB,0xFF base64-encodes to "+/8=" in the standard alphabet, which must
    // become "-_8" here (and never contain '+', '/', or '=').
    const out = b64url(new Uint8Array([0xfb, 0xff]));
    expect(out).toBe("-_8");
    expect(out).not.toMatch(/[+/=]/);
  });

  it("round-trips through the standard base64 decoder after re-padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = b64url(bytes);
    expect(enc).not.toMatch(/[+/=]/);
    // Reverse the URL-safe substitutions and restore padding, then atob.
    const std = enc.replace(/-/g, "+").replace(/_/g, "/");
    const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
    const decoded = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    expect([...decoded]).toEqual([...bytes]);
  });
});

describe("hmac (state nonce signing)", () => {
  const key = "test-signing-key";

  it("produces a deterministic, URL-safe signature for the same key+message", async () => {
    const a = await hmac(key, "nonce-123");
    const b = await hmac(key, "nonce-123");
    expect(a).toBe(b);
    expect(a).not.toMatch(/[+/=]/);
    expect(a.length).toBeGreaterThan(0);
  });

  it("changes the signature when the message changes", async () => {
    const a = await hmac(key, "nonce-a");
    const b = await hmac(key, "nonce-b");
    expect(a).not.toBe(b);
  });

  it("changes the signature when the key changes (key is the trust anchor)", async () => {
    const a = await hmac("key-one", "same-nonce");
    const b = await hmac("key-two", "same-nonce");
    expect(a).not.toBe(b);
  });

  it("matches a known-answer vector for HMAC-SHA256 (b64url of the digest)", async () => {
    // RFC 4231 test case 1: key = 0x0b*20, data = "Hi There".
    const knownKey = "\x0b".repeat(20);
    // Expected hex digest from RFC 4231 case 1.
    const hex =
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
    const expectedBytes = Uint8Array.from(
      hex.match(/../g)!.map((h) => parseInt(h, 16)),
    );
    expect(await hmac(knownKey, "Hi There")).toBe(b64url(expectedBytes));
  });

  it("sign-then-verify succeeds with timingSafeEqual, and a forged sig fails", async () => {
    // This mirrors what completeLogin does: recompute the HMAC over the cookie's
    // nonce and compare it (constant-time) against the presented signature.
    const nonce = crypto.randomUUID();
    const sig = await hmac(key, nonce);
    const recomputed = await hmac(key, nonce);
    expect(timingSafeEqual(recomputed, sig)).toBe(true);

    // A signature minted under a different key must not verify.
    const forged = await hmac("attacker-key", nonce);
    expect(timingSafeEqual(recomputed, forged)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns true for two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false when lengths differ", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abcd", "abc")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
  });

  it("returns false when only one character differs", () => {
    expect(timingSafeEqual("abcdef", "abcdeg")).toBe(false);
    expect(timingSafeEqual("Xbcdef", "abcdef")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(timingSafeEqual("ABC", "abc")).toBe(false);
  });
});

describe("clearStateCookieString", () => {
  it("emits a Max-Age=0 deletion cookie scoped to the OAuth path", () => {
    const out = clearStateCookieString();
    // Deletes the named state cookie...
    expect(out).toMatch(/^oauth_state=/);
    // ...with an empty value and an immediate expiry.
    expect(out).toMatch(/oauth_state=;/);
    expect(out).toMatch(/Max-Age=0/i);
    // ...scoped to /auth so the browser treats it as the same cookie it set.
    expect(out).toMatch(/Path=\/auth/i);
    // ...and keeps the hardened attributes so the clear isn't downgraded.
    expect(out).toMatch(/HttpOnly/i);
    expect(out).toMatch(/Secure/i);
    expect(out).toMatch(/SameSite=Lax/i);
  });
});
