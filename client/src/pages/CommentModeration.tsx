import { useCallback, useEffect, useState } from "react";
import { adminHistory, adminLog, adminReports, adminRestore, adminResolve } from "../services/comments";
import type { LogRow, ReportRow } from "../services/comments";

const REASON_LABEL: Record<string, string> = {
  spam: "Spam", harassment: "Harassment", offensive: "Offensive", hate: "Hate speech", misinformation: "Misinformation", other: "Other",
};

const ACTION_LABEL: Record<string, string> = {
  auto_blocked: "Blocked automatically",
  report_filed: "Report filed",
  report_dismissed: "Report dismissed",
  comment_removed: "Comment removed",
  comment_restored: "Comment restored",
  comment_deleted_by_author: "Deleted by author",
  comment_edited: "Edited",
};

const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const who = (u?: { username?: string; name?: string }) => (u?.username ? `@${u.username}` : u?.name || "—");

type History = Awaited<ReturnType<typeof adminHistory>>;

export default function CommentModeration({ setToast }: { setToast: (message: string) => void }) {
  const [tab, setTab] = useState<"open" | "dismissed" | "actioned" | "log">("open");
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [entries, setEntries] = useState<LogRow[]>([]);
  const [logFilter, setLogFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [history, setHistory] = useState<{ id: string; data: History } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (tab === "log") {
        const data = await adminLog(logFilter, page);
        setEntries(data.entries);
        setPages(data.pages);
        setTotal(data.total);
      } else {
        const data = await adminReports(tab, page);
        setReports(data.reports);
        setPages(data.pages);
        setTotal(data.total);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't load this list.");
    } finally {
      setLoading(false);
    }
  }, [tab, page, logFilter]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (report: ReportRow, action: "dismiss" | "remove") => {
    const note = window.prompt(action === "remove" ? "Note for the record (optional):" : "Why is this fine? (optional):") ?? null;
    if (note === null) return;
    setBusy(report._id);
    try {
      await adminResolve(report._id, action, note);
      setToast(action === "remove" ? "Comment removed." : "Report dismissed.");
      await load();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "That didn't work.");
      await load();
    } finally {
      setBusy("");
    }
  };

  const restore = async (commentId: string) => {
    setBusy(commentId);
    try {
      await adminRestore(commentId);
      setToast("Comment restored.");
      await load();
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "Couldn't restore it.");
    } finally {
      setBusy("");
    }
  };

  const showHistory = async (commentId: string) => {
    if (history?.id === commentId) return setHistory(null);
    try { setHistory({ id: commentId, data: await adminHistory(commentId) }); } catch (caught) { setToast(caught instanceof Error ? caught.message : "Couldn't load the history."); }
  };

  const switchTab = (next: typeof tab) => { setTab(next); setPage(1); setHistory(null); };

  return (
    <div className="page-wrap narrow-page mod-page">
      <div className="page-heading"><div><span className="eyebrow">ADMIN</span><h1>Comment moderation.</h1></div></div>
      <p className="mod-note">Reports flag a comment for review. Nothing is removed automatically, and dislikes never remove a comment.</p>

      <div className="tab-row" role="tablist" aria-label="Moderation sections">
        {([["open", "Open reports"], ["actioned", "Removed"], ["dismissed", "Dismissed"], ["log", "Moderation log"]] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "selected" : ""} onClick={() => switchTab(value)}>{label}</button>
        ))}
      </div>

      {error && <div className="empty-state"><h2>We couldn't load this</h2><p>{error}</p><button className="primary-button" onClick={() => void load()}>Try again</button></div>}
      {!error && loading && <div className="sec-skeleton" aria-busy="true" />}

      {!error && !loading && tab !== "log" && (
        reports.length === 0 ? <p className="sec-empty">{tab === "open" ? "No reports waiting. Nice and quiet." : "Nothing here yet."}</p> : (
          <ul className="mod-list">
            {reports.map((report) => {
              const comment = report.comment;
              const gone = !comment || comment.status === "removed" || Boolean(comment.deletedAt);
              return (
                <li key={report._id}>
                  <header>
                    <span className={`mod-reason r-${report.reason}`}>{REASON_LABEL[report.reason] || report.reason}</span>
                    <span className="mod-meta">reported by {who(report.reporter)} · {stamp(report.createdAt)}</span>
                    {comment && comment.reportCount > 1 && <span className="mod-meta strong">{comment.reportCount} reports on this comment</span>}
                  </header>
                  <blockquote dir="auto">{comment?.text || report.textSnapshot || "(comment no longer exists)"}</blockquote>
                  <p className="mod-meta">by {who(comment?.user)}{comment?.status === "removed" ? " · currently removed" : comment?.deletedAt ? " · deleted by author" : ""}</p>
                  {report.details && <p className="mod-details">“{report.details}”</p>}
                  {report.status !== "open" && <p className="mod-meta">Handled by {who(report.resolvedBy)} · {stamp(report.resolvedAt)}{report.resolutionNote ? ` · ${report.resolutionNote}` : ""}</p>}
                  <div className="mod-actions">
                    {report.status === "open" && (
                      <>
                        <button className="line-button" disabled={busy === report._id} onClick={() => void resolve(report, "dismiss")}>Dismiss</button>
                        <button className="mod-danger" disabled={busy === report._id || gone} onClick={() => void resolve(report, "remove")}>Remove comment</button>
                      </>
                    )}
                    {comment?.status === "removed" && !comment.deletedAt && <button className="line-button" disabled={busy === comment._id} onClick={() => void restore(comment._id)}>Restore</button>}
                    {comment && <button className="mod-link" onClick={() => void showHistory(comment._id)}>{history?.id === comment._id ? "Hide history" : "History"}</button>}
                  </div>
                  {comment && history?.id === comment._id && (
                    <div className="mod-history">
                      <h4>Edits</h4>
                      {history.data.comment.history?.length ? (
                        <ol>{history.data.comment.history.map((h) => <li key={h.version}><small>v{h.version} · {stamp(h.editedAt)}</small><p dir="auto">{h.text}</p></li>)}</ol>
                      ) : <p className="mod-meta">Never edited.</p>}
                      <h4>Reports ({history.data.reports.length})</h4>
                      <ul>{history.data.reports.map((r) => <li key={r._id}><small>{stamp(r.createdAt)} · {who(r.reporter)} · {REASON_LABEL[r.reason] || r.reason} · {r.status}</small></li>)}</ul>
                      <h4>Moderation log</h4>
                      <ul>{history.data.log.map((l) => <li key={l._id}><small>{stamp(l.createdAt)} · {ACTION_LABEL[l.action] || l.action}{l.actor ? ` · ${who(l.actor)}` : ""}{l.detail ? ` · ${l.detail}` : ""}</small></li>)}</ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}

      {!error && !loading && tab === "log" && (
        <>
          <label className="mod-filter">
            <span>Show</span>
            <select value={logFilter} onChange={(event) => { setLogFilter(event.target.value); setPage(1); }}>
              <option value="">Everything</option>
              {Object.entries(ACTION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {entries.length === 0 ? <p className="sec-empty">Nothing logged yet.</p> : (
            <ul className="mod-log">
              {entries.map((entry) => (
                <li key={entry._id}>
                  <div><strong>{ACTION_LABEL[entry.action] || entry.action}</strong>{entry.code && <span className="mod-reason">{REASON_LABEL[entry.code] || entry.code}</span>}</div>
                  <small>{stamp(entry.createdAt)} · {entry.actor ? `by ${who(entry.actor)} · ` : ""}user {who(entry.targetUser)}</small>
                  {entry.excerpt && <p dir="auto">{entry.excerpt}</p>}
                  {entry.detail && <small className="mod-meta">{entry.detail}</small>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!error && pages > 1 && (
        <footer className="sec-pager">
          <button className="line-button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</button>
          <span>Page {page} of {pages} · {total} total</span>
          <button className="line-button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>Next</button>
        </footer>
      )}
    </div>
  );
}
