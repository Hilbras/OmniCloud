import { useCallback, useEffect, useState } from "react";
import { Download, History } from "lucide-react";
import { ACTIVITY_ACTIONS, type ActivityEventDTO } from "@omnicloud/shared";
import { api, errorMessage } from "../api/client";
import { activityToCsv } from "../lib/activity-csv";
import { formatDateTime } from "../lib/format";
import { useToast } from "./Toasts";

const ACTIONS = ["", ...ACTIVITY_ACTIONS];

export function ActivityLog() {
  const toast = useToast();
  const [events, setEvents] = useState<ActivityEventDTO[]>([]);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (nextPage: number, append: boolean): Promise<void> => {
      setLoading(true);
      try {
        const result = await api.activity.list({
          page: nextPage,
          limit: 50,
          ...(action ? { action } : {}),
          ...(from ? { from: new Date(from).toISOString() } : {}),
          ...(to ? { to: new Date(`${to}T23:59:59.999`).toISOString() } : {}),
        });
        setEvents((current) => (append ? [...current, ...result.events] : result.events));
        setHasMore(result.pagination.hasMore);
        setPage(nextPage);
      } catch (error) {
        toast.error(errorMessage(error, "Could not load the activity log"));
      } finally {
        setLoading(false);
      }
    },
    [action, from, to, toast],
  );

  useEffect(() => {
    void load(1, false);
    // Reload on mount only; filters apply through the Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = (): void => {
    const blob = new Blob([activityToCsv(events)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "omnicloud-activity.csv";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-gold-text" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Activity log</h2>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs font-medium">
          Action
          <select
            className="rounded-lg border border-line bg-surface px-2 py-1.5"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "" ? "All" : value}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium">
          From
          <input
            type="date"
            className="rounded-lg border border-line bg-surface px-2 py-1.5"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium">
          To
          <input
            type="date"
            className="rounded-lg border border-line bg-surface px-2 py-1.5"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={() => void load(1, false)}>
          Apply
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={exportCsv}
          disabled={events.length === 0}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="muted text-xs uppercase tracking-wide">
            <tr>
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2">Item</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-line/70">
                <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(event.createdAt)}</td>
                <td className="py-2 pr-3">{event.action}</td>
                <td className="py-2">{event.resourceName ?? event.resourceId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <p className="muted text-sm">Loading…</p> : null}
      {!loading && events.length === 0 ? <p className="muted text-sm">No activity yet.</p> : null}
      {hasMore ? (
        <button type="button" className="btn-secondary" onClick={() => void load(page + 1, true)}>
          Load more
        </button>
      ) : null}
    </section>
  );
}
