Local adapter. Identity + injection placement + the Node disk layer — never rendering.

- `author.ts` — the fixed `"user"` `LOCAL_AUTHOR` the local server stamps into every seed (and the widget's fallback for a malformed one). The login doubles as the legacy sidecar author string, so it is part of the on-disk format.
- `inject.ts` — PLACES the strings produced by `review-ux/inject.ts` (threads + `LOCAL_AUTHOR`) before `</body>`; it must not inline or re-derive the markup.
- `sidecar-store.ts` + `legacy-format.ts` — the Node disk layer, server-only. `SidecarStore` is the local `?comments` route's backing store (read-modify-write over the sidecar file); `legacy-format.ts` is the SOLE surviving home of the legacy `*.comments.json` shape (`CommentsModel`/`LegacyComment` + `legacyToThread`/`threadToLegacy`), so on-disk files stay byte-unchanged while the wire is the internal `{ threads }` view.

Change how a comment looks or the composer behaves in `review-ux/`, never here.
