import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  ListTree,
  Search,
  Table,
  X,
} from "lucide-react";
import { t, type TranslationKey } from "../i18n";
import * as api from "../lib/api";
import * as diagramOps from "../lib/diagramOps";
import {
  BINDING_KINDS,
  isUnbound,
  nodeKeys,
  nodeRows,
  overviewCsv,
  overviewRows,
  overviewTree,
  overviewTypeNames,
  type GapKind,
  type OverviewNode,
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
import type { BindingKind, DesignationPlan, Diagram } from "../types";

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;
const HEIGHT_KEY = "sld-editor.overviewHeight";
const VIEW_KEY = "sld-editor.overviewView";
const INDENT = 14;
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

type SortKey = "id" | "name" | "type" | BindingKind;
type View = "table" | "tree";

function storedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "tree" ? "tree" : "table";
  } catch {
    return "table";
  }
}

function storedHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    return n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

/** The designation plan of diagram (the hierarchy worked out from its topology) while enabled: one request at a
 * time, never cancelled; a diagram edited meanwhile is planned once the request ends. */
function useDesignationPlan(
  diagram: Diagram | null,
  enabled: boolean,
): { plan: DesignationPlan | null; error: string | null } {
  const [plan, setPlan] = useState<DesignationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ diagram, enabled });
  const busy = useRef(false);

  useEffect(() => {
    latest.current = { diagram, enabled };
    if (busy.current) return;
    const run = () => {
      const { diagram: d, enabled: on } = latest.current;
      if (!d || !on) return;
      busy.current = true;
      api
        .planDesignations(d, [], false, d.editor?.designationFormat ?? "full")
        .then(
          (p) => {
            setPlan(p);
            setError(null);
          },
          (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
        )
        .finally(() => {
          busy.current = false;
          if (latest.current.diagram !== d) run();
        });
    };
    run();
  }, [diagram, enabled]);

  useEffect(
    () => () => {
      latest.current = { diagram: null, enabled: false };
    },
    [],
  );

  return { plan, error };
}

function cellText(r: OverviewRow, key: SortKey): string {
  if (key === "id") return String(r.id);
  if (key === "name") return r.name;
  if (key === "type") return r.typeName;
  const b = r.bindings[key];
  return b ? b.name || b.ref : "";
}

/** The bindings overview docked under the canvas: every element expected to be bound and every digital device, with
 * the bound object's name per kind when bindingsOn, as a table or as a tree of the designation hierarchy. Sorting, a
 * text filter and an "unbound only" filter by gap; a click selects the item (a tree node: every item below it) and
 * centres the canvas on it, Ctrl/Cmd-click adds it to the selection. highlight / onHighlight is the canvas's unbound
 * marking; gap is the kind the filter and the marking look at. */
export function BindingsOverview({
  bindingsOn,
  gap,
  onGap,
  highlight,
  onHighlight,
  onClose,
}: {
  bindingsOn: boolean;
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
  const { dict } = useBindingDictionaries(bindingsOn);
  const [height, setHeight] = useState(storedHeight);
  const [view, setView] = useState<View>(storedView);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
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

  const kinds = bindingsOn
    ? BINDING_KINDS.filter((k) => !dict || dict.kinds.some((i) => i.kind === k))
    : [];
  const all = useMemo(
    () => (diagram ? overviewRows(diagram, elements, overviewTypeNames()) : []),
    [diagram, elements],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = all.filter(
      (r) =>
        (!bindingsOn || !unboundOnly || isUnbound(r.bindings, gap)) &&
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
  }, [all, query, bindingsOn, unboundOnly, gap, sort]);
  const designation = useDesignationPlan(diagram, view === "tree");
  const voltageNames = useMemo(
    () => new Map((diagram?.voltageClasses ?? []).map((v) => [v.id, v.name])),
    [diagram?.voltageClasses],
  );
  const tree = useMemo(
    () =>
      view === "tree" && designation.plan
        ? overviewTree(designation.plan, rows)
        : [],
    [view, designation.plan, rows],
  );
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

  function clickNode(e: ReactMouseEvent, n: OverviewNode) {
    const items = nodeRows(n).map((r): [number, SelectionKind] => [
      r.id,
      r.kind,
    ]);
    if (IS_MAC ? e.metaKey : e.ctrlKey || e.metaKey) {
      selectMany(new Map([...selection, ...items]));
      return;
    }
    selectMany(new Map(items));
  }

  function toggleNode(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function chooseView(v: View) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // per-viewer convenience only
    }
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

  const columns = 3 + kinds.length;

  const row = (r: OverviewRow, depth: number) => {
    const isSelected = selection.get(r.id) === r.kind;
    return (
      <tr
        key={`${r.kind}-${r.id}`}
        onClick={(e) => click(e, r)}
        aria-selected={isSelected}
        className={`cursor-pointer border-t border-surface-700 ${isSelected ? "bg-accent/30" : "hover:bg-surface-700"}`}
      >
        <td
          className="px-2 py-0.5 text-gray-400 tabular-nums"
          style={depth ? { paddingLeft: 8 + depth * INDENT + 16 } : undefined}
        >
          {r.id}
        </td>
        <td className="px-2 py-0.5 max-w-48 truncate" title={r.name}>
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
              {b ? b.name || b.ref : <span className="text-gray-600">—</span>}
            </td>
          );
        })}
      </tr>
    );
  };

  const node = (n: OverviewNode, depth: number): ReactNode[] => {
    const open = !collapsed.has(n.key);
    const below = nodeRows(n);
    const allSelected = below.every((r) => selection.get(r.id) === r.kind);
    return [
      <tr
        key={n.key}
        onClick={(e) => clickNode(e, n)}
        aria-selected={allSelected}
        aria-expanded={open}
        className={`cursor-pointer border-t border-surface-700 ${allSelected ? "bg-accent/30" : "hover:bg-surface-700"}`}
      >
        <td
          colSpan={columns}
          className="px-2 py-0.5 whitespace-nowrap"
          style={{ paddingLeft: 8 + depth * INDENT }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(n.key);
            }}
            aria-label={open ? t("overview.collapse") : t("overview.expand")}
            className="inline-flex align-middle mr-1 text-gray-400 hover:text-white"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {n.fn ? (
            <span className={n.fn.id < 0 ? "italic" : undefined}>
              <span className="font-mono text-gray-100">{n.segment}</span>{" "}
              <span className="text-gray-400">
                {t(`designations.kind.${n.fn.kind}` as TranslationKey)}
                {n.fn.kind === "voltageLevel" &&
                  voltageNames.get(n.fn.voltage ?? 0) &&
                  `, ${voltageNames.get(n.fn.voltage ?? 0)}`}
              </span>
            </span>
          ) : (
            <span className="text-gray-400">{t("overview.noFunction")}</span>
          )}
          <span className="text-gray-500"> ({below.length})</span>
        </td>
      </tr>,
      ...(open
        ? [
            ...n.children.flatMap((c) => node(c, depth + 1)),
            ...n.rows.map((r) => row(r, depth + 1)),
          ]
        : []),
    ];
  };

  const viewButton = (v: View, label: string, Icon: typeof Table) => (
    <button
      type="button"
      onClick={() => chooseView(v)}
      title={label}
      aria-label={label}
      aria-pressed={view === v}
      className={`flex items-center px-1.5 py-0.5 ${view === v ? "bg-accent text-white" : "hover:bg-surface-600"}`}
    >
      <Icon size={12} />
    </button>
  );

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
      {bindingsOn && bindingImport ? (
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
              {bindingsOn
                ? t("overview.counts", {
                    total: all.length,
                    unbound: unboundCount,
                  })
                : t("overview.total", { total: all.length })}
            </span>
            <div className="flex rounded border border-surface-500 overflow-hidden">
              {viewButton("table", t("overview.viewTable"), Table)}
              {viewButton("tree", t("overview.viewTree"), ListTree)}
            </div>
            {view === "tree" && (
              <>
                <button
                  type="button"
                  onClick={() => setCollapsed(new Set())}
                  title={t("overview.expandAll")}
                  aria-label={t("overview.expandAll")}
                  className="text-gray-400 hover:text-white"
                >
                  <ChevronsUpDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsed(new Set(nodeKeys(tree)))}
                  title={t("overview.collapseAll")}
                  aria-label={t("overview.collapseAll")}
                  className="text-gray-400 hover:text-white"
                >
                  <ChevronsDownUp size={14} />
                </button>
              </>
            )}
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
            {bindingsOn && (
              <>
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
              </>
            )}
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
                {view === "tree"
                  ? tree.flatMap((n) => node(n, 0))
                  : rows.map((r) => row(r, 0))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-2 py-3 text-gray-500">{t("overview.empty")}</p>
            )}
            {view === "tree" && designation.error && (
              <p className="px-2 py-3 text-red-400">
                {t("overview.hierarchyError", { error: designation.error })}
              </p>
            )}
            {view === "tree" &&
              !designation.plan &&
              !designation.error &&
              rows.length > 0 && (
                <p className="px-2 py-3 text-gray-500">
                  {t("overview.hierarchyLoading")}
                </p>
              )}
          </div>
        </>
      )}
    </section>
  );
}
