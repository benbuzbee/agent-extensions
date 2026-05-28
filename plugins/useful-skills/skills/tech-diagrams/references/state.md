# state

A finite set of states and the transitions between them.

**Direction**: `right` for left-to-right reading of a process; `down` for hierarchical or top-down state machines. Either is fine.

**Nodes**: each state is one node. `shape: ellipse` is conventional for states; `shape: diamond` for decision/condition points within a transition. The grammar has no special start/end pseudo-states — a normal node labeled "Start" or "End", optionally styled distinctly, is the idiom.

**Arrows**: transitions. The edge label is the *event or condition* that triggers the transition, optionally with a guard or action. UML's `event [guard] / action` form is precise; plain English is fine for informal diagrams.

**Grouping**: composite states (states-within-states) use `children:`.

**Granularity**: include every state with distinct behavior or distinct outgoing transitions. Collapse intermediate states into transitions when nothing distinguishes them.
