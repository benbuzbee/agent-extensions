import { createHash } from "node:crypto";

// Stable id derivation. Same input → identical Excalidraw element ids.
// SHA-256 → base64url, truncated to Excalidraw's 21-character convention.

export function stableId(seed: string): string {
  return createHash("sha256").update(seed).digest("base64url").slice(0, 21);
}

// Excalidraw seeds are 31-bit positive integers (used for hand-drawn jitter).
export function stableSeed(seed: string): number {
  return createHash("sha256").update(seed).digest().readUInt32BE(0) & 0x7fffffff;
}

export const nodeElementId = (id: string) => stableId("node:" + id);
// idx=0 keeps the v1 seed ("nodelabel:<id>") so single-label snapshots stay stable.
export const nodeLabelId = (id: string, idx = 0) =>
  stableId(idx === 0 ? "nodelabel:" + id : "nodelabel:" + id + ":" + idx);
export const edgeElementId = (id: string) => stableId("edge:" + id);
export const edgeLabelId = (id: string, idx = 0) =>
  stableId(idx === 0 ? "edgelabel:" + id : "edgelabel:" + id + ":" + idx);
export const spacerId = (corner: "tl" | "br") => stableId("spacer:" + corner);

export interface Seeds {
  seed: number;
  versionNonce: number;
}

// Excalidraw uses two distinct integers per element: `seed` (rough.js jitter)
// and `versionNonce` (CRDT-ish change-detection nonce). Same input → same pair.
export function seedsFor(seedKey: string): Seeds {
  return {
    seed: stableSeed(seedKey),
    versionNonce: stableSeed("nonce:" + seedKey),
  };
}
