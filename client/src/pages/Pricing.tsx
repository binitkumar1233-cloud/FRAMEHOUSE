import { useEffect, useState } from "react";

import { AnimatePresence, motion } from "motion/react";
import { Icon } from "../components/Icon";
import { Reveal } from "../components/ScrollEffects";
import { BASE, FAST, stagger } from "../components/motionTokens";
import { formatInr, getPlans } from "../services/billing";
import type { Cycle, PlanCatalog, PlanInfo, PlanName, SubscriptionStatus } from "../services/billing";

const RANK: Record<PlanName, number> = { Free: 0, Bronze: 1, Silver: 2, Gold: 3 };
const qualityLabel = (height: number) => (height >= 2160 ? "4K" : `${height}p`);

const highlights = (plan: PlanInfo, downloadsPerDay?: string) => {
  const l = plan.limits;
  return [
    l.premiumVideosPerMonth === null ? "Unlimited premium videos" : `${l.premiumVideosPerMonth} premium videos a month`,
    l.dailyWatchMinutes === null ? "Unlimited watch time" : `${l.dailyWatchMinutes >= 60 ? `${l.dailyWatchMinutes / 60} ${l.dailyWatchMinutes === 60 ? "hour" : "hours"}` : `${l.dailyWatchMinutes} minutes`} of watching a day`,
    `Streaming up to ${qualityLabel(l.maxQuality)}`,
    downloadsPerDay ? `${downloadsPerDay} for offline viewing` : null,
    l.ads ? "Includes ads" : "Ad-free viewing",
    l.earlyAccess ? "Early access to new releases" : null,
    l.exclusiveContent ? "Exclusive premium courses" : null,
  ].filter(Boolean) as string[];
};

export function Pricing({
  current,
  signedIn,
  busyKey,
  onChoose,
  onManage,
  openAuth,
}: {
  current: SubscriptionStatus | null;
  signedIn: boolean;
  busyKey: string;
  onChoose: (plan: PlanName, cycle: Cycle) => void;
  onManage: () => void;
  openAuth: () => void;
}) {
  const [catalog, setCatalog] = useState<PlanCatalog | null>(null);
  const [error, setError] = useState("");
  const [cycle, setCycle] = useState<Cycle>("monthly");

  useEffect(() => {
    getPlans()
      .then(setCatalog)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Plans couldn't be loaded."));
  }, []);

  if (error) {
    return (
      <div className="page-wrap pricing-page">
        <div className="empty-state"><h2>Plans couldn't be loaded</h2><p>{error}</p></div>
      </div>
    );
  }

  if (!catalog) {
    return <div className="page-wrap pricing-page"><div className="downloads-loading"><div className="loading-line" /><div className="loading-line loading-line-short" /></div></div>;
  }

  const currentPlan: PlanName = current?.active ? current.plan : "Free";
  const downloadsRow = catalog.features.find((f) => f.label === "Downloads");

  const savings = (plan: PlanInfo, target: Cycle) => {
    if (!plan.prices || target === "monthly") return 0;
    const full = plan.prices.monthly * catalog.cycles[target].months;
    return Math.round(((full - plan.prices[target]) / full) * 100);
  };
  const bestSaving = Math.max(...catalog.plans.map((p) => savings(p, "yearly")));

  const actionFor = (plan: PlanInfo) => {
    if (!signedIn) return { label: plan.name === "Free" ? "Sign up free" : `Choose ${plan.name}`, onClick: openAuth, disabled: false };
    if (plan.name === "Free") {
      return currentPlan === "Free"
        ? { label: "Your current plan", onClick: () => undefined, disabled: true }
        : { label: "Switch at renewal", onClick: onManage, disabled: false };
    }
    if (plan.name === currentPlan) return { label: `Renew ${catalog.cycles[cycle].label.toLowerCase()}`, onClick: () => onChoose(plan.name, cycle), disabled: false };
    if (RANK[plan.name] > RANK[currentPlan]) {
      return { label: currentPlan === "Free" ? `Choose ${plan.name}` : `Upgrade to ${plan.name}`, onClick: () => onChoose(plan.name, cycle), disabled: false };
    }
    return { label: `Downgrade to ${plan.name}`, onClick: onManage, disabled: false };
  };

  return (
    <div className="page-wrap pricing-page">
      <div className="center-heading">
        <span className="eyebrow">Membership</span>
        <h1>More to watch.<br /><em>More to feel.</em></h1>
        <p>Start free, upgrade when you want more. Every paid plan unlocks the full premium library.</p>
      </div>

      {current?.active && (
        <div className="pricing-current">
          <span>You're on <strong>{current.plan}</strong> · {current.daysRemaining} days left</span>
          <button className="line-button" onClick={onManage}>Manage subscription<Icon name="arrow-right" size={14} /></button>
        </div>
      )}

      <div className="cycle-toggle" role="radiogroup" aria-label="Billing period">
        {(Object.keys(catalog.cycles) as Cycle[]).map((key) => (
          <button key={key} role="radio" aria-checked={cycle === key} className={cycle === key ? "selected" : ""} onClick={() => setCycle(key)}>
            {catalog.cycles[key].label}
            {key === "yearly" && bestSaving > 0 && <em>Save up to {bestSaving}%</em>}
          </button>
        ))}
      </div>

      <motion.div className="pricing-grid pricing-grid-4" variants={stagger(0.07)} initial="hidden" animate="show">
        {catalog.plans.map((plan) => {
          const action = actionFor(plan);
          const isCurrent = signedIn && plan.name === currentPlan;
          const price = plan.prices?.[cycle] ?? 0;
          const months = catalog.cycles[cycle].months;
          const saving = savings(plan, cycle);
          const busy = busyKey === `${plan.name}-${cycle}`;

          return (
            <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: BASE } }} className={`pricing-card ${plan.popular ? "is-popular" : ""} ${isCurrent ? "is-current" : ""}`} key={plan.name}>
              {plan.popular && !isCurrent && <span className="popular-pill">MOST POPULAR</span>}
              {isCurrent && <span className="popular-pill current-pill">YOUR PLAN</span>}
              <h2>{plan.name}</h2>
              <p>{plan.tagline}</p>

              <div className="plan-price">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.strong key={`${plan.name}-${cycle}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: FAST }} exit={{ opacity: 0, y: -6, transition: FAST }}>{formatInr(price)}</motion.strong>
                </AnimatePresence>
                <span>{plan.prices ? `/ ${months === 1 ? "month" : months === 3 ? "3 months" : "year"}` : "forever"}</span>
              </div>
              <div className="plan-price-note">
                {plan.prices && months > 1 ? `${formatInr(Math.round(price / months))} a month${saving > 0 ? ` · save ${saving}%` : ""}` : plan.prices ? "Billed monthly" : "No card needed"}
              </div>

              <ul>
                {highlights(plan, downloadsRow ? (() => { const n = parseInt(String(downloadsRow.values[plan.name]), 10); return `${n} ${n === 1 ? "download" : "downloads"} a day`; })() : undefined).map((feature) => (
                  <li key={feature}><Icon name="check" size={16} />{feature}</li>
                ))}
              </ul>

              <button
                className={plan.popular && !isCurrent ? "primary-button full" : "secondary-button full"}
                onClick={action.onClick}
                disabled={action.disabled || Boolean(busyKey)}
              >
                {busy ? "Opening checkout…" : action.label}
              </button>
            </motion.div>
          );
        })}
      </motion.div>

      <p className="payment-caption">
        Payments are processed securely by Razorpay. Upgrades use the unused value of your current plan as credit. Plans don't renew automatically.
      </p>

      <Reveal as="section" className="plan-compare" aria-label="Compare plans">
        <h2>Compare plans</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Feature</th>
                {catalog.order.map((name) => <th scope="col" key={name} className={name === currentPlan && signedIn ? "is-current" : ""}>{name}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Price ({catalog.cycles[cycle].label.toLowerCase()})</th>
                {catalog.plans.map((plan) => <td key={plan.name}>{plan.prices ? formatInr(plan.prices[cycle]) : "Free"}</td>)}
              </tr>
              {catalog.features.map((feature) => (
                <tr key={feature.label}>
                  <th scope="row">{feature.label}</th>
                  {catalog.order.map((name) => {
                    const value = feature.values[name];
                    return (
                      <td key={name}>
                        {value === true ? <span className="yes" aria-label="Included"><Icon name="check" size={16} /></span> : value === false ? <span className="no" aria-label="Not included">—</span> : value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal as="section" className="plan-policies" aria-label="Plan policies">
        <h2>How billing works</h2>
        <dl>
          <div><dt>Renewal</dt><dd>{catalog.policies.renewal}</dd></div>
          <div><dt>Upgrades</dt><dd>{catalog.policies.upgrade}</dd></div>
          <div><dt>Downgrades</dt><dd>{catalog.policies.downgrade}</dd></div>
          <div><dt>Cancellation</dt><dd>{catalog.policies.cancellation}</dd></div>
          <div><dt>When a plan ends</dt><dd>{catalog.policies.expiry}</dd></div>
        </dl>
      </Reveal>
    </div>
  );
}
