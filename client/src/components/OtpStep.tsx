import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { OtpChallenge } from "../services/security";
import { Icon } from "./Icon";

const REASON_LABEL: Record<string, string> = {
  new_device: "a new device",
  new_browser: "a new browser",
  new_ip: "a new network",
  new_location: "a new location",
  trust_expired: "a browser that is no longer trusted",
};

const useCountdown = (seconds: number, restartKey: unknown) => {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    const end = Date.now() + seconds * 1000;
    setLeft(seconds);
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [seconds, restartKey]);

  return left;
};

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

const clock = (total: number) => `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

type Props = {
  challenge: OtpChallenge;
  busy: boolean;
  /** Resolves to an error message, or null when the code was accepted. */
  onVerify: (code: string, trust: boolean, days: number) => Promise<string | null>;
  /** Resolves to an error message, or null when a new code was sent. */
  onResend: () => Promise<string | null>;
  onCancel: () => void;
};

export function OtpStep({ challenge, busy, onVerify, onResend, onCancel }: Props) {
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [days, setDays] = useState(challenge.trustDefault);
  const [error, setError] = useState("");
  const [sentAt, setSentAt] = useState(0);

  const expiresIn = useCountdown(challenge.expiresInSeconds, sentAt);
  const resendIn = useCountdown(challenge.resendAfterSeconds, sentAt);

  const reasons = challenge.reasons.map((reason) => REASON_LABEL[reason]).filter(Boolean);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setError("");
    const problem = await onVerify(code, trust, days);
    if (problem) {
      setError(problem);
      setCode("");
    }
  };

  const resend = async () => {
    setError("");
    const problem = await onResend();
    if (problem) setError(problem);
    else {
      setCode("");
      setSentAt(Date.now());
    }
  };

  return (
    <div className="otp-step">
      <span className="eyebrow">VERIFY IT'S YOU</span>
      <h2 id="auth-title">Check your email</h2>
      <p className="otp-lead">
        We sent a 6-digit code to <strong>{challenge.maskedEmail}</strong>
        {reasons.length > 0 && <> because this sign-in is from {list(reasons)}</>}.
      </p>

      <form onSubmit={submit} noValidate>
        <label>
          Verification code
          <input
            className="otp-input"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-invalid={Boolean(error)}
            aria-describedby="otp-error"
            autoFocus
          />
        </label>

        <p id="otp-error" className="otp-error" role="alert">
          {error}
        </p>

        <label className="otp-trust">
          <input type="checkbox" checked={trust} onChange={(event) => setTrust(event.target.checked)} />
          <span>
            Trust this browser for{" "}
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={!trust} aria-label="Days to trust this browser">
              {challenge.trustChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice} days
                </option>
              ))}
            </select>
            <small>Skip the code on this browser until then. Only do this on your own device.</small>
          </span>
        </label>

        <button className="primary-button full" type="submit" disabled={busy || expiresIn === 0}>
          {busy ? "Verifying…" : "Verify and sign in"}
        </button>
      </form>

      <div className="otp-foot">
        <span>{expiresIn > 0 ? `Code expires in ${clock(expiresIn)}` : "This code has expired"}</span>
        <button type="button" onClick={resend} disabled={resendIn > 0}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
        </button>
      </div>

      <button type="button" className="otp-back" onClick={onCancel}>
        <Icon name="arrow-left" size={14} /> Use a different account
      </button>
    </div>
  );
}
