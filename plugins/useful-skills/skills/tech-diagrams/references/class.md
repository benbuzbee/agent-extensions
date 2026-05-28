# class

UML class diagrams. Classes as nodes, relationships as edges with specific arrowheads.

**Direction**: `down` is conventional — parents above children in inheritance.

**Nodes**: each class is one node. For a multi-section class box (name + attributes + methods), use the `labels:` array with positions standing in for UML's three compartments:

- `at: inside-top` — class name (and optional `<<stereotype>>`)
- `at: inside-center` — attributes
- `at: inside-bottom` — methods

**Arrows** (genre-specific arrowhead vocabulary):

| Relationship | Style | Direction |
|---|---|---|
| Inheritance (`extends`) | `endArrow: triangle_outline` | child → parent |
| Realization (`implements`) | `endArrow: triangle_outline` + `strokeStyle: dashed` | class → interface |
| Composition (strong ownership, filled diamond) | `startArrow: diamond` | owner → owned |
| Aggregation (weak ownership, open diamond) | `startArrow: diamond_outline` | owner → owned |
| Association (plain reference) | `endArrow: arrow` (the default) | from → to |
| Dependency | `strokeStyle: dashed` | depender → dependee |

**Granularity**: include the classes the reader needs to reason about; don't enumerate every field and method, that drifts toward documentation. Stereotypes (`<<entity>>`, `<<service>>`, `<<interface>>`) are useful when role isn't obvious from the name.
