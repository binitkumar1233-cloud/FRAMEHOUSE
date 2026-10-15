import { useCallback, useEffect, useState } from "react";

import { TestCheckout } from "../components/TestCheckout";
import { UpiPayOptions } from "../components/UpiPayOptions";
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
  startUpiCheckout,
  submitUpiReference,
  verifyPayment,
} from "../services/billing";
import type { CheckoutSession, Cycle, PlanName, SubscriptionStatus, UpiSession } from "../services/billing";

type Provider = "razorpay" | "stripe" | "upi";
const PROVIDER_LABEL: Record<Provider, string> = {
  razorpay: "UPI, cards & netbanking (Razorpay)",
  stripe: "Pay with card (Stripe)",
  upi: "Pay by UPI app (manual confirmation)",
};

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
  const [chooser, setChooser] = useState<{ plan: PlanName; cycle: Cycle; options: Provider[] } | null>(null);
  const [upi, setUpi] = useState<{ session: UpiSession; utr: string; saving: boolean; error: string; done: boolean } | null>(null);

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
    async (plan: PlanName, cycle: Cycle, provider?: Provider) => {
      if (busyKey) return; // one checkout at a time
      setBusyKey(`${plan}-${cycle}`);

      try {
        let chosen = provider;
        if (!chosen) {
          const providers = await getProviders().catch(() => ({ razorpay: true, stripe: false, upi: false, test: false }));
          const options: Provider[] = [];
          if (providers.razorpay || providers.test) options.push("razorpay");
          if (providers.stripe) options.push("stripe");
          if (providers.upi) options.push("upi");
          if (options.length === 0) {
            throw new BillingError("Payments aren't set up yet. The site owner needs to add a payment method (UPI ID, Razorpay or Stripe) in the Admin Panel.", 503);
          }
          if (options.length > 1) {
            setChooser({ plan, cycle, options });
            return;
          }
          chosen = options[0];
        }

        if (chosen === "stripe") {
          const { url } = await startStripeCheckout(plan, cycle);
          window.location.assign(url);
          return;
        }

        if (chosen === "upi") {
          setUpi({ session: await startUpiCheckout(plan, cycle), utr: "", saving: false, error: "", done: false });
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
      <div className="pay-dialog" role="dialog" aria-label="Choose payment method" onClick={(event) => event.stopPropagation()}>
        <strong>Choose payment method</strong>
        {chooser.options.map((option) => (
          <button
            key={option}
            className="primary-button"
            onClick={() => {
              const { plan, cycle } = chooser;
              setChooser(null);
              void purchase(plan, cycle, option);
            }}
          >
            {PROVIDER_LABEL[option]}
          </button>
        ))}
        <button className="text-button" onClick={() => setChooser(null)}>Cancel</button>
      </div>
    </div>
  ) : null;

  const upiUi = upi ? (
    <div className="modal-backdrop" key="upi-checkout" onClick={() => !upi.saving && setUpi(null)}>
      <div className="pay-dialog" role="dialog" aria-label="Pay by UPI" onClick={(event) => event.stopPropagation()}>
        {upi.done ? (
          <>
            <strong>Payment submitted</strong>
            <p>Thanks! Your plan will be activated as soon as we verify the payment. You'll see it on your subscription page.</p>
            <button className="primary-button" onClick={() => setUpi(null)}>Done</button>
          </>
        ) : (
          <>
            <strong>Pay ₹{upi.session.amount} by UPI</strong>
            <p style={{ margin: 0 }}>Pay to <b>{upi.session.upiId}</b> ({upi.session.payee}).</p>
            <UpiPayOptions link={upi.session.link} />
            <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>After paying, enter the UPI reference / UTR number from your payment app.</p>
            <input
              value={upi.utr}
              onChange={(event) => setUpi({ ...upi, utr: event.target.value, error: "" })}
              placeholder="UPI reference / UTR number"
              aria-label="UPI reference number"
              autoCapitalize="characters"
            />
            {upi.error && <p role="alert" style={{ color: "#ff8b95", margin: 0 }}>{upi.error}</p>}
            <button
              className="primary-button"
              disabled={upi.saving || !upi.utr.trim()}
              onClick={async () => {
                setUpi({ ...upi, saving: true, error: "" });
                try {
                  await submitUpiReference(upi.session.transactionId, upi.utr);
                  setUpi({ ...upi, saving: false, done: true });
                } catch (error) {
                  setUpi({ ...upi, saving: false, error: error instanceof Error ? error.message : "Couldn't submit. Try again." });
                }
              }}
            >
              {upi.saving ? "Submitting…" : "I've paid"}
            </button>
            <button className="text-button" onClick={() => setUpi(null)}>Cancel</button>
          </>
        )}
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
  ) : upiUi ?? chooserUi;

  return { purchase, busyKey, confirming, checkoutUi };
}
