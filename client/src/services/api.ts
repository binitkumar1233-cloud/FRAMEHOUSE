import type { Plan, User, Video } from "../types";

export const API_ORIGIN = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:5000" : "")).replace(/\/+$/, "");
export const API_URL = `${API_ORIGIN}/api`;
export const RAZORPAY_KEY_ID = "rzp_test_T3SOgapP1w5Izw";

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function authHeaders(token: string, json = false): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${token}`,
  };
}

export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return readResponse<{ success: boolean; token: string; user: User }>(response);
}

export async function register(name: string, email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  return readResponse<{ success: boolean }>(response);
}

export async function getVideos() {
  const response = await fetch(`${API_URL}/videos`);
  return readResponse<{ success: boolean; videos: Video[] }>(response);
}

export async function getSubscription(token: string) {
  const response = await fetch(`${API_URL}/subscription/my-subscription`, {
    headers: authHeaders(token),
  });
  return readResponse<{ success: boolean; subscription: unknown }>(response);
}

export async function getWatchProgress(token: string) {
  const response = await fetch(`${API_URL}/watch-progress`, {
    headers: authHeaders(token),
  });
  return readResponse<{ success: boolean; progress: any[] }>(response);
}

export async function getVideo(videoId: string, token?: string) {
  const response = await fetch(`${API_URL}/videos/${videoId}`, {
    headers: token ? authHeaders(token) : {},
  });
  return readResponse<{ success: boolean; video: Video }>(response);
}

export async function saveWatchProgress(token: string, videoId: string, progress: number, duration: number) {
  const response = await fetch(`${API_URL}/watch-progress`, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify({ videoId, progress, duration }),
  });
  return readResponse(response);
}

export async function createSubscriptionOrder(token: string, plan: Plan["name"]) {
  const response = await fetch(`${API_URL}/subscription/create-order`, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify({ plan }),
  });
  return readResponse<{ success: boolean; order: { amount: number; currency: string; id: string } }>(response);
}

export async function verifySubscriptionPayment(token: string, payment: unknown) {
  const response = await fetch(`${API_URL}/subscription/verify-payment`, {
    method: "POST",
    headers: authHeaders(token, true),
    body: JSON.stringify(payment),
  });
  return readResponse<{ success: boolean; subscription: unknown }>(response);
}
