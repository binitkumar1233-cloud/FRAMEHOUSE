import { API_URL } from "./api";

async function post<T>(path: string, payload: Record<string, string>): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Password recovery failed. Please try again.");
  }
  return data as T;
}

export const requestPasswordReset = (email: string) =>
  post<{ challengeId: string; message: string; expiresInSeconds: number }>("/auth/password/forgot", { email });

export const resetPassword = (challengeId: string, code: string, newPassword: string) =>
  post<{ message: string }>("/auth/password/reset", { challengeId, code, newPassword });
