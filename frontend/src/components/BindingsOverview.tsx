import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ArrowDown, ArrowUp, Download, Search, X } from "lucide-react";
import { t, type TranslationKey } from "../i18n";
import * as diagramOps from "../lib/diagramOps";
import {
  BINDING_KINDS,
  isUnbound,
  overviewCsv,
  overviewRows,
  overviewTypeNames,
  type GapKind,
  type OverviewRow,
} from "../lib/bindingOverview";
import { useBindingDictionaries } from "../lib/bindingDictionaries";
import { downloadText } from "../lib/fileTransfer";
import {
  useDiagramContext,
  type SelectionKind,
} from "../state/useDiagramContext";
import { BindingImportView } from "./BindingImportView";
import { GuideButton } from "./GuideButton";
import type { BindingKind } from "../types";

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;
const HEIGHT_KEY = "sld-editor.overviewHeight";
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

type SortKey = "id" | "name" | "type" | BindingKind;

function storedHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    return n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function cellText(r: OverviewRow, key: SortKey): string {
  if (key === "id") return String(r.id);
  if (key === "name") return r.name;
  if (key === "type") return r.typeName;
  const b = r.bindings[key];
  return b ? b.name || b.ref : "";
}

/** The bindings overview docked under the canvas: every element expected to be bound and every digital device, with
 * the bound object's name per kind. Sorting, a text filter and an "unbound only" filter by gap; a click selects the
 * item and centres the canvas on it, Ctrl/Cmd-click adds it to the selection. highlight / onHighlight is the canvas's
 * unbound marking (null = off); gap is the kind the filter and the marking look at. */
export function BindingsOverview({
  gap,
  onGap,
  highlight,
  onHighlight,
  onClose,
}: {
  gap: GapKind;
  onGap: (gap: GapKind) => void;
  highlight: boolean;
  onHighlight: (on: boolean) => void;
  onClose: () => void;
}) {
  const {
    diagram,
    diagramName,
    elements,
    selection,
    selectMany,
    toggleSelection,
    focusItem,
    updateDiagram,
    bindingImport,
  } = useDiagramContext();
  const { dict } = useBindingDictionaries(true);
  const [height, setHeight] = useState(storedHeight);
  const [query, setQuery] = useState("");
  const [unboundOnly, setUnboundOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "id",
    desc: false,
  });
  const [resetKinds, setResetKinds] = useState<Set<BindingKind>>(
    () => new Set(),
  );
  const resizing = useRef<{ y: number; height: number } | null>(null);

  const kinds = BINDING_KINDS.filter(
    (k) => !dict || dict.kinds.some((i) => i.kind === k),
  );
  const all = useMemo(
    () =>
      diagram
        ? overviewRows(diagram, elements, overviewTypeNames())
        : [],
    [diagram, elements],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = all.filter(
      (r) =>
        (!unboundOnly || isUnbound(r.bindings, gap)) &&
        (!q ||
          [
            String(r.id),
            r.name,
            r.typeName,
            ...Object.values(r.bindings).map((b) => b?.name ?? ""),
          ].some((s) => s.toLowerCase().includes(q))),
    );
    const dir = sort.desc ? -1 : 1;
    return shown.sort((a, b) =>
      sort.key === "id"
        ? (a.id - b.id) * dir
        : cellText(a, sort.key).localeCompare(
            cellText(b, sort.key),
            undefined,
            { numeric: true },
          ) * dir || a.id - b.id,
    );
  }, [all, query, unboundOnly, gap, sort]);
  const unboundCount = useMemo(
    () => all.filter((r) => isUnbound(r.bindings, gap)).length,
    [all, gap],
  );
  const selected = all.filter((r) => selection.get(r.id) === r.kind);

  function click(e: ReactMouseEvent, r: OverviewRow) {
    if (IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey) {
      toggleSelection(r.id, r.kind);
      return;
    }
    selectMany(new Map<number, SelectionKind>([[r.id, r.kind]]));
    focusItem(r.id, r.kind);
  }

  function resetSelected() {
    const targets = selected.map((r) => ({ kind: r.kind, id: r.id }));
    updateDiagram((d) =>
      diagramOps.removeBindingKinds(d, targets, [...resetKinds]),
    );
  }

  function exportCsv() {
    const header = [
      t("overview.id"),
      t("overview.name"),
      t("overview.type"),
      ...kinds.map((k) => t(`bindings.kind.${k}` as TranslationKey)),
    ];
    downloadText(
      `${(diagramName || "diagram").split("/").pop()}-bindings.csv`,
      overviewCsv(rows, kinds, header),
      "text/csv;charset=utf-8",
    );
  }

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    resizing.current = { y: e.clientY, height };
    const move = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const max = window.innerHeight - 160;
      setHeight(
        Math.min(
          max,
          Math.max(
            MIN_HEIGHT,
            resizing.current.height + resizing.current.y - ev.clientY,
          ),
        ),
      );
    };
    const up = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setHeight((h) => {
        try {
          localStorage.setItem(HEIGHT_KEY, String(h));
        } catch {
          // per-viewer convenience only
        }
        return h;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  if (!diagram) return null;

  const header = (key: SortKey, label: string) => (
    <th
      key={key}
      className="sticky top-0 bg-surface-700 px-2 py-1 text-left font-medium text-gray-300 whitespace-nowrap"
    >
      <button
        type="button"
        className="inline-flex items-center gap-0.5 hover:text-white"
        onClick={() =>
          setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }))
        }
      >
        {label}
        {sort.key === key &&
          (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );

  return (
    <section
      aria-label={t("overview.title")}
      className="relative shrink-0 flex flex-col border-t border-surface-600 bg-surface-800 text-xs text-gray-200"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        title={t("overview.resize")}
        onMouseDown={startResize}
        className="absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-10"
      />
      {bindingImport ? (
        <BindingImportView
          key={bindingImport.scheme.ref}
          scheme={bindingImport}
          onClose={onClose}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 border-b border-surface-600">
            <span className="font-medium text-gray-100">
              {t("overview.title")}
            </span>
            <GuideButton topic="bindings-overview" />
            <span className="text-gray-400">
              {t("overview.counts", {
                total: all.length,
                unbound: unboundCount,
              })}
            </span>
            <div className="relative">
              <Search
                size={12}
                className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("overview.filter")}
                aria-label={t("overview.filter")}
                className="w-44 bg-surface-900 border border-surface-600 rounded pl-6 pr-1.5 py-0.5"
              />
            </div>
            <label className="flex items-center gap-1">
              <span className="text-gray-400">{t("overview.gap")}</span>
              <select
                value={gap}
                onChange={(e) => onGap(e.target.value as GapKind)}
                className="bg-surface-900 border border-surface-600 rounded px-1 py-0.5"
              >
                <option value="any">{t("overview.gapAny")}</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`bindings.kind.${k}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={unboundOnly}
                onChange={(e) => setUnboundOnly(e.target.checked)}
              />
              {t("overview.unboundOnly")}
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={highlight}
                onChange={(e) => onHighlight(e.target.checked)}
              />
              {t("overview.highlight")}
            </label>
            <div className="flex items-center gap-1.5 border-l border-surface-600 pl-3">
              <span className="text-gray-400">{t("overview.reset")}</span>
              {kinds.map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-0.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={resetKinds.has(k)}
                    onChange={(e) =>
                      setResetKinds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(k);
                        else next.delete(k);
                        return next;
                      })
                    }
                  />
                  {t(`bindings.kind.${k}` as TranslationKey)}
                </label>
              ))}
              <button
                type="button"
                onClick={resetSelected}
                disabled={selected.length === 0 || resetKinds.size === 0}
                className="rounded border border-surface-500 px-2 py-0.5 hover:bg-surface-600 disabled:opacity-40"
              >
                {t("overview.resetSelected", { count: selected.length })}
              </button>
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="flex items-center gap-1 rounded border border-surface-500 px-2 py-0.5 hover:bg-surface-600 disabled:opacity-40"
            >
              <Download size={12} />
              {t("overview.csv")}
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
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {header("id", t("overview.id"))}
                  {header("name", t("overview.name"))}
                  {header("type", t("overview.type"))}
                  {kinds.map((k) =>
                    header(k, t(`bindings.kind.${k}` as TranslationKey)),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = selection.get(r.id) === r.kind;
                  return (
                    <tr
                      key={`${r.kind}-${r.id}`}
                      onClick={(e) => click(e, r)}
                      aria-selected={isSelected}
                      className={`cursor-pointer border-t border-surface-700 ${isSelected ? "bg-accent/30" : "hover:bg-surface-700"}`}
                    >
                      <td className="px-2 py-0.5 text-gray-400 tabular-nums">
                        {r.id}
                      </td>
                      <td
                        className="px-2 py-0.5 max-w-48 truncate"
                        title={r.name}
                      >
                        {r.name}
                      </td>
                      <td
                        className="px-2 py-0.5 max-w-48 truncate text-gray-400"
                        title={r.typeName}
                      >
                        {r.typeName}
                      </td>
                      {kinds.map((k) => {
                        const b = r.bindings[k];
                        return (
                          <td
                            key={k}
                            className="px-2 py-0.5 max-w-56 truncate"
                            title={b ? `${b.name ?? ""} (${b.ref})` : undefined}
                          >
                            {b ? (
                              b.name || b.ref
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-2 py-3 text-gray-500">{t("overview.empty")}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
