import { useCallback, useEffect, useState } from "react";

import { Reveal } from "../components/ScrollEffects";
import {
  cancelSubscription,
  downgradeSubscription,
  formatDate,
  formatInr,
  getBilling,
  getMySubscription,
  getQuote,
  openInvoice,
  reconcile,
  resumeSubscription,
} from "../services/billing";
import type { BillingTransaction, Cycle, PlanName, Quote, SubscriptionStatus } from "../services/billing";

const PLANS: PlanName[] = ["Free", "Bronze", "Silver", "Gold"];
const RANK: Record<PlanName, number> = { Free: 0, Bronze: 1, Silver: 2, Gold: 3 };
const CYCLES: { value: Cycle; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const STATUS_LABEL: Record<SubscriptionStatus["status"], string> = {
  active: "Active",
  cancelled: "Cancelled",
  expired: "Expired",
  none: "Free plan",
};

const TXN_STATUS: Record<BillingTransaction["status"], string> = {
  paid: "Paid",
  created: "Pending",
  failed: "Failed",
  cancelled: "Cancelled",
  expired: "Not completed",
  refunded: "Refunded",
};

const ACTION_LABEL = { new: "New plan", renew: "Renewal", upgrade: "Upgrade" };

const minutes = (seconds: number) => `${Math.floor(seconds / 60)} min`;

export function SubscriptionDashboard({
  refreshKey,
  busyKey,
  onChoose,
  onChanged,
  goToPricing,
  setToast,
}: {
  refreshKey: number;
  busyKey: string;
  onChoose: (plan: PlanName, cycle: Cycle) => void;
  onChanged: (subscription: SubscriptionStatus) => void;
  goToPricing: () => void;
  setToast: (message: string) => void;
}) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [billing, setBilling] = useState<BillingTransaction[]>([]);
  const [loadError, setLoadError] = useState("");
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [upgradeQuotes, setUpgradeQuotes] = useState<Record<string, Quote | string>>({});
  const [confirm, setConfirm] = useState<"" | "cancel" | PlanName>("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      // Picks up payments that finished but never reported back.
      const reconciled = await reconcile().catch(() => null);
      if (reconciled?.applied) setToast("We found and applied a payment that was still being confirmed.");
      const [subscription, transactions] = await Promise.all([getMySubscription(), getBilling()]);
      setStatus(subscription);
      setBilling(transactions);
      setLoadError("");
      if (subscription.cycle) setCycle(subscription.cycle);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Your subscription couldn't be loaded.");
    }
  }, [setToast]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Prices for upgrades, with credit for unused time.
  useEffect(() => {
    if (!status?.active) return;
    const higher = PLANS.filter((plan) => RANK[plan] > RANK[status.plan]);
    let cancelled = false;
    Promise.all(
      higher.map((plan) =>
        getQuote(plan, cycle)
          .then((quote) => [plan, quote] as const)
          .catch((error) => [plan, error instanceof Error ? error.message : "Unavailable"] as const)
      )
    ).then((entries) => {
      if (!cancelled) setUpgradeQuotes(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [status?.active, status?.plan, status?.expiryDate, cycle]);

  const run = async (action: () => Promise<SubscriptionStatus>, message: string) => {
    setWorking(true);
    try {
      const updated = await action();
      setStatus(updated);
      onChanged(updated);
      setToast(message);
      setConfirm("");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "That didn't work. Please try again.");
    } finally {
      setWorking(false);
    }
  };

  if (loadError && !status) {
    return (
      <div className="page-wrap narrow-page">
        <div className="empty-state"><h2>Subscription couldn't be loaded</h2><p>{loadError}</p><button className="secondary-button" onClick={() => void load()}>Try again</button></div>
      </div>
    );
  }

  if (!status) {
    return <div className="page-wrap narrow-page"><div className="downloads-loading"><div className="loading-line" /><div className="loading-line loading-line-short" /></div></div>;
  }

  const periodTotal = status.startDate && status.expiryDate ? new Date(status.expiryDate).getTime() - new Date(status.startDate).getTime() : 0;
  const periodLeft = status.expiryDate ? new Date(status.expiryDate).getTime() - Date.now() : 0;
  const leftPercent = periodTotal > 0 ? Math.max(0, Math.min(100, (periodLeft / periodTotal) * 100)) : 0;
  const lowerPlans = PLANS.filter((plan) => RANK[plan] < RANK[status.plan]);
  const higherPlans = PLANS.filter((plan) => RANK[plan] > RANK[status.plan]);
  const { watch, premiumUnlocks } = status.usage;

  return (
    <div className="page-wrap narrow-page subscription-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Account</span>
          <h1>Subscription.</h1>
          <p>Your plan, what it includes, and your payments.</p>
        </div>
      </div>

      {/* ---------------- Status ---------------- */}
      <Reveal as="section" className="sub-status" aria-label="Current plan">
        <div className="sub-status-head">
          <div>
            <span className="eyebrow">Current plan</span>
            <h2>{status.plan}{status.cycle ? <small> · {CYCLES.find((c) => c.value === status.cycle)?.label}</small> : null}</h2>
          </div>
          <span className={`status-pill sub-${status.status}`}>{STATUS_LABEL[status.status]}</span>
        </div>

        {status.active ? (
          <>
            <div className="sub-validity">
              <div className="quota-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(leftPercent)} aria-label="Time left in this period">
                <span style={{ width: `${leftPercent}%` }} />
              </div>
              <strong>{status.daysRemaining} {status.daysRemaining === 1 ? "day" : "days"} left</strong>
            </div>
            <dl className="sub-facts">
              <div><dt>Started</dt><dd>{formatDate(status.startDate)}</dd></div>
              <div><dt>{status.cancelAtPeriodEnd ? "Ends on" : "Valid until"}</dt><dd>{formatDate(status.expiryDate)}</dd></div>
              <div><dt>Next renewal</dt><dd>{status.cancelAtPeriodEnd ? "Won't renew" : `Renew by ${formatDate(status.nextRenewalDate)}`}</dd></div>
            </dl>
            {status.cancelAtPeriodEnd && (
              <p className="quota-alert">
                {status.pendingPlan && status.pendingPlan !== "Free"
                  ? `You're moving to ${status.pendingPlan} when this plan ends. Subscribe to ${status.pendingPlan} then to continue.`
                  : "Your plan is cancelled. You keep all features until it ends, then move to Free."}{" "}
                <button className="link-inline" disabled={working} onClick={() => void run(resumeSubscription, "Your plan will continue as before.")}>Keep my {status.plan} plan</button>
              </p>
            )}
            {!status.cancelAtPeriodEnd && <p className="quota-note">Plans don't renew automatically. We'll email you 3 days before it ends.</p>}
          </>
        ) : (
          <div className="sub-free">
            <p>
              {status.status === "expired" && status.lastPlan
                ? `Your ${status.lastPlan} plan ended on ${formatDate(status.lastExpiredAt)}. Your watch history and account are all still here.`
                : "You're on the Free plan. Upgrade for unlimited premium videos, higher quality and more downloads."}
            </p>
            <div className="sub-free-actions">
              {status.lastPlan && status.lastPlan !== "Free" && (
                <button className="primary-button" disabled={Boolean(busyKey)} onClick={() => onChoose(status.lastPlan as PlanName, cycle)}>
                  Renew {status.lastPlan}
                </button>
              )}
              <button className={status.lastPlan ? "secondary-button" : "primary-button"} onClick={goToPricing}>Compare plans</button>
            </div>
          </div>
        )}
      </Reveal>

      {/* ---------------- Manage ---------------- */}
      {status.active && (
        <Reveal as="section" className="sub-manage" aria-label="Manage plan">
          <div className="sub-section-head">
            <h3>Manage plan</h3>
            <div className="cycle-toggle compact" role="radiogroup" aria-label="Billing period">
              {CYCLES.map((c) => (
                <button key={c.value} role="radio" aria-checked={cycle === c.value} className={cycle === c.value ? "selected" : ""} onClick={() => setCycle(c.value)}>{c.label}</button>
              ))}
            </div>
          </div>

          <div className="sub-actions">
            <div className="sub-action">
              <div>
                <strong>Renew {status.plan}</strong>
                <small>Adds a {cycle.replace("ly", "")} after {formatDate(status.expiryDate)}.</small>
              </div>
              <button className="secondary-button small" disabled={Boolean(busyKey)} onClick={() => onChoose(status.plan, cycle)}>
                {busyKey === `${status.plan}-${cycle}` ? "Opening…" : "Renew"}
              </button>
            </div>

            {higherPlans.map((plan) => {
              const quote = upgradeQuotes[plan];
              return (
                <div className="sub-action" key={plan}>
                  <div>
                    <strong>Upgrade to {plan}</strong>
                    <small>
                      {!quote
                        ? "Working out your price…"
                        : typeof quote === "string"
                        ? quote
                        : `${formatInr(quote.amount)} today${quote.credit ? ` (${formatInr(quote.credit)} credit for unused ${status.plan} time)` : ""}. Starts now, valid until ${formatDate(quote.periodEnd)}.`}
                    </small>
                  </div>
                  <button className="primary-button small" disabled={Boolean(busyKey) || !quote || typeof quote === "string"} onClick={() => onChoose(plan, cycle)}>
                    {busyKey === `${plan}-${cycle}` ? "Opening…" : "Upgrade"}
                  </button>
                </div>
              );
            })}

            {lowerPlans.length > 0 && !status.cancelAtPeriodEnd && (
              <div className="sub-action">
                <div>
                  <strong>Downgrade</strong>
                  <small>Takes effect when your {status.plan} plan ends on {formatDate(status.expiryDate)}. No charge now.</small>
                </div>
                <div className="sub-inline">
                  {confirm && confirm !== "cancel" ? (
                    <>
                      <button className="secondary-button small" disabled={working} onClick={() => void run(() => downgradeSubscription(confirm), `You'll move to ${confirm} when your ${status.plan} plan ends.`)}>
                        Confirm {confirm}
                      </button>
                      <button className="text-button" onClick={() => setConfirm("")}>Back</button>
                    </>
                  ) : (
                    lowerPlans.map((plan) => (
                      <button key={plan} className="text-button" onClick={() => setConfirm(plan)}>{plan}</button>
                    ))
                  )}
                </div>
              </div>
            )}

            {!status.cancelAtPeriodEnd && (
              <div className="sub-action">
                <div>
                  <strong>Cancel subscription</strong>
                  <small>You keep {status.plan} until {formatDate(status.expiryDate)}. No refunds for partial periods.</small>
                </div>
                {confirm === "cancel" ? (
                  <div className="sub-inline">
                    <button className="danger-button small" disabled={working} onClick={() => void run(cancelSubscription, "Your subscription is cancelled. It stays active until the end date.")}>
                      Yes, cancel
                    </button>
                    <button className="text-button" onClick={() => setConfirm("")}>Keep plan</button>
                  </div>
                ) : (
                  <button className="text-button" onClick={() => setConfirm("cancel")}>Cancel</button>
                )}
              </div>
            )}
          </div>
        </Reveal>
      )}

      {/* ---------------- Features & usage ---------------- */}
      <Reveal as="section" className="sub-features" aria-label="Your features">
        <h3>What your plan includes</h3>
        <ul className="feature-usage">
          <li>
            <span>Premium videos</span>
            <strong>
              {premiumUnlocks.limit === null ? "Unlimited" : `${premiumUnlocks.used} of ${premiumUnlocks.limit} used this month`}
            </strong>
          </li>
          <li>
            <span>Watch time today</span>
            <strong>{watch.limitSeconds === null ? `Unlimited · ${minutes(watch.usedSeconds)} watched` : `${minutes(watch.usedSeconds)} of ${minutes(watch.limitSeconds)}`}</strong>
          </li>
          <li><span>Streaming quality</span><strong>Up to {status.limits.maxQuality >= 2160 ? "4K" : `${status.limits.maxQuality}p`}</strong></li>
          <li><span>Downloads today</span><strong>{status.downloads.daily.used} of {status.downloads.daily.limit}</strong></li>
          <li><span>Ad-free viewing</span><strong className={status.limits.ads ? "off" : "on"}>{status.limits.ads ? "No" : "Yes"}</strong></li>
          <li><span>Early access to new releases</span><strong className={status.limits.earlyAccess ? "on" : "off"}>{status.limits.earlyAccess ? "Yes" : "No"}</strong></li>
          <li><span>Exclusive premium courses</span><strong className={status.limits.exclusiveContent ? "on" : "off"}>{status.limits.exclusiveContent ? "Yes" : "No"}</strong></li>
        </ul>
      </Reveal>

      {/* ---------------- Billing history ---------------- */}
      <Reveal as="section" className="sub-billing" aria-label="Billing history">
        <div className="sub-section-head">
          <h3>Billing history</h3>
          <button className="text-button" onClick={() => void load()}>Refresh</button>
        </div>
        {billing.length === 0 ? (
          <p className="downloads-muted">No payments yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="billing-table">
              <thead>
                <tr><th>Date</th><th>Plan</th><th>Type</th><th className="num">Amount</th><th>Status</th><th>Invoice</th></tr>
              </thead>
              <tbody>
                {billing.map((txn) => (
                  <tr key={txn.id}>
                    <td>{new Date(txn.paidAt || txn.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td>{txn.plan} · {txn.cycle}{txn.mode === "test" ? <em className="tag muted">Test</em> : null}</td>
                    <td>{ACTION_LABEL[txn.action] || "Plan"}</td>
                    <td className="num">{formatInr(txn.amount)}{txn.credit ? <small> after {formatInr(txn.credit)} credit</small> : null}</td>
                    <td><span className={`status-pill txn-${txn.status}`} title={txn.failureReason || undefined}>{TXN_STATUS[txn.status]}</span></td>
                    <td>
                      {txn.invoiceNumber ? (
                        <button className="text-button" onClick={() => openInvoice(txn.id).catch((error) => setToast(error.message))}>{txn.invoiceNumber}</button>
                      ) : (
                        <span className="downloads-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Reveal>
    </div>
  );
}
