# er

Entity-relationship diagrams. Entities as nodes, relationships as edges with cardinality arrowheads.

**Direction**: either `right` or `down` — both are common.

**Nodes**: each entity is one node (`rectangle`). For attributes-in-entity, use the `labels:` array — `at: inside-top` for the entity name, `at: inside-center` / `at: inside-bottom` for attribute lists. For Chen-style relationship diamonds, an explicit `shape: diamond` node between two entities also works, but crowfoot edges are more common in modern ER.

**Arrows** (crowfoot cardinality — set `startArrow` and `endArrow` independently to the cardinality at each end):

| Cardinality | Arrowhead |
|---|---|
| Exactly one | `crowfoot_one` |
| Zero or one | `crowfoot_zero_or_one` |
| Many (zero or more) | `crowfoot_many` |
| One or more | `crowfoot_one_or_more` |
| One or many | `crowfoot_one_or_many` |

Edge label is the relationship verb ("places", "contains", "owns").

**Granularity**: one entity per logical table. Don't draw every junction table unless the relationship's cardinality is itself the point of the diagram.
