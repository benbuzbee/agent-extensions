# Examples

Worked YAML for each diagram genre.

## Pipeline (dataflow)

```yaml
version: 1
direction: right
nodes:
  ingest: { label: Ingest }
  transform: { label: Transform }
  load: { label: Load, style: { fill: green-light } }
edges:
  - { from: ingest, to: transform }
  - { from: transform, to: load }
```

## Hierarchy with grouping (architecture)

```yaml
version: 1
direction: down
nodes:
  cluster:
    label: Production
    children: [api, worker]
  api:
    label: API
    style: { fill: blue-light }
  worker:
    label: Worker
    style: { fill: blue-light }
  db:
    label: Postgres
    shape: ellipse
edges:
  - { from: api, to: db, label: reads }
  - { from: worker, to: db, label: writes }
```

## State machine (decision diamond + colored states)

```yaml
version: 1
direction: right
nodes:
  start: { label: Start, shape: ellipse, style: { fill: green-light } }
  check: { label: Validate, shape: diamond, style: { fill: yellow-light } }
  ok:    { label: Accept,   shape: ellipse, style: { fill: green-light } }
  fail:  { label: Reject,   shape: ellipse, style: { fill: red-light } }
edges:
  - { from: start, to: check }
  - { from: check, to: ok,   label: pass, style: { stroke: green } }
  - { from: check, to: fail, label: fail, style: { stroke: red, strokeStyle: dashed } }
```

## Class node with title, stereotype, and member (multi-label)

```yaml
version: 1
direction: down
nodes:
  user:
    width: 200
    height: 100
    style: { fill: blue-light }
    labels:
      - { text: "User",       at: inside-top,    style: { size: 20 } }
      - { text: "<<entity>>", at: inside-center, style: { size: 12, color: gray } }
      - { text: "+ id: UUID", at: inside-bottom, style: { size: 14 } }
```

## Fan-out via array `to:` (one source → N targets)

```yaml
version: 1
direction: right
nodes:
  source: { label: Source }
  a: { label: Worker A }
  b: { label: Worker B }
  c: { label: Worker C }
  d: { label: Worker D }
edges:
  - from: source
    to: [a, b, c, d]
    label: dispatch
```

## Swimlanes / tiered architecture (lanes stack along flow direction)

```yaml
version: 1
direction: down
lanes: [client, server, db]
nodes:
  client:
    label: Client
    children: [browser, mobile]
    style: { fill: blue-light }
  server:
    label: Server
    children: [api, worker]
    style: { fill: green-light }
  db:
    label: Database
    children: [postgres]
    style: { fill: yellow-light }
  browser: { label: Browser }
  mobile:  { label: Mobile }
  api:     { label: API }
  worker:  { label: Worker }
  postgres: { label: Postgres, shape: ellipse }
edges:
  - { from: browser, to: api, label: "GET" }
  - { from: mobile,  to: api, label: "POST" }
  - from: api
    to: postgres
    labels:
      - { text: "SELECT", at: start }
      - { text: "rows",   at: end }
    style: { startArrow: arrow }
  - { from: worker,  to: postgres, label: "INSERT" }
```

## Class diagram (UML arrowheads)

```yaml
version: 1
direction: down
nodes:
  animal: { label: Animal }
  dog:    { label: Dog }
  car:    { label: Car }
  engine: { label: Engine }
  team:   { label: Team }
  player: { label: Player }
  service: { label: Service }
  logger:  { label: Logger }
edges:
  # Inheritance: open triangle at the parent end.
  - { from: dog, to: animal, label: extends, style: { endArrow: triangle_outline } }
  # Composition: filled diamond at the owner end.
  - { from: car, to: engine, label: composes, style: { startArrow: diamond, endArrow: arrow } }
  # Aggregation: open diamond at the owner end.
  - { from: team, to: player, label: has, style: { startArrow: diamond_outline, endArrow: arrow } }
  # Dependency: dashed arrow.
  - { from: service, to: logger, label: uses, style: { strokeStyle: dashed } }
```
