import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { AlertTriangle, X } from "lucide-react";
import { t, type TranslationKey } from "../i18n";
import * as diagramOps from "../lib/diagramOps";
import { BINDING_KINDS, bindables, overviewTypeNames, typeName } from "../lib/bindingOverview";
import { componentTypeName, typeOfShape, useBindingDictionaries } from "../lib/bindingDictionaries";
import {
  importPlan,
  importedItems,
  importedObject,
  rowKey,
  type ImportRow,
  type ImportSide,
  type ImportStatus,
} from "../lib/bindingImport";
import {
  useDiagramContext,
  type SelectionKind,
} from "../state/useDiagramContext";
import { GuideButton } from "./GuideButton";
import type {
  Binding,
  BindingKind,
  ExportIssue,
  SchemeBindings,
  BindingDictionaries,
} from "../types";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

function bindingText(b: Binding | undefined, detail: boolean): string {
  if (!b) return "—";
  let s = b.name || b.ref;
  if (detail) {
    if (b.option) s += ` · ${b.option}`;
    if (b.scale && b.scale !== 1) s += ` · ×${b.scale}`;
  }
  return s;
}

function displayText(side: ImportSide | null, dict: BindingDictionaries | null): string {
  if (!side) return "—";
  const type = componentTypeName(dict, side.componentType);
  return `${type ? `${type} · ` : ""}${side.precision ?? 0} · ${side.features || "—"}`;
}

function issueText(i: ExportIssue): string {
  const item = i.item ? t("exportCheck.element", { id: i.item }) : "";
  return t(`exportCheck.issue.${i.code}` as TranslationKey, {
    item,
    shape: "",
    detail: i.detail ?? "",
    schemes: "",
  });
}

/** The bindings overview while an import is in progress: the items whose bindings in the file differ from the linked
 * scheme's, each kind showing the file's binding over the scheme's. Apply makes the provider's bindings those of the
 * scheme as one undoable edit. */
export function BindingImportView({
  scheme,
  onClose,
}: {
  scheme: SchemeBindings;
  onClose: () => void;
}) {
  const {
    diagram,
    elements,
    config,
    selection,
    selectMany,
    toggleSelection,
    focusItem,
    updateDiagram,
    setBindingImport,
  } = useDiagramContext();
  const provider = config?.bindings?.provider ?? "";
  const { dict } = useBindingDictionaries(true);
  const [details, setDetails] = useState(false);

  const plan = useMemo(
    () =>
      diagram
        ? importPlan(
            diagram,
            scheme,
            provider,
            (k) => dict?.kinds.find((i) => i.kind === k)?.defaultOption,
            typeOfShape(dict),
          )
        : null,
    [diagram, scheme, provider, dict],
  );
  const names = useMemo(() => {
    const bySymbol = new Map(elements.map((s) => [s.shape, s]));
    const typeNames = overviewTypeNames();
    const m = new Map<string, { name: string; type: string }>();
    if (diagram) {
      for (const b of bindables(diagram)) {
        m.set(rowKey(b.target), { name: b.name, type: typeName(b, bySymbol, typeNames) });
      }
    }
    return m;
  }, [diagram, elements]);

  if (!diagram || !plan) return null;
  const kinds = BINDING_KINDS.filter(
    (k) => !dict || dict.kinds.some((i) => i.kind === k),
  );
  const objectRow = plan.object.status !== "same";
  const counts = { new: 0, conflict: 0, removed: 0 } as Record<
    ImportStatus,
    number
  >;
  for (const r of plan.rows) counts[r.status]++;
  const changes = plan.rows.length + (objectRow ? 1 : 0);

  function apply() {
    const items = importedItems(plan!);
    const object = importedObject(plan!);
    updateDiagram(
      (d) => diagramOps.applyImportedBindings(d, provider, items, object),
      { untracked: true },
    );
    setBindingImport(null);
  }
  function click(e: ReactMouseEvent, r: ImportRow) {
    const kind: SelectionKind = r.target.kind;
    if (IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey) {
      toggleSelection(r.target.id, kind);
      return;
    }
    selectMany(new Map<number, SelectionKind>([[r.target.id, kind]]));
    focusItem(r.target.id, kind);
  }

  const twoSides = (_file: string, theirs: string, changed: boolean) => (
    <div className={changed ? "text-amber-200" : "text-gray-400"}>
      <div className="truncate" title={theirs}>
        <span className="text-gray-500">{t("bindingImport.scheme")} </span>
        {theirs}
      </div>
    </div>
  );
  const th =
    "sticky top-0 bg-surface-700 px-2 py-1 text-left font-medium text-gray-300 whitespace-nowrap";

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 border-b border-surface-600">
        <span className="font-medium text-gray-100">
          {t("bindingImport.title", {
            name: scheme.scheme.name || scheme.scheme.ref,
            ref: scheme.scheme.ref,
          })}
        </span>
        <GuideButton topic="bindings-import" />
        <span className="text-gray-400">
          {t("bindingImport.summary", {
            new: counts.new,
            conflict: counts.conflict,
            removed: counts.removed,
            same: plan.same,
          })}
        </span>
        {(plan.notInDiagram.length > 0 || scheme.issues.length > 0) && (
          <button
            type="button"
            onClick={() => setDetails((v) => !v)}
            className="text-amber-300 hover:underline"
          >
            {t("bindingImport.details", {
              missing: plan.notInDiagram.length,
              skipped: scheme.issues.length,
            })}
          </button>
        )}
        <button
          type="button"
          onClick={apply}
          disabled={changes === 0}
          className="rounded bg-accent px-3 py-0.5 text-white hover:opacity-90 disabled:opacity-40"
        >
          {t("bindingImport.apply", { count: changes })}
        </button>
        <button
          type="button"
          onClick={() => setBindingImport(null)}
          className="px-2 py-0.5 text-gray-300 hover:text-white"
        >
          {t("bindingImport.cancel")}
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
          className="ml-auto text-gray-400 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
      {details && (
        <div className="max-h-28 overflow-auto border-b border-surface-600 px-2 py-1 text-gray-300">
          {plan.notInDiagram.length > 0 && (
            <p>
              {t("bindingImport.notInDiagram", {
                count: plan.notInDiagram.length,
              })}{" "}
              <span className="text-gray-400">
                {plan.notInDiagram.map((c) => c.item).join(", ")}
              </span>
            </p>
          )}
          {scheme.issues.map((i, n) => (
            <p key={n} className="text-amber-200">
              {issueText(i)}
            </p>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t("overview.id")}</th>
              <th className={th}>{t("overview.name")}</th>
              <th className={th}>{t("overview.type")}</th>
              <th className={th}>{t("bindingImport.status")}</th>
              {kinds.map((k) => (
                <th key={k} className={th}>
                  {t(`bindings.kind.${k}` as TranslationKey)}
                </th>
              ))}
              <th className={th}>{t("bindingImport.display")}</th>
            </tr>
          </thead>
          <tbody>
            {objectRow && (
              <tr className="border-t border-surface-700">
                <td className="px-2 py-0.5 text-gray-400">—</td>
                <td className="px-2 py-0.5" colSpan={2}>
                  {t("bindingImport.object")}
                </td>
                <td className="px-2 py-0.5">
                  {t(
                    `bindingImport.statusName.${plan.object.status}` as TranslationKey,
                  )}
                </td>
                <td className="px-2 py-0.5 max-w-56" colSpan={kinds.length + 1}>
                  {twoSides(
                    bindingText(plan.object.file, true),
                    bindingText(plan.object.scheme, true),
                    true,
                  )}
                </td>
              </tr>
            )}
            {plan.rows.map((r) => {
              const key = rowKey(r.target);
              const n = names.get(key);
              const isSelected = selection.get(r.target.id) === r.target.kind;
              const byKind = (side: ImportSide | null, k: BindingKind) =>
                side?.bindings.find((b) => b.kind === k);
              return (
                <tr
                  key={key}
                  onClick={(e) => click(e, r)}
                  aria-selected={isSelected}
                  className={`cursor-pointer border-t border-surface-700 align-top ${isSelected ? "bg-accent/30" : "hover:bg-surface-700"}`}
                >
                  <td className="px-2 py-0.5 text-gray-400 tabular-nums">
                    {r.target.id}
                  </td>
                  <td className="px-2 py-0.5 max-w-40 truncate" title={n?.name}>
                    {n?.name}
                  </td>
                  <td className="px-2 py-0.5 max-w-40 text-gray-400">
                    <div className="truncate" title={n?.type}>
                      {n?.type}
                    </div>
                    {r.shapeDiffers && (
                      <div
                        className="flex items-center gap-1 text-amber-300"
                        title={t("bindingImport.shapeDiffers", {
                          shape: r.shapeDiffers,
                        })}
                      >
                        <AlertTriangle size={11} />
                        {t("bindingImport.shapeDiffers", {
                          shape: r.shapeDiffers,
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-0.5 whitespace-nowrap">
                    {t(
                      `bindingImport.statusName.${r.status}` as TranslationKey,
                    )}
                  </td>
                  {kinds.map((k) => {
                    const changed = r.kinds.includes(k);
                    return (
                      <td key={k} className="px-2 py-0.5 max-w-56">
                        {changed || byKind(r.file, k) ? (
                          twoSides(
                            bindingText(byKind(r.file, k), changed),
                            bindingText(byKind(r.scheme, k), changed),
                            changed,
                          )
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-0.5 max-w-40">
                    {r.display ? (
                      twoSides(displayText(r.file, dict), displayText(r.scheme, dict), true)
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {plan.rows.length === 0 && !objectRow && (
          <p className="px-2 py-3 text-gray-500">
            {t("bindingImport.nothing")}
          </p>
        )}
      </div>
    </>
  );
}
