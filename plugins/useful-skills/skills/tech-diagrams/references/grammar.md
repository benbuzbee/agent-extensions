# Grammar

YAML schema for the tech-diagrams CLI. The CLI validates against this schema strictly — unknown fields are rejected, not silently ignored.

```yaml
version: 1                # required: schema version (only "1")
layout: layered           # optional: layered (default) | mrtree | force
direction: right          # optional: right (default) | down | left | up
spacing:                  # optional: pixel spacing overrides
  node: 40                #   between sibling nodes
  layer: 60               #   between layers (layered algorithm)
  edge: 20                #   around edges
  edgeNode: 20            #   between edges and nodes (overrides edge for this)
  edgeEdge: 20            #   between parallel edges (overrides edge for this)
lanes: [a, b, c]          # optional: ordered list of container ids; each becomes a
                          #   stratified lane along the flow direction. Lanes must be
                          #   top-level container nodes (have `children:`).
nodes:                    # required: at least one entry
  <id>:
    label: "..."          # optional shorthand — same as labels: [{text: "..."}]
    labels:               # optional multi-label form; mutually exclusive with `label`
      - text: "Title"
        at: inside-top    # node positions: inside-top | inside-center (default) | inside-bottom
                          #                 outside-top | outside-bottom | outside-left | outside-right
        style:
          color: gray     # any stroke color (see palette below)
          size: 14        # font size in px (positive number)
    shape: rectangle      # optional: rectangle (default) | ellipse | diamond
    width: 160            # optional: leaf-node only; overrides auto-sizing
    height: 60            # optional: leaf-node only; overrides auto-sizing
    children: [a, b]      # optional: makes this a container of those nodes
    style:
      stroke: black       # black|gray|red|orange|yellow|green|teal|blue|violet|pink
      fill: blue-light    # transparent | <color>-light (one of the same hues)
      fillStyle: hachure  # hachure (default) | solid | cross-hatch
      strokeStyle: solid  # solid (default) | dashed | dotted
      strokeWidth: 2      # 1-4
      roughness: 1        # 0-2 (0 = clean, 2 = sketchy)
edges:                    # optional
  - from: <id>            # node id, OR array of ids to fan-in from N sources
    to: <id>              # node id, OR array of ids to fan-out to N targets
    label: "..."          # optional shorthand — same as labels: [{text: "..."}]
    labels:               # optional multi-label form; mutually exclusive with `label`
      - text: "..."
        at: middle        # edge positions: start | middle (default) | end
        style: { color: blue, size: 12 }
    style:                # optional; node-style fields PLUS:
      startArrow: none    # arrowhead at source end (default: none)
      endArrow: arrow     # arrowhead at target end (default: arrow)
                          # values: none | arrow | bar | dot |
                          #   triangle | triangle_outline (UML inheritance/realization) |
                          #   diamond | diamond_outline (UML composition/aggregation) |
                          #   crowfoot_one | crowfoot_many | crowfoot_one_or_many |
                          #   crowfoot_zero_or_one | crowfoot_one_or_more (ER notation)
```

## Rules

- A node either has `children:` (container; ELK sizes it) OR `width`/`height` (leaf). Not both.
- A node may set `label` (single string) OR `labels:` (array). Not both. Same for edges.
- Edge `from`/`to` accepts a single id or an array. Array forms expand into N×M independent arrows — one per source/target pair — sharing the same labels and style. `from: [a, b], to: [x, y]` produces four arrows: a→x, a→y, b→x, b→y.
- Each node id can be a child of at most one parent. Cycles in parent/child are rejected.

## Label sizing and wrap

- Leaf nodes auto-grow to enclose their bound (`inside-center`) label. The label is wrapped to a per-shape target aspect (`rectangle` 2.0, `ellipse` 1.6, `diamond` 1.5), then the shape's bounding box inflates so the wrapped block fits the inscribed rectangle (rectangle 1.0, ellipse √2, diamond 2.0). Node dimensions never shrink below 160×60.
- Edge labels do **not** auto-wrap — they honor explicit `\n` only. Short edge ribbons stay on one line; insert `\n` to force a break.
- Explicit `\n` in a node label forces a hard break and is never re-broken — author intent wins. Greedy auto-wrap fills lines within paragraphs; long single words overflow rather than break mid-word.
- Setting `width` and/or `height` on a node overrides auto-sizing for that axis.

## Error contract

CLI exit 1 means validation failed. stderr is a single JSON document:

```json
{
  "ok": false,
  "errors": [
    {
      "path": "nodes.api.shape",
      "code": "unknown_value",
      "message": "value \"rectangel\" at \"nodes.api.shape\" is not allowed; expected one of \"rectangle\", \"ellipse\", \"diamond\"",
      "suggestion": "did you mean \"rectangle\"?"
    }
  ]
}
```

Codes: `missing_field`, `wrong_type`, `unknown_field`, `unknown_value`, `bad_reference`, `duplicate_id`, `cycle`, `yaml_parse`, `version_unsupported`. `path` points at the offending location; `suggestion` (when present) is the next-action hint.
