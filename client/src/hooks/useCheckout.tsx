import { useCallback, useEffect, useState } from "react";

import { TestCheckout } from "../components/TestCheckout";
import {
  BillingError,
  confirmStripe,
  formatDate,
  getProviders,
  payTestOrder,
  reportCancelled,
  reportFailed,
  startCheckout,
  startStripeCheckout,
  verifyPayment,
} from "../services/billing";
import type { CheckoutSession, Cycle, PlanName, SubscriptionStatus } from "../services/billing";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

const CYCLE_LABEL: Record<Cycle, string> = { monthly: "monthly", quarterly: "quarterly", yearly: "yearly" };

/**
 * Runs a purchase end to end: server quote + order, Razorpay Checkout (or the
 * built-in test checkout), verification, and every way it can go wrong.
 */
export function useCheckout({
  onPaid,
  setToast,
}: {
  onPaid: (subscription: SubscriptionStatus) => void;
  setToast: (message: string) => void;
}) {
  const [busyKey, setBusyKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [testSession, setTestSession] = useState<CheckoutSession | null>(null);
  const [chooser, setChooser] = useState<{ plan: PlanName; cycle: Cycle } | null>(null);

  const activeMessage = (subscription: SubscriptionStatus) =>
    `${subscription.plan} plan is active until ${formatDate(subscription.expiryDate)}.`;

  // Returning from Stripe's hosted checkout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("stripe_session");
    const cancelled = params.get("stripe_cancelled");
    if (!sessionId && !cancelled) return;

    window.history.replaceState({}, "", window.location.pathname);
    if (cancelled) {
      setToast("Payment cancelled. You weren't charged.");
      return;
    }

    setConfirming(true);
    confirmStripe(sessionId!)
      .then((result) => {
        onPaid(result.subscription);
        setToast(activeMessage(result.subscription));
      })
      .catch((error) => setToast(error instanceof Error ? error.message : "We couldn't confirm your payment."))
      .finally(() => setConfirming(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const purchase = useCallback(
    async (plan: PlanName, cycle: Cycle, provider?: "razorpay" | "stripe") => {
      if (busyKey) return; // one checkout at a time
      setBusyKey(`${plan}-${cycle}`);

      try {
        let chosen = provider;
        if (!chosen) {
          const providers = await getProviders().catch(() => ({ razorpay: true, stripe: false, test: false }));
          if (providers.stripe && (providers.razorpay || providers.test)) {
            setChooser({ plan, cycle });
            return;
          }
          if (providers.stripe) chosen = "stripe";
        }

        if (chosen === "stripe") {
          const { url } = await startStripeCheckout(plan, cycle);
          window.location.assign(url);
          return;
        }

        const session = await startCheckout(plan, cycle);

        if (session.mode === "test") {
          setTestSession(session);
          return;
        }

        if (!window.Razorpay) {
          throw new BillingError("The payment window couldn't load. Check your connection or turn off ad blockers, then try again.", 0);
        }

        const checkout = new window.Razorpay({
          key: session.keyId,
          amount: session.order.amount,
          currency: session.order.currency,
          order_id: session.order.id,
          name: "Framehouse",
          description: `${plan} plan · ${CYCLE_LABEL[cycle]}`,
          prefill: session.prefill,
          theme: { color: "#2f7bff" },
          retry: { enabled: true },
          modal: {
            confirm_close: true,
            ondismiss: () => {
              void reportCancelled(session.order.id);
              setToast("Payment cancelled. You weren't charged.");
            },
          },
          handler: async (payment: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
            setConfirming(true);
            try {
              const result = await verifyPayment(payment);
              onPaid(result.subscription);
              setToast(activeMessage(result.subscription));
            } catch (error) {
              if (error instanceof BillingError && (error.status === 0 || error.status >= 500)) {
                // Paid, but we couldn't reach the server. The subscription page
                // re-checks with Razorpay, and the webhook also catches it.
                setToast("Payment received. We're still confirming it. Your plan will update shortly.");
              } else {
                setToast(error instanceof Error ? error.message : "We couldn't confirm your payment.");
              }
            } finally {
              setConfirming(false);
            }
          },
        });

        checkout.on("payment.failed", (response: { error?: { description?: string } }) => {
          const reason = response.error?.description || "The payment didn't go through";
          void reportFailed(session.order.id, reason);
          setToast(`${reason}. You can try again with another method.`);
        });

        checkout.open();
      } catch (error) {
        setToast(error instanceof Error ? error.message : "Payment couldn't start. Please try again.");
      } finally {
        setBusyKey("");
      }
    },
    [busyKey, onPaid, setToast]
  );

  const chooserUi = chooser ? (
    <div className="modal-backdrop" key="provider-chooser" onClick={() => setChooser(null)}>
      <div className="confirming-card" role="dialog" aria-label="Choose payment method" onClick={(event) => event.stopPropagation()} style={{ display: "grid", gap: 12, minWidth: 260 }}>
        <strong>Choose payment method</strong>
        <button
          className="primary-button"
          onClick={() => {
            const { plan, cycle } = chooser;
            setChooser(null);
            void purchase(plan, cycle, "stripe");
          }}
        >
          Pay with card (Stripe)
        </button>
        <button
          className="primary-button"
          onClick={() => {
            const { plan, cycle } = chooser;
            setChooser(null);
            void purchase(plan, cycle, "razorpay");
          }}
        >
          UPI, cards &amp; netbanking (Razorpay)
        </button>
        <button className="text-button" onClick={() => setChooser(null)}>Cancel</button>
      </div>
    </div>
  ) : null;

  const checkoutUi = testSession ? (
    <TestCheckout
      key="test-checkout"
      planName={`${testSession.quote.plan} · ${testSession.quote.cycle}`}
      amount={testSession.order.amount / 100}
      credit={testSession.quote.credit}
      onPay={async (outcome, method) => {
        try {
          const result = await payTestOrder(testSession.order.id, outcome, method);
          onPaid(result.subscription);
          return { ok: true, message: activeMessage(result.subscription) };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : "Payment failed." };
        }
      }}
      onClose={() => setTestSession(null)}
    />
  ) : chooserUi;

  return { purchase, busyKey, confirming, checkoutUi };
}
