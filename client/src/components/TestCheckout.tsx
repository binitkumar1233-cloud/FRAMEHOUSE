import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AnimatePresence, motion } from "motion/react";
import { Icon } from "./Icon";
import { DialogMotion } from "./Motion";
import { DrawnMark } from "./PathDrawing";
import { FAST } from "./motionTokens";

type Method = "card" | "upi";
type Outcome = "success" | "failed";

const SUCCESS_CARD = "4111111111111111";
const DECLINE_CARD = "4000000000000002";

const formatCard = (value: string) =>
  value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");

const formatExpiry = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
};

const expiryValid = (value: string) => {
  const match = value.match(/^(\d{2})\/(\d{2})$/);
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
};

/**
 * Stand-in checkout for local testing when Razorpay keys aren't working.
 * It never contacts a payment provider and never charges anyone.
 */
export function TestCheckout({
  planName,
  amount,
  credit = 0,
  onPay,
  onClose,
}: {
  planName: string;
  amount: number;
  credit?: number;
  onPay: (outcome: Outcome, method: Method) => Promise<{ ok: boolean; message?: string }>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<Method>("card");
  const [card, setCard] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [name, setName] = useState("");
  const [upi, setUpi] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !processing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [method, onClose, processing]);

  const fillTestDetails = () => {
    if (method === "card") {
      setCard(formatCard(SUCCESS_CARD));
      setExpiry("12/30");
      setCvv("123");
      setName("Test User");
    } else {
      setUpi("success@test");
    }
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    let outcome: Outcome;
    if (method === "card") {
      const digits = card.replace(/\s/g, "");
      if (digits.length !== 16) return setError("Enter the 16-digit test card number.");
      if (!expiryValid(expiry)) return setError("Enter a future expiry date as MM/YY.");
      if (!/^\d{3}$/.test(cvv)) return setError("Enter a 3-digit CVV.");
      if (!name.trim()) return setError("Enter the name on the card.");
      if (digits === SUCCESS_CARD) outcome = "success";
      else if (digits === DECLINE_CARD) outcome = "failed";
      else return setError("Use a test card: 4111 1111 1111 1111 to succeed, or 4000 0000 0000 0002 to decline.");
    } else {
      const id = upi.trim().toLowerCase();
      if (id === "success@test") outcome = "success";
      else if (id === "failure@test") outcome = "failed";
      else return setError("Use success@test to succeed, or failure@test to decline.");
    }

    setProcessing(true);
    // A short pause so the flow feels like a real payment step.
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    const response = await onPay(outcome, method);
    setProcessing(false);
    setResult({
      ok: response.ok,
      message: response.message || (response.ok ? `${planName} plan activated.` : "Payment declined."),
    });
  };

  return (
    <DialogMotion className="test-checkout" onBackdrop={() => !processing && onClose()} labelledBy="test-checkout-title">
        <div className="test-checkout-banner">
          <Icon name="shield" size={14} />
          Test mode: no real payment is made and no money is charged.
        </div>

        <div className="test-checkout-head">
          <div>
            <span className="eyebrow">Framehouse membership</span>
            <h2 id="test-checkout-title">{planName}</h2>
          </div>
          <div className="test-checkout-amount">
            <strong>₹{amount}</strong>
            <span>{credit > 0 ? `after ₹${credit} credit` : "incl. all charges"}</span>
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
        {result ? (
          <motion.div key="result" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1, transition: FAST }} className={`test-checkout-result ${result.ok ? "ok" : "failed"}`} role="status">
            <span className="result-icon"><DrawnMark kind={result.ok ? "success" : "failed"} size={72} /></span>
            <h3>{result.ok ? "Payment successful" : "Payment failed"}</h3>
            <p>{result.message}</p>
            <div className="test-checkout-actions">
              {!result.ok && (
                <button type="button" className="secondary-button" onClick={() => setResult(null)}>Try again</button>
              )}
              <button type="button" className="primary-button" onClick={onClose}>{result.ok ? "Done" : "Close"}</button>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: FAST }} exit={{ opacity: 0, transition: FAST }} onSubmit={(event) => void submit(event)} noValidate>
            <div className="test-checkout-tabs" role="tablist" aria-label="Payment method">
              <button type="button" role="tab" aria-selected={method === "card"} className={method === "card" ? "selected" : ""} onClick={() => { setMethod("card"); setError(""); }}>
                Card
              </button>
              <button type="button" role="tab" aria-selected={method === "upi"} className={method === "upi" ? "selected" : ""} onClick={() => { setMethod("upi"); setError(""); }}>
                UPI
              </button>
            </div>

            {method === "card" ? (
              <div className="test-checkout-fields">
                <label>
                  Card number
                  <input ref={firstFieldRef} id="test-card-number" inputMode="numeric" autoComplete="off" placeholder="4111 1111 1111 1111" value={card} onChange={(event) => setCard(formatCard(event.target.value))} />
                </label>
                <div className="field-row">
                  <label>
                    Expiry
                    <input id="test-card-expiry" inputMode="numeric" autoComplete="off" placeholder="MM/YY" value={expiry} onChange={(event) => setExpiry(formatExpiry(event.target.value))} />
                  </label>
                  <label>
                    CVV
                    <input id="test-card-cvv" inputMode="numeric" autoComplete="off" placeholder="123" maxLength={3} value={cvv} onChange={(event) => setCvv(event.target.value.replace(/\D/g, "").slice(0, 3))} />
                  </label>
                </div>
                <label>
                  Name on card
                  <input id="test-card-name" autoComplete="off" placeholder="Test User" value={name} onChange={(event) => setName(event.target.value)} />
                </label>
              </div>
            ) : (
              <div className="test-checkout-fields">
                <label>
                  UPI ID
                  <input ref={firstFieldRef} id="test-upi-id" autoComplete="off" placeholder="success@test" value={upi} onChange={(event) => setUpi(event.target.value)} />
                </label>
              </div>
            )}

            <div className="test-checkout-help">
              <strong>Test details</strong>
              {method === "card" ? (
                <span>Success: 4111 1111 1111 1111 · Decline: 4000 0000 0000 0002 · any future expiry, any CVV</span>
              ) : (
                <span>Success: success@test · Decline: failure@test</span>
              )}
              <button type="button" className="link-inline" onClick={fillTestDetails}>Fill test details</button>
            </div>

            {error && <p className="test-checkout-error" role="alert">{error}</p>}

            <div className="test-checkout-actions">
              <button type="button" className="secondary-button" onClick={onClose} disabled={processing}>Cancel</button>
              <button type="submit" className="primary-button" disabled={processing}>
                {processing ? "Processing…" : `Pay ₹${amount}`}
              </button>
            </div>
          </motion.form>
        )}
        </AnimatePresence>
    </DialogMotion>
  );
}
