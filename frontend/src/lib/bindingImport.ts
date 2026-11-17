import type {
  Binding,
  BindingKind,
  Diagram,
  SchemeBindings,
  SchemeComponent,
} from "../types";
import type { BindingTarget, ImportedItem } from "./diagramOps";
import { bindables } from "./bindingOverview";


/** How an item's bindings in the file compare with the scheme's: new (the file has none of the provider), conflict
 * (both have, differently), removed (the file has, the scheme has no component for it). Identical items are not
 * rows. Applying takes the scheme's side of every row. */
export type ImportStatus = "new" | "conflict" | "removed";

/** One side of an item: its bindings of the provider, precision and features. */
export interface ImportSide {
  bindings: Binding[];
  precision?: number;
  features?: string;
  /** The component type (the file's own, absent: by shape). */
  componentType?: string;
}

/** The component type of an item of shape that has none of its own, from the provider's component types. */
export type TypeOfShape = (shape: string) => string | undefined;

/** Reports whether precision, features or (for a component with bindings) the component type differ; an item without
 * its own type has its shape's. */
function displayDiffers(own: ImportSide, shape: string, theirs: ImportSide, typeOf: TypeOfShape): boolean {
  return (
    (own.precision ?? 0) !== (theirs.precision ?? 0) ||
    featureKey(own.features) !== featureKey(theirs.features) ||
    (theirs.bindings.length > 0 &&
      (own.componentType || typeOf(shape) || "") !== (theirs.componentType || ""))
  );
}

export interface ImportRow {
  target: BindingTarget;
  status: ImportStatus;
  file: ImportSide;
  /** The scheme's side; null when it has no component for the item. */
  scheme: ImportSide | null;
  /** The component's shape, when it differs from the item's. */
  shapeDiffers?: string;
  /** The kinds whose binding differs. */
  kinds: BindingKind[];
  /** Precision or features differ. */
  display: boolean;
}

export interface ImportPlan {
  rows: ImportRow[];
  /** Items whose bindings are identical on both sides. */
  same: number;
  /** Components with no item of their id. */
  notInDiagram: SchemeComponent[];
  object: { status: ImportStatus | "same"; file?: Binding; scheme?: Binding };
}

export const rowKey = (t: BindingTarget) => `${t.kind}-${t.id}`;

function bindingKey(
  b: Binding,
  defaultOption: (k: BindingKind) => string | undefined,
): string {
  return [b.ref, b.option || defaultOption(b.kind) || "", b.scale || 1].join(
    "|",
  );
}

export function featureKey(f: string | undefined): string {
  return (f ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(",");
}

/** Compares the provider's bindings of diagram's items (elements, digital devices, text labels, wires) with the
 * scheme's components, matched by id. Options left empty count as the kind's default (defaultOption), a scale of 0 as 1; cached names don't count. */
export function importPlan(
  diagram: Diagram,
  scheme: SchemeBindings,
  provider: string,
  defaultOption: (k: BindingKind) => string | undefined,
  typeOf: TypeOfShape,
): ImportPlan {
  const items = new Map<
    number,
    { target: BindingTarget; shape: string; side: ImportSide }
  >();
  for (const b of bindables(diagram)) {
    items.set(b.target.id, {
      target: b.target,
      shape: b.shape,
      side: {
        bindings: (b.bindings ?? []).filter((x) => x.source === provider),
        precision: b.precision,
        features: b.features,
        componentType: b.componentType,
      },
    });
  }

  const plan: ImportPlan = {
    rows: [],
    same: 0,
    notInDiagram: [],
    object: { status: "same" },
  };
  const seen = new Set<number>();
  for (const c of scheme.components) {
    const item = items.get(c.item);
    if (!item) {
      plan.notInDiagram.push(c);
      continue;
    }
    seen.add(c.item);
    const theirs: ImportSide = {
      bindings: c.bindings,
      precision: c.precision,
      features: c.features,
      componentType: c.type,
    };
    const kinds = differingKinds(
      item.side.bindings,
      theirs.bindings,
      defaultOption,
    );
    const display = displayDiffers(item.side, item.shape, theirs, typeOf);
    if (kinds.length === 0 && !display) {
      plan.same++;
      continue;
    }
    plan.rows.push({
      target: item.target,
      status: item.side.bindings.length === 0 ? "new" : "conflict",
      file: item.side,
      scheme: theirs,
      shapeDiffers:
        c.shape && item.shape && c.shape !== item.shape ? c.shape : undefined,
      kinds,
      display,
    });
  }
  for (const [id, item] of items) {
    if (seen.has(id) || item.side.bindings.length === 0) continue;
    plan.rows.push({
      target: item.target,
      status: "removed",
      file: item.side,
      scheme: null,
      kinds: item.side.bindings.map((b) => b.kind),
      display: false,
    });
  }
  plan.rows.sort((a, b) => a.target.id - b.target.id);

  const file = diagram.object?.source === provider ? diagram.object : undefined;
  const theirs = scheme.object;
  if (file && theirs) {
    plan.object = {
      status:
        bindingKey(file, defaultOption) === bindingKey(theirs, defaultOption)
          ? "same"
          : "conflict",
      file,
      scheme: theirs,
    };
  } else if (theirs) {
    plan.object = { status: "new", scheme: theirs };
  } else if (file) {
    plan.object = { status: "removed", file };
  }
  return plan;
}

export function differingKinds(
  mine: Binding[],
  theirs: Binding[],
  defaultOption: (k: BindingKind) => string | undefined,
): BindingKind[] {
  const kinds = new Set<BindingKind>([
    ...mine.map((b) => b.kind),
    ...theirs.map((b) => b.kind),
  ]);
  const key = (bs: Binding[], k: BindingKind) => {
    const b = bs.find((x) => x.kind === k);
    return b ? bindingKey(b, defaultOption) : "";
  };
  return [...kinds].filter((k) => key(mine, k) !== key(theirs, k));
}

/** The items to change: every row takes the scheme's side; a removed row loses the provider's bindings. */
export function importedItems(plan: ImportPlan): ImportedItem[] {
  return plan.rows.map((r) => ({
    target: r.target,
    bindings: r.scheme?.bindings ?? [],
    precision: r.scheme?.precision,
    features: r.scheme?.features,
    componentType: r.scheme?.componentType,
  }));
}

/** The diagram object to set: the scheme's, null to remove the file's when the scheme has none, undefined to keep. */
export function importedObject(plan: ImportPlan): Binding | null | undefined {
  return plan.object.status === "same" ? undefined : (plan.object.scheme ?? null);
}

/** How an item's own side compares with what the scheme holds for its id (status null: identical, or nothing on
 * either side). */
export function compareItem(
  own: ImportSide,
  shape: string,
  component: SchemeComponent | undefined,
  defaultOption: (k: BindingKind) => string | undefined,
  typeOf: TypeOfShape,
): { status: ImportStatus | null; kinds: BindingKind[]; display: boolean } {
  if (!component) {
    return own.bindings.length
      ? { status: "removed", kinds: own.bindings.map((b) => b.kind), display: false }
      : { status: null, kinds: [], display: false };
  }
  const kinds = differingKinds(own.bindings, component.bindings, defaultOption);
  const display = displayDiffers(
    own,
    shape,
    { bindings: component.bindings, precision: component.precision, features: component.features, componentType: component.type },
    typeOf,
  );
  if (!kinds.length && !display) return { status: null, kinds, display };
  return { status: own.bindings.length ? "conflict" : "new", kinds, display };
}
