# architecture

Systems and the components that talk to each other — services, datastores, queues, external APIs.

**Nodes**: anything that runs, persists, or terminates a request. Services as `rectangle`, datastores as `ellipse` (convention, not enforced). Wire protocols and payloads (HTTPS, JSON, gRPC) are usually edge labels, not their own nodes.

**Arrows**: direction of request or data flow — caller to callee for sync, producer to consumer for async. If both directions matter, prefer one arrow with a verb label ("reads", "publishes") over a bidirectional pair.

**Grouping**: `children:` for logical containment (a service mesh, a VPC, a domain). `lanes:` for ordered tiers (client → server → db). Combine when both are useful.

**Granularity**: include only components the reader has reason to point at — "we should scale this", "this is the bottleneck". Don't break a database into tables (that's the `er` genre). Don't surface retry queues, dead-letter queues, or cache layers unless they're load-bearing to the conversation.
