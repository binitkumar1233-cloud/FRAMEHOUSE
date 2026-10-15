import { useCallback, useState } from "react";

import { TestCheckout } from "../components/TestCheckout";
import {
  BillingError,
  formatDate,
  payTestOrder,
  reportCancelled,
  reportFailed,
  startCheckout,
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

  const activeMessage = (subscription: SubscriptionStatus) =>
    `${subscription.plan} plan is active until ${formatDate(subscription.expiryDate)}.`;

  const purchase = useCallback(
    async (plan: PlanName, cycle: Cycle) => {
      if (busyKey) return; // one checkout at a time
      setBusyKey(`${plan}-${cycle}`);

      try {
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
  ) : null;

  return { purchase, busyKey, confirming, checkoutUi };
}
