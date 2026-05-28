import { parse as parseYaml } from "yaml";
import { ZodError, type ZodIssue } from "zod";
import {
  DiagramSchema,
  EDGE_LABEL_AT,
  NODE_LABEL_AT,
  type Diagram,
} from "./schema.ts";
import { closest, suggestKey, type KeyContext, type ValidationError } from "../errors.ts";

const NODE_AT_VALUES = NODE_LABEL_AT.options;
const EDGE_AT_VALUES = EDGE_LABEL_AT.options;

export interface ValidationOk {
  ok: true;
  diagram: Diagram;
}

export interface ValidationFail {
  ok: false;
  errors: ValidationError[];
}

export type ValidationResult = ValidationOk | ValidationFail;

export function validate(yamlText: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText, { strict: true });
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          code: "yaml_parse",
          message: `YAML parse error: ${errorMessage(e)}`,
        },
      ],
    };
  }

  if (parsed === null || parsed === undefined) {
    return {
      ok: false,
      errors: [{ path: "", code: "missing_field", message: "diagram is empty" }],
    };
  }

  const result = DiagramSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, errors: zodToErrors(result.error) };
  }

  const integrityErrors = checkIntegrity(result.data);
  if (integrityErrors.length > 0) {
    return { ok: false, errors: integrityErrors };
  }

  return { ok: true, diagram: result.data };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function displayPath(path: string): string {
  return path || "(root)";
}

function mkSuggestion(word: string | undefined): string | undefined {
  return word ? `did you mean "${word}"?` : undefined;
}

function zodToErrors(err: ZodError): ValidationError[] {
  return err.issues.map(issueToError);
}

function issueToError(issue: ZodIssue): ValidationError {
  const path = issue.path.map(String).join(".");
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined") {
        return {
          path,
          code: "missing_field",
          message: `required field "${displayPath(path)}" is missing`,
        };
      }
      return {
        path,
        code: "wrong_type",
        message: `expected ${issue.expected}, got ${issue.received} at "${path}"`,
      };
    case "unrecognized_keys": {
      const keys = issue.keys.join(", ");
      const ctx = inferContext(issue.path);
      const first = issue.keys[0];
      return {
        path,
        code: "unknown_field",
        message: `unknown field(s) ${keys} at "${displayPath(path)}"`,
        suggestion: mkSuggestion(first ? suggestKey(first, ctx) : undefined),
      };
    }
    case "invalid_enum_value": {
      const opts = issue.options.map((v) => JSON.stringify(v)).join(", ");
      return {
        path,
        code: "unknown_value",
        message: `value ${JSON.stringify(issue.received)} at "${path}" is not allowed; expected one of ${opts}`,
        suggestion: mkSuggestion(closest(String(issue.received), issue.options.map(String), 3)),
      };
    }
    case "invalid_literal":
      if (issue.received === undefined) {
        return {
          path,
          code: "missing_field",
          message: `required field "${displayPath(path)}" is missing`,
        };
      }
      return {
        path,
        code: "version_unsupported",
        message: `expected ${JSON.stringify(issue.expected)} at "${path}", got ${JSON.stringify(issue.received)}`,
      };
    case "too_small":
    case "too_big":
      return {
        path,
        code: "wrong_type",
        message: `value at "${path}" is out of range: ${issue.message}`,
      };
    default:
      return {
        path,
        code: "wrong_type",
        message: issue.message,
      };
  }
}

function inferContext(path: (string | number)[]): KeyContext {
  if (path.length === 0) return "root";
  const last = path[path.length - 1];
  if (last === "spacing") return "spacing";
  // labels[i].style is a label-style namespace; node/edge .style is the shape style.
  if (last === "style") {
    if (path.length >= 2 && path[path.length - 2] === "labels") return "labelStyle";
    return path[0] === "edges" ? "edgeStyle" : "style";
  }
  // Inside a labels[i] entry, surface label-key suggestions (text, at, style).
  if (path.length >= 2 && path[path.length - 2] === "labels" && typeof last === "number") {
    return "label";
  }
  if (path[0] === "edges") return "edge";
  if (path[0] === "nodes") return "node";
  return "root";
}

function checkIntegrity(d: Diagram): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set(Object.keys(d.nodes));

  // 1. nodes is non-empty (the ergonomic case for missing_field)
  if (nodeIds.size === 0) {
    errors.push({
      path: "nodes",
      code: "missing_field",
      message: "nodes must have at least one entry",
    });
    return errors;
  }

  // Build child→parent map up-front so lane validation can detect non-top-level lanes.
  // (Same map is rebuilt in the children-validation pass below; we just keep this
  // light copy for the lane check, since the full pass also reports its own errors.)
  const childToParent = new Map<string, string>();
  for (const [parentId, node] of Object.entries(d.nodes)) {
    for (const childId of node.children ?? []) {
      if (!childToParent.has(childId)) childToParent.set(childId, parentId);
    }
  }

  if (d.lanes) {
    const seenLane = new Set<string>();
    d.lanes.forEach((laneId, idx) => {
      const path = `lanes[${idx}]`;
      if (seenLane.has(laneId)) {
        errors.push({
          path,
          code: "duplicate_id",
          message: `lane "${laneId}" listed twice in lanes`,
        });
        return;
      }
      seenLane.add(laneId);
      if (!nodeIds.has(laneId)) {
        errors.push({
          path,
          code: "bad_reference",
          message: `lane "${laneId}" is not a declared node`,
          suggestion: mkSuggestion(closest(laneId, [...nodeIds], 3)),
        });
        return;
      }
      const node = d.nodes[laneId]!;
      if (!node.children || node.children.length === 0) {
        errors.push({
          path,
          code: "wrong_type",
          message: `lane "${laneId}" must be a container (have children:); got a leaf node`,
        });
        return;
      }
      if (childToParent.has(laneId)) {
        errors.push({
          path,
          code: "wrong_type",
          message: `lane "${laneId}" must be top-level; it appears as a child of "${childToParent.get(laneId)}"`,
        });
      }
    });
  }

  // 2. children references resolve, no node has multiple parents, no self-children
  const parentOf = new Map<string, string>();
  for (const [parentId, node] of Object.entries(d.nodes)) {
    if (!node.children) continue;
    const seen = new Set<string>();
    node.children.forEach((childId, idx) => {
      const path = `nodes.${parentId}.children[${idx}]`;
      if (seen.has(childId)) {
        errors.push({
          path,
          code: "duplicate_id",
          message: `child "${childId}" listed twice under "${parentId}"`,
        });
        return;
      }
      seen.add(childId);
      if (!nodeIds.has(childId)) {
        errors.push({
          path,
          code: "bad_reference",
          message: `child "${childId}" referenced under "${parentId}" is not declared in nodes`,
        });
        return;
      }
      if (childId === parentId) {
        errors.push({
          path,
          code: "cycle",
          message: `node "${parentId}" cannot be its own child`,
        });
        return;
      }
      const existing = parentOf.get(childId);
      if (existing && existing !== parentId) {
        errors.push({
          path,
          code: "duplicate_id",
          message: `node "${childId}" appears as a child of both "${existing}" and "${parentId}"; nodes can have only one parent`,
        });
        return;
      }
      parentOf.set(childId, parentId);
    });
  }

  // 3. Cycle in parent chain. parentOf is a function (single-parent enforced above),
  //    but multi-node cycles A→B→C→A are still possible. One walk per unvisited node
  //    with a global visited set keeps this O(n) total.
  const visited = new Set<string>();
  const reportedCycle = new Set<string>();
  for (const start of nodeIds) {
    if (visited.has(start)) continue;
    const walk: string[] = [];
    const onPath = new Set<string>();
    let current: string | undefined = start;
    while (current) {
      if (visited.has(current)) break;
      if (onPath.has(current)) {
        if (!reportedCycle.has(current)) {
          errors.push({
            path: `nodes.${current}.children`,
            code: "cycle",
            message: `cycle detected in parent/child chain through "${current}"`,
          });
          for (const n of walk) reportedCycle.add(n);
        }
        break;
      }
      onPath.add(current);
      walk.push(current);
      current = parentOf.get(current);
    }
    for (const n of walk) visited.add(n);
  }

  // 4. node label/labels mutual exclusion + per-node `at`
  for (const [nodeId, node] of Object.entries(d.nodes)) {
    if (node.label !== undefined && node.labels !== undefined) {
      errors.push({
        path: `nodes.${nodeId}`,
        code: "unknown_field",
        message: `node "${nodeId}" cannot set both "label" and "labels" — use one or the other`,
      });
    }
    if (node.labels) {
      node.labels.forEach((lbl, i) => {
        if (lbl.at === undefined) return;
        if (!NODE_AT_VALUES.includes(lbl.at as (typeof NODE_AT_VALUES)[number])) {
          const opts = NODE_AT_VALUES.map((v) => JSON.stringify(v)).join(", ");
          errors.push({
            path: `nodes.${nodeId}.labels[${i}].at`,
            code: "unknown_value",
            message: `value ${JSON.stringify(lbl.at)} at "nodes.${nodeId}.labels[${i}].at" is not a valid node label position; expected one of ${opts}`,
            suggestion: mkSuggestion(closest(lbl.at, NODE_AT_VALUES, 3)),
          });
        }
      });
    }
  }

  // 5. edge references resolve (from/to may be string or string[]) +
  //    label/labels mutual exclusion + per-edge `at`
  if (d.edges) {
    d.edges.forEach((edge, idx) => {
      const fromArr = Array.isArray(edge.from) ? edge.from : [edge.from];
      const toArr = Array.isArray(edge.to) ? edge.to : [edge.to];
      fromArr.forEach((from, j) => {
        if (!nodeIds.has(from)) {
          errors.push({
            path: Array.isArray(edge.from) ? `edges[${idx}].from[${j}]` : `edges[${idx}].from`,
            code: "bad_reference",
            message: `edge.from "${from}" is not a declared node`,
          });
        }
      });
      toArr.forEach((to, j) => {
        if (!nodeIds.has(to)) {
          errors.push({
            path: Array.isArray(edge.to) ? `edges[${idx}].to[${j}]` : `edges[${idx}].to`,
            code: "bad_reference",
            message: `edge.to "${to}" is not a declared node`,
          });
        }
      });
      if (edge.label !== undefined && edge.labels !== undefined) {
        errors.push({
          path: `edges[${idx}]`,
          code: "unknown_field",
          message: `edge[${idx}] cannot set both "label" and "labels" — use one or the other`,
        });
      }
      if (edge.labels) {
        edge.labels.forEach((lbl, i) => {
          if (lbl.at === undefined) return;
          if (!EDGE_AT_VALUES.includes(lbl.at as (typeof EDGE_AT_VALUES)[number])) {
            const opts = EDGE_AT_VALUES.map((v) => JSON.stringify(v)).join(", ");
            errors.push({
              path: `edges[${idx}].labels[${i}].at`,
              code: "unknown_value",
              message: `value ${JSON.stringify(lbl.at)} at "edges[${idx}].labels[${i}].at" is not a valid edge label position; expected one of ${opts}`,
              suggestion: mkSuggestion(closest(lbl.at, EDGE_AT_VALUES, 3)),
            });
          }
        });
      }
    });
  }

  return errors;
}
