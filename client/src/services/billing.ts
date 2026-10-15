import { API_URL } from "./api";

export type PlanName = "Free" | "Bronze" | "Silver" | "Gold";
export type Cycle = "monthly" | "quarterly" | "yearly";

export type PlanLimits = {
  premiumVideosPerMonth: number | null;
  dailyWatchMinutes: number | null;
  maxQuality: number;
  ads: boolean;
  earlyAccess: boolean;
  exclusiveContent: boolean;
};

export type PlanInfo = {
  name: PlanName;
  tagline: string;
  popular: boolean;
  prices: Record<Cycle, number> | null;
  limits: PlanLimits;
};

export type PlanCatalog = {
  order: PlanName[];
  cycles: Record<Cycle, { label: string; months: number }>;
  plans: PlanInfo[];
  features: { label: string; values: Record<PlanName, string | boolean> }[];
  policies: Record<"renewal" | "upgrade" | "downgrade" | "cancellation" | "expiry", string>;
};

export type SubscriptionStatus = {
  plan: PlanName;
  cycle: Cycle | null;
  status: "none" | "active" | "cancelled" | "expired";
  active: boolean;
  startDate: string | null;
  expiryDate: string | null;
  lastPlan: PlanName | null;
  lastExpiredAt: string | null;
  daysRemaining: number;
  nextRenewalDate: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: PlanName | null;
  limits: PlanLimits;
  usage: {
    watch: { usedSeconds: number; limitSeconds: number | null; remainingSeconds: number | null; resetsAt: string };
    premiumUnlocks: { used: number; limit: number | null; remaining: number | null; resetsAt: string };
  };
  downloads: { daily: { limit: number; used: number; remaining: number }; monthly: { limit: number; used: number; remaining: number } };
};

export type Quote = {
  plan: PlanName;
  cycle: Cycle;
  action: "new" | "renew" | "upgrade";
  listPrice: number;
  credit: number;
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
};

export type BillingTransaction = {
  id: string;
  invoiceNumber: string | null;
  plan: string;
  cycle: Cycle;
  action: "new" | "renew" | "upgrade";
  amount: number;
  listPrice: number;
  credit: number;
  currency: string;
  status: "created" | "pending" | "paid" | "failed" | "cancelled" | "expired" | "refunded";
  failureReason: string | null;
  mode: "razorpay" | "stripe" | "upi" | "test";
  orderId: string | null;
  paymentId: string | null;
  method: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  paidAt: string | null;
  emailSent: boolean;
};

export type CheckoutSession = {
  mode: "razorpay" | "test";
  keyId: string | null;
  reused: boolean;
  order: { id: string; amount: number; currency: string };
  quote: Quote;
  prefill: { name: string; email: string };
};

export class BillingError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const request = async <T,>(path: string, init: RequestInit = {}, auth = true): Promise<T> => {
  const token = localStorage.getItem("token");
  if (auth && !token) throw new BillingError("Please sign in first.", 401, "signed-out");

  let response: Response;
  try {
    response = await fetch(`${API_URL}/subscription${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new BillingError("You appear to be offline. Check your connection and try again.", 0, "network");
  }

  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // Not JSON.
  }
  if (!response.ok || data.success === false) {
    throw new BillingError(data.message || "Something went wrong. Please try again.", response.status, data.code);
  }
  return data as T;
};

const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const getPlans = () => request<PlanCatalog & { success: boolean }>("/plans", {}, false);
export const getMySubscription = () => request<{ subscription: SubscriptionStatus }>("/me").then((d) => d.subscription);
export const getBilling = () => request<{ transactions: BillingTransaction[] }>("/billing").then((d) => d.transactions);
export const getQuote = (plan: PlanName, cycle: Cycle) =>
  request<{ quote: Quote }>(`/quote?plan=${encodeURIComponent(plan)}&cycle=${encodeURIComponent(cycle)}`).then((d) => d.quote);
export const startCheckout = (plan: PlanName, cycle: Cycle) => post<CheckoutSession>("/checkout", { plan, cycle });
export const getProviders = () =>
  request<{ providers: { razorpay: boolean; stripe: boolean; upi: boolean; test: boolean } }>("/providers", {}, false).then((d) => d.providers);
export type UpiSession = { transactionId: string; upiId: string; payee: string; amount: number; link: string; note: string };
export const startUpiCheckout = (plan: PlanName, cycle: Cycle) => post<UpiSession>("/checkout/upi", { plan, cycle });
export const submitUpiReference = (transactionId: string, utr: string) =>
  post<{ message?: string }>("/upi/submit", { transactionId, utr });
export type PendingUpi = { id: string; user: { name: string; email: string } | null; plan: string; cycle: string; amount: number; reference: string; createdAt: string };
export const getPendingUpi = () => request<{ payments: PendingUpi[] }>("/admin/upi").then((d) => d.payments);
export const decideUpi = (id: string, decision: "approve" | "reject") => post(`/admin/upi/${id}/${decision}`);
export const getUpiSettings = () => request<{ upiId: string; payee: string }>("/admin/upi-settings");
export const saveUpiSettings = (upiId: string, payee: string) =>
  request<{ upiId: string; payee: string }>("/admin/upi-settings", { method: "PUT", body: JSON.stringify({ upiId, payee }) });
export const startStripeCheckout = (plan: PlanName, cycle: Cycle) => post<{ url: string }>("/checkout/stripe", { plan, cycle });
export const confirmStripe = (sessionId: string) =>
  post<{ subscription: SubscriptionStatus; transaction: BillingTransaction; alreadyProcessed: boolean }>("/stripe/confirm", { sessionId });
export const payTestOrder = (orderId: string, outcome: "success" | "failed", method: string) =>
  post<{ subscription: SubscriptionStatus; transaction: BillingTransaction }>("/test-pay", { orderId, outcome, method });
export const reportFailed = (orderId: string, reason: string) => post("/payment-failed", { orderId, reason }).catch(() => undefined);
export const reportCancelled = (orderId: string) => post("/payment-cancelled", { orderId }).catch(() => undefined);
export const reconcile = () => post<{ applied: number; subscription: SubscriptionStatus }>("/reconcile");
export const cancelSubscription = () => post<{ subscription: SubscriptionStatus }>("/cancel").then((d) => d.subscription);
export const resumeSubscription = () => post<{ subscription: SubscriptionStatus }>("/resume").then((d) => d.subscription);
export const downgradeSubscription = (plan: PlanName) => post<{ subscription: SubscriptionStatus }>("/downgrade", { plan }).then((d) => d.subscription);

type VerifyPayload = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };

/**
 * Confirms a Razorpay payment with the server, retrying through brief
 * network drops. The server ignores repeats, so retrying is safe.
 */
export const verifyPayment = async (payment: VerifyPayload, attempts = 4) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await post<{ subscription: SubscriptionStatus; transaction: BillingTransaction; alreadyProcessed: boolean }>("/verify", payment);
    } catch (error) {
      lastError = error;
      // Only retry when the request didn't reach the server or the server hiccuped.
      if (!(error instanceof BillingError) || (error.status !== 0 && error.status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
};

/** Opens the invoice (needs the auth token, so it's fetched then shown). */
export const openInvoice = async (transactionId: string) => {
  const token = localStorage.getItem("token");
  const popup = window.open("", "_blank");
  const response = await fetch(`${API_URL}/subscription/invoice/${transactionId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    popup?.close();
    throw new BillingError("Invoice couldn't be opened.", response.status);
  }
  const url = URL.createObjectURL(new Blob([await response.text()], { type: "text/html" }));
  if (popup) popup.location.href = url;
  else window.location.assign(url);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

export const formatInr = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "—";
