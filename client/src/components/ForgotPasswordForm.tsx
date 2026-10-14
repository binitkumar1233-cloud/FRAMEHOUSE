import { useState } from "react";
import type { FormEvent } from "react";
import { requestPasswordReset, resetPassword } from "../services/passwordRecovery";

type Props = {
  onBack: () => void;
  onComplete: (message: string) => void;
};

export function ForgotPasswordForm({ onBack, onComplete }: Props) {
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await requestPasswordReset(email.trim());
      setChallengeId(result.challengeId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Couldn't request a reset code.");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await resetPassword(challengeId, code, newPassword);
      setCompleted(true);
      onComplete(result.message);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Couldn't reset your password.");
    } finally {
      setBusy(false);
    }
  };

  if (completed) {
    return (
      <div className="forgot-password-step">
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h2 id="auth-title">Password reset complete</h2>
        <p>Your password has been reset. You can now sign in with your new password.</p>
        <button type="button" className="primary-button full" onClick={onBack}>Back to sign in</button>
      </div>
    );
  }

  return (
    <div className="forgot-password-step">
      <span className="eyebrow">ACCOUNT RECOVERY</span>
      <h2 id="auth-title">{challengeId ? "Choose a new password" : "Reset your password"}</h2>
      {!challengeId ? (
        <>
          <p>Enter your account email and we'll send a reset code if an account matches.</p>
          <form onSubmit={requestCode}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </label>
            {error && <p className="otp-error" role="alert">{error}</p>}
            <button className="primary-button full" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset code"}
            </button>
          </form>
        </>
      ) : (
        <>
          <p>If an account matches that email, a 6-digit reset code has been sent. Check your inbox and spam folder.</p>
          <form onSubmit={submitReset}>
            <label>
              Reset code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
              />
            </label>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            {error && <p className="otp-error" role="alert">{error}</p>}
            <button className="primary-button full" type="submit" disabled={busy}>
              {busy ? "Resetting…" : "Reset password"}
            </button>
          </form>
        </>
      )}
      <button type="button" className="otp-back" onClick={onBack}>Back to sign in</button>
    </div>
  );
}
