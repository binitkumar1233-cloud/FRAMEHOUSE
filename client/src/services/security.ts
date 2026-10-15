import { API_URL } from "./api";
import { getDeviceId } from "../utils/deviceId";

export type SecurityEvent =
  | "login_success"
  | "login_failed"
  | "otp_sent"
  | "otp_verified"
  | "otp_failed"
  | "otp_locked"
  | "otp_expired"
  | "device_trusted"
  | "device_revoked"
  | "session_revoked"
  | "logout"
  | "login_blocked"
  | "password_changed";

export type LoginRecord = {
  _id: string;
  event: SecurityEvent;
  reasons: string[];
  note?: string;
  ip?: string;
  browserName?: string;
  browserVersion?: string;
  os?: string;
  deviceType?: string;
  deviceModel?: string;
  city?: string;
  region?: string;
  country?: string;
  location?: string;
  createdAt: string;
};

export type SecuritySession = {
  sid: string;
  ip?: string;
  browserName?: string;
  browserVersion?: string;
  os?: string;
  deviceType?: string;
  deviceModel?: string;
  location?: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
};

export type TrustedDeviceInfo = {
  _id: string;
  label?: string;
  deviceType?: string;
  deviceModel?: string;
  ip?: string;
  location?: string;
  trustedAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  current: boolean;
};

export type SecurityOverview = {
  theme: "light" | "dark";
  themeSource: "auto" | "manual";
  email: string;
  phone: string | null;
  lastLogin: LoginRecord | null;
  failedLast30Days: number;
  activeSessions: number;
  trustedDevices: number;
  trustChoices: number[];
  trustDefault: number;
};

export type OtpChallenge = {
  challengeId: string;
  maskedEmail: string;
  maskedPhone?: string;
  reasons: string[];
  expiresInSeconds: number;
  resendAfterSeconds: number;
  trustChoices: number[];
  trustDefault: number;
};

export class SecurityError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** Sent with every sign-in request so the server can recognise this browser. */
export const deviceHeaders = (): Record<string, string> => ({ "X-Device-Id": getDeviceId() });

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const token = localStorage.getItem("token");
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...deviceHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new SecurityError(data.message || "Something went wrong", response.status, data);
  }
  return data as T;
};

export const getOverview = () => request<SecurityOverview & { success: true }>("GET", "/security/overview");
export const getSessions = () => request<{ sessions: SecuritySession[] }>("GET", "/security/sessions");
export const getDevices = () => request<{ devices: TrustedDeviceInfo[] }>("GET", "/security/devices");
export const getHistory = (type: "all" | "success" | "failed", page: number) =>
  request<{ records: LoginRecord[]; total: number; page: number; pages: number }>(
    "GET",
    `/security/history?limit=15&page=${page}${type === "all" ? "" : `&type=${type}`}`
  );
export const revokeSession = (sid: string) => request<{ current: boolean }>("DELETE", `/security/sessions/${sid}`);
export const revokeOtherSessions = () => request<{ revoked: number }>("POST", "/security/sessions/revoke-others", {});
export const removeDevice = (id: string) => request<unknown>("DELETE", `/security/devices/${id}`);
export const trustThisBrowser = (days: number) => request<unknown>("POST", "/security/devices/trust", { days });
export const setThemePreference = (theme: "light" | "dark" | "auto") =>
  request<{ theme: "light" | "dark"; themeSource: "auto" | "manual" }>("PUT", "/security/theme", { theme });
export const setPhone = (phone: string, currentPassword: string) =>
  request<{ phone: string | null }>("PUT", "/security/phone", { phone, currentPassword });
export const changePassword = (currentPassword: string, newPassword: string) =>
  request<{
    revokedSessions: number;
    sessionsRevoked: boolean;
    message: string;
  }>("PUT", "/security/password", { currentPassword, newPassword });
