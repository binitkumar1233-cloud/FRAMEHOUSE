import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { Icon } from "./Icon";
import {
  CommentError,
  REPORT_REASONS,
  deleteComment,
  editComment,
  getLanguages,
  getMe,
  listComments,
  listReplies,
  postComment,
  reactToComment,
  reportComment,
  saveLanguage,
  searchMentions,
  translateComment,
} from "../services/comments";
import type { Captcha, CommentView, SortMode } from "../services/comments";
import "./Comments.css";

const MAX = 1500;
const SORTS: { value: SortMode; label: string }[] = [
  { value: "relevant", label: "Most relevant" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "top", label: "Most liked" },
];

const FALLBACK_LANGUAGES = [{ code: "en", name: "English" }];

// ---------- helpers ----------

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const full = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const minutesLeft = (iso?: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)) : 0);

/** Links and real @mentions become safe elements; everything else stays plain text (React escapes it). */
const renderBody = (text: string, mentions: string[]): ReactNode[] => {
  const known = new Set(mentions.map((m) => m.toLowerCase()));
  const parts = text.split(/(https?:\/\/[^\s<]+|www\.[^\s<]+|@[a-zA-Z0-9_]{3,20}\b)/g);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^(https?:\/\/|www\.)/i.test(part)) {
      const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] || "";
      const clean = trailing ? part.slice(0, -trailing.length) : part;
      const href = /^https?:/i.test(clean) ? clean : `https://${clean}`;
      try {
        const url = new URL(href);
        if (!/^https?:$/.test(url.protocol)) return part;
        return (
          <span key={index}>
            <a href={url.href} target="_blank" rel="nofollow noopener noreferrer ugc">{clean}</a>
            {trailing}
          </span>
        );
      } catch {
        return part;
      }
    }
    if (part.startsWith("@") && known.has(part.slice(1).toLowerCase())) return <span key={index} className="cm-mention">{part}</span>;
    return part;
  });
};

const Avatar = ({ name, src }: { name: string; src?: string }) =>
  src ? <img className="cm-avatar" src={src} alt="" loading="lazy" /> : <span className="cm-avatar cm-avatar-initial" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;

// ---------- composer (new comment, reply, edit) ----------

type SubmitFn = (text: string, captcha?: { id: string; answer: string }) => Promise<void>;

function Composer({
  placeholder,
  submitLabel,
  initialText = "",
  autoFocus,
  signedIn,
  onSubmit,
  onCancel,
  compact,
}: {
  placeholder: string;
  submitLabel: string;
  initialText?: string;
  autoFocus?: boolean;
  signedIn: boolean;
  onSubmit: SubmitFn;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [answer, setAnswer] = useState("");
  const [suggestions, setSuggestions] = useState<{ username: string; avatar: string }[]>([]);
  const [retryIn, setRetryIn] = useState(0);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (retryIn <= 0) return;
    const t = window.setTimeout(() => setRetryIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [retryIn]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Grow with the text.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [text]);

  const lookupMention = (value: string, caret: number) => {
    window.clearTimeout(timer.current);
    const match = value.slice(0, caret).match(/(?:^|\s)@([a-zA-Z0-9_]{2,20})$/);
    if (!match || !signedIn) return setSuggestions([]);
    timer.current = window.setTimeout(async () => {
      try { setSuggestions((await searchMentions(match[1])).users); } catch { setSuggestions([]); }
    }, 180);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
    lookupMention(event.target.value, event.target.selectionStart);
  };

  const pick = (username: string) => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([a-zA-Z0-9_]{2,20})$/, `@${username} `);
    setText(before + text.slice(caret));
    setSuggestions([]);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(text, captcha ? { id: captcha.captchaId, answer } : undefined);
      setText("");
      setCaptcha(null);
      setAnswer("");
    } catch (caught) {
      if (caught instanceof CommentError) {
        if (caught.data.captcha) { setCaptcha(caught.data.captcha); setAnswer(""); }
        if (caught.data.retryAfter) setRetryIn(Number(caught.data.retryAfter));
        setError(caught.message);
      } else setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const left = MAX - text.length;

  return (
    <form className={`cm-composer ${compact ? "compact" : ""}`} onSubmit={submit}>
      <div className="cm-field">
        <textarea
          ref={area}
          value={text}
          onChange={onChange}
          placeholder={placeholder}
          maxLength={MAX + 200}
          rows={compact ? 2 : 3}
          autoFocus={autoFocus}
          dir="auto"
          aria-label={placeholder}
          aria-invalid={Boolean(error)}
          onKeyDown={(event) => { if (event.key === "Escape") { setSuggestions([]); onCancel?.(); } if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit(event); }}
        />
        {suggestions.length > 0 && (
          <ul className="cm-suggest" role="listbox" aria-label="Mention suggestions">
            {suggestions.map((s) => (
              <li key={s.username}>
                <button type="button" role="option" aria-selected="false" onMouseDown={(event) => { event.preventDefault(); pick(s.username); }}>
                  <Avatar name={s.username} src={s.avatar} /> @{s.username}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {captcha && (
        <label className="cm-captcha">
          <span>Quick check: {captcha.question}</span>
          <input value={answer} onChange={(event) => setAnswer(event.target.value.replace(/[^\d-]/g, ""))} inputMode="numeric" autoComplete="off" required aria-label={captcha.question} />
        </label>
      )}

      <p className="cm-error" role="alert">{error}{retryIn > 0 ? ` (${retryIn}s)` : ""}</p>

      <div className="cm-composer-foot">
        <span className={left < 100 ? "cm-count warn" : "cm-count"}>{left < 300 ? `${left} left` : "Type @ to mention someone"}</span>
        <div>
          {onCancel && <button type="button" className="cm-btn ghost" onClick={onCancel}>Cancel</button>}
          <button className="cm-btn primary" type="submit" disabled={busy || !text.trim() || left < 0 || retryIn > 0}>{busy ? "Posting…" : submitLabel}</button>
        </div>
      </div>
    </form>
  );
}

// ---------- report dialog ----------

function ReportDialog({ onClose, onSend }: { onClose: () => void; onSend: (reason: string, details: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        className="cm-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-report-title"
        onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await onSend(reason, details); } finally { setBusy(false); } }}
      >
        <h3 id="cm-report-title">Report this comment</h3>
        <p>Pick the closest reason. A moderator will review it. Nothing is removed automatically.</p>
        <div role="radiogroup" aria-label="Reason">
          {REPORT_REASONS.map((r) => (
            <label key={r.value} className={reason === r.value ? "selected" : ""}>
              <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
              <span><strong>{r.label}</strong><small>{r.hint}</small></span>
            </label>
          ))}
        </div>
        <textarea placeholder="Anything else we should know? (optional)" value={details} onChange={(event) => setDetails(event.target.value.slice(0, 500))} rows={3} />
        <div className="cm-report-foot">
          <button type="button" className="cm-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cm-btn primary" type="submit" disabled={!reason || busy}>{busy ? "Sending…" : "Send report"}</button>
        </div>
      </form>
    </div>
  );
}

// ---------- one comment ----------

type ItemProps = {
  comment: CommentView;
  videoId: string;
  signedIn: boolean;
  language: string;
  languageName: string;
  openAuth: () => void;
  setToast: (message: string) => void;
  onChange: (next: CommentView) => void;
  onGone: (id: string) => void;
  onReplyPosted?: (reply: CommentView) => void;
  isReply?: boolean;
};

function CommentItem({ comment, videoId, signedIn, language, languageName, openAuth, setToast, onChange, onGone, onReplyPosted, isReply }: ItemProps) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [translated, setTranslated] = useState<{ text: string; same?: boolean } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState("");
  const [replies, setReplies] = useState<CommentView[]>([]);
  const [open, setOpen] = useState(false);
  const [repliesPage, setRepliesPage] = useState(0);
  const [repliesPages, setRepliesPages] = useState(1);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [reacting, setReacting] = useState(false);
  const currentVersion = useRef(comment.version);
  const currentLanguage = useRef(language);

  // A new version of the comment (after an edit) makes the old translation stale.
  useEffect(() => {
    currentVersion.current = comment.version;
    currentLanguage.current = language;
    setTranslated(null);
    setTranslateError("");
  }, [comment.version, language]);

  const needSignIn = () => { setToast("Sign in to join the conversation."); openAuth(); };

  const loadReplies = useCallback(async (page: number) => {
    setLoadingReplies(true);
    try {
      const data = await listReplies(comment.id, page);
      setReplies((current) => (page === 1 ? data.replies : [...current, ...data.replies.filter((r) => !current.some((c) => c.id === r.id))]));
      setRepliesPage(data.page);
      setRepliesPages(data.pages);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't load replies.");
    } finally {
      setLoadingReplies(false);
    }
  }, [comment.id, setToast]);

  const toggleReplies = () => {
    if (!open && repliesPage === 0) void loadReplies(1);
    setOpen((v) => !v);
  };

  const react = async (kind: "like" | "dislike") => {
    if (!signedIn) return needSignIn();
    if (reacting) return;
    const next = comment.myReaction === kind ? "none" : kind;
    const before = comment;
    // Optimistic: show the change now, roll back if the server refuses.
    const likeDelta = (next === "like" ? 1 : 0) - (before.myReaction === "like" ? 1 : 0);
    const dislikeDelta = (next === "dislike" ? 1 : 0) - (before.myReaction === "dislike" ? 1 : 0);
    onChange({ ...before, myReaction: next === "none" ? null : next, likeCount: (before.likeCount || 0) + likeDelta, dislikeCount: (before.dislikeCount || 0) + dislikeDelta });
    setReacting(true);
    try {
      const result = await reactToComment(comment.id, next);
      onChange({ ...before, likeCount: result.likeCount, dislikeCount: result.dislikeCount, myReaction: result.myReaction });
    } catch (error) {
      onChange(before);
      if (error instanceof CommentError && error.status === 404) onGone(comment.id);
      setToast(error instanceof Error ? error.message : "Couldn't save your reaction.");
    } finally {
      setReacting(false);
    }
  };

  const translate = async () => {
    if (!signedIn) return needSignIn();
    if (translated) return setTranslated(null);
    setTranslating(true);
    setTranslateError("");
    const version = comment.version ?? 1;
    try {
      const result = await translateComment(comment.id, language, version);
      if (result.version !== version || currentVersion.current !== version || currentLanguage.current !== language) return;
      setTranslated({ text: result.text, same: result.sameLanguage });
    } catch (error) {
      setTranslateError(error instanceof Error ? error.message : "Couldn't translate this comment.");
    } finally {
      setTranslating(false);
    }
  };

  const submitEdit: SubmitFn = async (text) => {
    try {
      const result = await editComment(comment.id, text, comment.version ?? 1);
      onChange(result.comment);
      setEditing(false);
      setToast("Comment updated.");
    } catch (error) {
      if (error instanceof CommentError && error.code === "edit-conflict") {
        // Someone (another tab) changed it first: show the latest and let the user decide.
        if (error.data.comment) onChange(error.data.comment);
        setEditing(false);
        setToast("This comment was changed elsewhere. Showing the latest version; edit again if you still want to.");
        return;
      }
      if (error instanceof CommentError && error.code === "edit-window-closed") { setEditing(false); onChange({ ...comment, canEdit: false }); }
      throw error;
    }
  };

  const submitReply: SubmitFn = async (text, captcha) => {
    const result = await postComment(videoId, text, comment.id, captcha);
    const reply = result.comment;
    setReplying(false);
    if (isReply) { onReplyPosted?.(reply); return; }
    setReplies((current) => [...current, reply]);
    setOpen(true);
    if (repliesPage === 0) setRepliesPage(1);
    onChange({ ...comment, replyCount: comment.replyCount + 1 });
  };

  const remove = async () => {
    if (!window.confirm("Delete this comment? This can't be undone.")) return;
    try {
      await deleteComment(comment.id);
      if (comment.replyCount > 0) onChange({ ...comment, deleted: true, removedBy: "author", text: "", user: null });
      else onGone(comment.id);
      setToast("Comment deleted.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't delete the comment.");
      if (error instanceof CommentError && error.code === "edit-window-closed") onChange({ ...comment, canEdit: false });
    }
  };

  const sendReport = async (reason: string, details: string) => {
    try {
      const result = await reportComment(comment.id, reason, details);
      setToast(result.message);
      setReporting(false);
    } catch (error) {
      if (error instanceof CommentError && error.code === "already-reported") { setToast(error.message); setReporting(false); }
      else setToast(error instanceof Error ? error.message : "Couldn't send the report.");
    }
  };

  const patchReply = (next: CommentView) => setReplies((current) => current.map((r) => (r.id === next.id ? next : r)));
  const dropReply = (id: string) => {
    setReplies((current) => current.filter((r) => r.id !== id));
    onChange({ ...comment, replyCount: Math.max(0, comment.replyCount - 1) });
  };

  const replyList = (
    <>
      {open && (
        <div className="cm-replies">
          {replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} videoId={videoId} signedIn={signedIn} language={language} languageName={languageName} openAuth={openAuth} setToast={setToast}
              onChange={patchReply} onGone={dropReply} isReply onReplyPosted={(r) => { setReplies((c) => [...c, r]); onChange({ ...comment, replyCount: comment.replyCount + 1 }); }} />
          ))}
          {loadingReplies && <p className="cm-muted">Loading replies…</p>}
          {!loadingReplies && repliesPage < repliesPages && <button className="cm-link" onClick={() => void loadReplies(repliesPage + 1)}>Show more replies</button>}
        </div>
      )}
    </>
  );

  if (comment.deleted) {
    return (
      <article className={`cm-item ${isReply ? "is-reply" : ""}`}>
        <div className="cm-body">
          <p className="cm-deleted">{comment.removedBy === "moderator" ? "This comment was removed by a moderator." : "This comment was deleted."}</p>
          {comment.replyCount > 0 && (
            <button className="cm-link" onClick={toggleReplies} aria-expanded={open}>
              <Icon name="chevron-down" size={14} className={open ? "flip" : ""} /> {open ? "Hide" : "View"} {comment.replyCount} {comment.replyCount === 1 ? "reply" : "replies"}
            </button>
          )}
          {replyList}
        </div>
      </article>
    );
  }

  const author = comment.user?.username || "unknown";
  const minutes = minutesLeft(comment.editableUntil);
  const shownText = translated && !translated.same ? translated.text : comment.text;

  return (
    <article className={`cm-item ${isReply ? "is-reply" : ""}`} id={`comment-${comment.id}`}>
      <Avatar name={author} src={comment.user?.avatar} />
      <div className="cm-body">
        <header className="cm-meta">
          <strong>@{author}</strong>
          {comment.location && <span className="cm-loc" title="Approximate location when they posted"><Icon name="pin" size={12} />{comment.location}</span>}
          <time dateTime={comment.createdAt} title={full(comment.createdAt)}>{ago(comment.createdAt)}</time>
          {comment.edited && comment.editedAt && <span className="cm-edited" title={`Edited ${full(comment.editedAt)}`}>edited</span>}
        </header>

        {editing ? (
          <Composer placeholder="Edit your comment" submitLabel="Save" initialText={comment.text} autoFocus signedIn={signedIn} compact onSubmit={submitEdit} onCancel={() => setEditing(false)} />
        ) : (
          <>
            {comment.replyTo && isReply && <span className="cm-replying">replying to @{comment.replyTo}</span>}
            <p className="cm-text" dir="auto" lang={translated && !translated.same ? language : undefined}>{renderBody(shownText, comment.mentions)}</p>
            {translated && (
              <p className="cm-translated-note">
                <Icon name="globe" size={12} /> {translated.same ? `Already in ${languageName}.` : `Translated to ${languageName}.`}
              </p>
            )}
            {translateError && <p className="cm-error" role="alert">{translateError}</p>}
          </>
        )}

        {!editing && (
          <div className="cm-actions">
            <button className={`cm-act ${comment.myReaction === "like" ? "on" : ""}`} onClick={() => void react("like")} aria-pressed={comment.myReaction === "like"} aria-label={`Like, ${comment.likeCount || 0} likes`}>
              <Icon name="thumbs-up" size={16} /> {comment.likeCount || 0}
            </button>
            <button className={`cm-act ${comment.myReaction === "dislike" ? "on bad" : ""}`} onClick={() => void react("dislike")} aria-pressed={comment.myReaction === "dislike"} aria-label={`Dislike, ${comment.dislikeCount || 0} dislikes`}>
              <Icon name="thumbs-down" size={16} /> {comment.dislikeCount || 0}
            </button>
            <button className="cm-act" onClick={() => (signedIn ? setReplying((v) => !v) : needSignIn())}><Icon name="reply" size={16} /> Reply</button>
            <button className="cm-act" onClick={() => void translate()} disabled={translating} aria-pressed={Boolean(translated)}>
              <Icon name="globe" size={16} /> {translating ? "Translating…" : translated ? "Show original" : "Translate"}
            </button>
            {comment.own && comment.canEdit && (
              <>
                <button className="cm-act" onClick={() => setEditing(true)} title={`You can edit for ${minutes} more minute${minutes === 1 ? "" : "s"}`}><Icon name="edit" size={16} /> Edit</button>
                <button className="cm-act" onClick={() => void remove()}><Icon name="trash" size={16} /> Delete</button>
              </>
            )}
            {!comment.own && <button className="cm-act subtle" onClick={() => (signedIn ? setReporting(true) : needSignIn())} aria-label="Report this comment"><Icon name="flag" size={16} /> Report</button>}
          </div>
        )}

        {replying && <Composer placeholder={`Reply to @${author}`} submitLabel="Reply" autoFocus compact signedIn={signedIn} onSubmit={submitReply} onCancel={() => setReplying(false)} />}

        {!isReply && comment.replyCount > 0 && (
          <button className="cm-link" onClick={toggleReplies} aria-expanded={open}>
            <Icon name="chevron-down" size={14} className={open ? "flip" : ""} /> {open ? "Hide" : "View"} {comment.replyCount} {comment.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}
        {!isReply && replyList}
      </div>
      {reporting && <ReportDialog onClose={() => setReporting(false)} onSend={sendReport} />}
    </article>
  );
}

// ---------- the section ----------

export function Comments({ videoId, signedIn, openAuth, setToast }: { videoId: string; signedIn: boolean; openAuth: () => void; setToast: (message: string) => void }) {
  const [sort, setSort] = useState<SortMode>(() => (localStorage.getItem("cm_sort") as SortMode) || "relevant");
  const [items, setItems] = useState<CommentView[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [language, setLanguage] = useState(() => localStorage.getItem("cm_lang") || "en");
  const [languages, setLanguages] = useState(FALLBACK_LANGUAGES);
  const requestId = useRef(0);

  const load = useCallback(async (nextPage: number, mode: SortMode) => {
    const mine = ++requestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const data = await listComments(videoId, mode, nextPage);
      if (mine !== requestId.current) return; // a newer request replaced this one
      setItems((current) => (nextPage === 1 ? data.comments : [...current, ...data.comments.filter((c) => !current.some((x) => x.id === c.id))]));
      setPage(data.page);
      setPages(data.pages);
      setTotal(data.totalAll);
    } catch (error) {
      if (mine === requestId.current) setLoadError(error instanceof Error ? error.message : "Couldn't load comments.");
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [videoId]);

  useEffect(() => { void load(1, sort); }, [load, sort, signedIn]);

  useEffect(() => {
    let cancelled = false;
    getLanguages().then((d) => { if (!cancelled) setLanguages(d.languages); }).catch(() => {});
    if (signedIn) getMe().then((me) => { if (!cancelled) { setLanguage(me.preferredLanguage); localStorage.setItem("cm_lang", me.preferredLanguage); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [signedIn]);

  const languageName = useMemo(() => languages.find((l) => l.code === language)?.name || language, [languages, language]);

  const changeSort = (value: SortMode) => { setSort(value); localStorage.setItem("cm_sort", value); };
  const changeLanguage = (code: string) => {
    setLanguage(code);
    localStorage.setItem("cm_lang", code);
    if (signedIn) void saveLanguage(code).catch(() => {});
  };

  const postTop: SubmitFn = async (text, captcha) => {
    const result = await postComment(videoId, text, undefined, captcha);
    setItems((current) => (sort === "oldest" ? current : [result.comment, ...current.filter((c) => c.id !== result.comment.id)]));
    setTotal((n) => n + 1);
    setToast("Comment posted.");
  };

  const patch = (next: CommentView) => setItems((current) => current.map((c) => (c.id === next.id ? next : c)));
  const drop = (id: string) => { setItems((current) => current.filter((c) => c.id !== id)); setTotal((n) => Math.max(0, n - 1)); };

  return (
    <section className="cm-section" aria-labelledby="cm-title">
      <header className="cm-head">
        <h2 id="cm-title">{total.toLocaleString()} {total === 1 ? "comment" : "comments"}</h2>
        <div className="cm-controls">
          <label>
            <span>Translate to</span>
            <select value={language} onChange={(event) => changeLanguage(event.target.value)} aria-label="Translate comments to">
              {languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select value={sort} onChange={(event) => changeSort(event.target.value as SortMode)} aria-label="Sort comments">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </header>

      {signedIn ? (
        <Composer placeholder="Add a comment in any language…" submitLabel="Comment" signedIn onSubmit={postTop} />
      ) : (
        <div className="cm-signin">
          <p>Sign in to comment, reply and react.</p>
          <button className="cm-btn primary" onClick={openAuth}>Sign in</button>
        </div>
      )}

      {loadError && (
        <div className="cm-state" role="alert">
          <p>{loadError}</p>
          <button className="cm-btn" onClick={() => void load(1, sort)}>Try again</button>
        </div>
      )}

      {!loadError && loading && items.length === 0 && <div className="cm-skeleton" aria-busy="true" aria-label="Loading comments"><span /><span /><span /></div>}

      {!loadError && !loading && items.length === 0 && <p className="cm-empty">No comments yet. Start the conversation.</p>}

      <div className="cm-list">
        {items.map((comment) => (
          <CommentItem key={comment.id} comment={comment} videoId={videoId} signedIn={signedIn} language={language} languageName={languageName} openAuth={openAuth} setToast={setToast} onChange={patch} onGone={drop} />
        ))}
      </div>

      {page < pages && !loadError && (
        <button className="cm-btn more" onClick={() => void load(page + 1, sort)} disabled={loading}>{loading ? "Loading…" : "Show more comments"}</button>
      )}
    </section>
  );
}
