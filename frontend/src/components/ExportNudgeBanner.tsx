import { Upload, X } from "lucide-react";
import { t } from "../i18n";
import { useDiagramContext } from "../state/useDiagramContext";

/** After a save of a diagram exported to the provider: a non-modal offer to export it again (Export to RSDU…). */
export function ExportNudgeBanner() {
  const { exportNudge, dismissExportNudge, setExportOpen } =
    useDiagramContext();
  if (!exportNudge) return null;
  return (
    <div
      role="status"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded border border-surface-500 bg-surface-700/95 px-3 py-2 text-xs text-gray-200 shadow"
    >
      <Upload size={14} className="shrink-0 text-accent" />
      <span>{t("exportNudge.text")}</span>
      <button
        type="button"
        onClick={() => setExportOpen(true)}
        className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90"
      >
        {t("exportNudge.export")}
      </button>
      <button
        type="button"
        onClick={dismissExportNudge}
        title={t("common.close")}
        aria-label={t("common.close")}
        className="text-gray-400 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}
