# dataflow

Linear or branching data pipelines — ETL, stream processing, ingest/transform/load chains, flowcharts.

**Direction**: `right` — input on the left, output on the right.

**Nodes**: transformation stages, sources, and sinks. Source and sink as `ellipse` (conventional for "data lives here"); intermediate transforms as `rectangle`. Decision points use `shape: diamond`.

**Arrows**: direction of data movement. Edge labels are the *data shape* in transit — record type, format, batch size — not the verb. ("CSV records" or "Avro events", not "reads".)

**Grouping**: stages that share a runtime (a Spark job, a Lambda, a single Airflow DAG) can use `children:`. Don't group by team or ownership here — that's an architecture concern.

**Granularity**: each stage is one transformation. If a stage has internal sub-steps worth showing, it earns its own sub-diagram rather than nested children.
