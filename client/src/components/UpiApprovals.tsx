import { useCallback, useEffect, useState } from "react";

import { decideUpi, getPendingUpi, getUpiSettings, saveUpiSettings } from "../services/billing";
import type { PendingUpi } from "../services/billing";

function UpiSettingsForm({ setToast }: { setToast: (message: string) => void }) {
  const [upiId, setUpiId] = useState("");
  const [payee, setPayee] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getUpiSettings()
      .then((s) => {
        setUpiId(s.upiId);
        setPayee(s.payee);
      })
      .catch(() => undefined);
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveUpiSettings(upiId, payee);
      setToast(upiId ? "UPI payments are now enabled." : "UPI payments turned off.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't save UPI settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-video-form" onSubmit={save}>
      <h2>UPI payment settings</h2>
      <div className="admin-form-grid">
        <label>
          Your UPI ID
          <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourname@okaxis" />
        </label>
        <label>
          Name shown to customers
          <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Framehouse" />
        </label>
      </div>
      <p className="admin-hint">Customers will pay to this UPI ID. Leave it empty to turn UPI off.</p>
      <div className="admin-form-actions">
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save UPI settings"}</button>
      </div>
    </form>
  );
}

export function UpiApprovals({ setToast }: { setToast: (message: string) => void }) {
  const [payments, setPayments] = useState<PendingUpi[]>([]);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(() => {
    getPendingUpi().then(setPayments).catch(() => setToast("Couldn't load UPI payments"));
  }, [setToast]);

  useEffect(load, [load]);

  const decide = async (id: string, decision: "approve" | "reject") => {
    if (decision === "reject" && !window.confirm("Reject this payment?")) return;
    setBusyId(id);
    try {
      await decideUpi(id, decision);
      setToast(decision === "approve" ? "Payment approved. Plan activated." : "Payment rejected.");
      load();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
    <UpiSettingsForm setToast={setToast} />
    <div className="admin-video-list">
      <div className="admin-list-header">
        <h2>UPI payments to verify</h2>
        <span>{payments.length} pending</span>
      </div>
      {payments.length === 0 && <p className="admin-hint">No UPI payments waiting. Match each reference number with your bank/UPI app before approving.</p>}
      {payments.map((payment) => (
        <div className="admin-video-row" key={payment.id}>
          <div className="admin-video-info">
            <h3>₹{payment.amount} · {payment.plan} ({payment.cycle})</h3>
            <p>{payment.user ? `${payment.user.name} · ${payment.user.email}` : "Unknown user"}</p>
            <p>UTR: <b>{payment.reference}</b> · {new Date(payment.createdAt).toLocaleString()}</p>
          </div>
          <div className="admin-actions">
            <button disabled={busyId === payment.id} onClick={() => decide(payment.id, "approve")}>Approve</button>
            <button disabled={busyId === payment.id} onClick={() => decide(payment.id, "reject")}>Reject</button>
          </div>
        </div>
      ))}
    </div>
    </>
  );
}
