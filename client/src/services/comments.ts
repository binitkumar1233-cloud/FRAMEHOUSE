import { API_URL } from "./api";
import { deviceHeaders } from "./security";

export type SortMode = "relevant" | "newest" | "oldest" | "top";
export type Reaction = "like" | "dislike" | null;

export type CommentView = {
  id: string;
  video: string;
  parent: string | null;
  createdAt: string;
  replyCount: number;
  deleted: boolean;
  removedBy?: "author" | "moderator";
  text: string;
  language?: string;
  user: { username: string; avatar: string } | null;
  replyTo?: string | null;
  mentions: string[];
  location?: string | null;
  likeCount?: number;
  dislikeCount?: number;
  myReaction?: Reaction;
  version?: number;
  edited?: boolean;
  editedAt?: string | null;
  own?: boolean;
  canEdit?: boolean;
  editableUntil?: string | null;
};

export type Captcha = { captchaId: string; question: string };

export const REPORT_REASONS: { value: string; label: string; hint: string }[] = [
  { value: "spam", label: "Spam", hint: "Ads, scams or repeated junk" },
  { value: "harassment", label: "Harassment", hint: "Targets or bullies someone" },
  { value: "offensive", label: "Offensive content", hint: "Abusive or inappropriate language" },
  { value: "hate", label: "Hate speech", hint: "Attacks people for who they are" },
  { value: "misinformation", label: "Misinformation", hint: "False or misleading claims" },
  { value: "other", label: "Something else", hint: "Anything not listed above" },
];

export class CommentError extends Error {
  status: number;
  code: string;
  data: Record<string, any>;
  constructor(message: string, status: number, code: string, data: Record<string, any>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const token = localStorage.getItem("token");
  let response: Response;
  try {
    response = await fetch(`${API_URL}/comments${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...deviceHeaders(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new CommentError("Couldn't reach the server. Check your connection and try again.", 0, "network", {});
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new CommentError(data.message || "Something went wrong. Please try again.", response.status, data.code || "error", data);
  }
  return data as T;
};

export const listComments = (videoId: string, sort: SortMode, page: number) =>
  request<{ comments: CommentView[]; total: number; totalAll: number; page: number; pages: number }>("GET", `/video/${videoId}?sort=${sort}&page=${page}&limit=15`);
export const listReplies = (id: string, page: number) =>
  request<{ replies: CommentView[]; total: number; page: number; pages: number }>("GET", `/${id}/replies?page=${page}&limit=20`);
export const postComment = (videoId: string, text: string, parentId?: string, captcha?: { id: string; answer: string }) =>
  request<{ comment: CommentView }>("POST", `/video/${videoId}`, { text, parentId, captchaId: captcha?.id, captchaAnswer: captcha?.answer });
export const editComment = (id: string, text: string, expectedVersion: number) =>
  request<{ comment: CommentView }>("PATCH", `/${id}`, { text, expectedVersion });
export const deleteComment = (id: string) => request<unknown>("DELETE", `/${id}`);
export const reactToComment = (id: string, reaction: "like" | "dislike" | "none") =>
  request<{ likeCount: number; dislikeCount: number; myReaction: Reaction }>("POST", `/${id}/react`, { reaction });
export const reportComment = (id: string, reason: string, details: string) => request<{ message: string }>("POST", `/${id}/report`, { reason, details });
export const translateComment = (id: string, target: string, version: number) =>
  request<{ text: string; detectedLanguage?: string; sameLanguage?: boolean; version: number; cached?: boolean }>("POST", `/${id}/translate`, { target, version });
export const getLanguages = () => request<{ languages: { code: string; name: string }[] }>("GET", "/languages");
export const getMe = () => request<{ username: string; preferredLanguage: string; editMinutes: number }>("GET", "/me");
export const saveLanguage = (language: string) => request<unknown>("PUT", "/me/language", { language });
export const searchMentions = (q: string) => request<{ users: { username: string; avatar: string }[] }>("GET", `/mentions?q=${encodeURIComponent(q)}`);

// ---- moderators ----
export type ReportRow = {
  _id: string;
  reason: string;
  details?: string;
  status: "open" | "dismissed" | "actioned";
  textSnapshot?: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
  reporter?: { username?: string; name?: string };
  resolvedBy?: { username?: string; name?: string };
  comment?: { _id: string; text: string; status: string; deletedAt?: string; reportCount: number; user?: { username?: string; name?: string } } | null;
};
export type LogRow = {
  _id: string;
  action: string;
  code?: string;
  detail?: string;
  excerpt?: string;
  createdAt: string;
  actor?: { username?: string; name?: string };
  targetUser?: { username?: string; name?: string };
};

export const adminReports = (status: string, page: number) => request<{ reports: ReportRow[]; total: number; pages: number }>("GET", `/admin/reports?status=${status}&page=${page}`);
export const adminResolve = (id: string, action: "dismiss" | "remove", note: string) => request<unknown>("POST", `/admin/reports/${id}/resolve`, { action, note });
export const adminRestore = (commentId: string) => request<unknown>("POST", `/admin/comments/${commentId}/restore`);
export const adminHistory = (commentId: string) =>
  request<{ comment: { text: string; history: { text: string; editedAt: string; version: number }[]; status: string; reportCount: number }; reports: ReportRow[]; log: LogRow[] }>("GET", `/admin/comments/${commentId}/history`);
export const adminLog = (action: string, page: number) => request<{ entries: LogRow[]; total: number; pages: number }>("GET", `/admin/log?page=${page}${action ? `&action=${action}` : ""}`);
