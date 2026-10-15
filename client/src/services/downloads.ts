import { API_URL } from "./api";
import { getDeviceId } from "../utils/deviceId";

export type DownloadStatus = "authorized" | "downloading" | "completed" | "interrupted" | "failed" | "blocked" | "expired";

export type DownloadRecord = {
  id: string;
  videoId: string | null;
  title: string;
  thumbnail?: string;
  plan: string;
  status: DownloadStatus;
  reason?: string;
  counted: boolean;
  duplicate: boolean;
  fileSize: number | null;
  bytesSent: number;
  browser?: string;
  os?: string;
  deviceType?: string;
  requestedAt: string;
  completedAt: string | null;
  videoAvailable?: boolean;
};

export type QuotaPeriod = { limit: number; used: number; remaining: number; resetsAt: string };

export type DownloadQuota = {
  plan: "Free" | "Bronze" | "Silver" | "Gold";
  subscriptionActive: boolean;
  subscriptionExpired: boolean;
  subscriptionExpiresAt: string | null;
  daily: QuotaPeriod;
  monthly: QuotaPeriod;
  remaining: number;
  devices: { registered: number; limit: number };
  concurrentLimit: number;
  timezone: string;
};

export type DownloadDevice = {
  deviceId: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  registeredAt: string;
  lastUsedAt: string;
  current: boolean;
};

export class DownloadError extends Error {
  code?: string;
  status: number;
  quota?: DownloadQuota;

  constructor(message: string, status: number, code?: string, quota?: DownloadQuota) {
    super(message);
    this.status = status;
    this.code = code;
    this.quota = quota;
  }
}

const request = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = localStorage.getItem("token");
  if (!token) throw new DownloadError("Sign in to download videos.", 401, "signed-out");

  const response = await fetch(`${API_URL}/downloads${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      "X-Device-Id": getDeviceId(),
    },
  });

  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON error page.
  }

  if (!response.ok || data.success === false) {
    throw new DownloadError(data.message || "Something went wrong. Please try again.", response.status, data.code, data.quota);
  }
  return data as T;
};

export const getQuota = () => request<{ quota: DownloadQuota }>("/quota").then((data) => data.quota);

export const listDownloads = () =>
  request<{ downloads: DownloadRecord[]; quota: DownloadQuota; total: number }>("?limit=50");

export const listDevices = () =>
  request<{ devices: DownloadDevice[]; limit: number; required: boolean }>("/devices");

export const removeDevice = (deviceId: string) =>
  request<{ success: boolean }>(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });

/**
 * Asks the server for permission, then hands the signed link to the browser's
 * download manager through a hidden iframe (so an error page can't replace the app).
 */
export const startDownload = async (videoId: string) => {
  const data = await request<{ url: string; counted: boolean; reused?: boolean; download: DownloadRecord; quota: DownloadQuota }>(
    `/${encodeURIComponent(videoId)}`,
    { method: "POST" }
  );

  const frame = document.createElement("iframe");
  frame.style.display = "none";
  frame.src = data.url;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 120_000);

  return data;
};

export const formatBytes = (bytes?: number | null) => {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const formatResetIn = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "soon";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 48) return `in ${Math.round(hours / 24)} days`;
  if (hours >= 1) return `in ${hours}h ${minutes}m`;
  return `in ${Math.max(1, minutes)}m`;
};
