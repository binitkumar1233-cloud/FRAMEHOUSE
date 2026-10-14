import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "../components/Icon";
import {
  getDevices,
  getHistory,
  getOverview,
  getSessions,
  changePassword,
  removeDevice,
  revokeOtherSessions,
  revokeSession,
  setPhone,
  trustThisBrowser,
} from "../services/security";
import type {
  LoginRecord,
  SecurityEvent,
  SecurityOverview,
  SecuritySession,
  TrustedDeviceInfo,
} from "../services/security";

const EVENT: Record<SecurityEvent, { label: string; tone: "good" | "bad" | "info" }> = {
  login_success: { label: "Signed in", tone: "good" },
  login_failed: { label: "Failed sign-in", tone: "bad" },
  login_blocked: { label: "Sign-in blocked", tone: "bad" },
  password_changed: { label: "Password changed", tone: "info" },
  otp_sent: { label: "Code sent", tone: "info" },
  otp_verified: { label: "Code verified", tone: "good" },
  otp_failed: { label: "Wrong code", tone: "bad" },
  otp_locked: { label: "Code locked", tone: "bad" },
  otp_expired: { label: "Code expired", tone: "bad" },
  device_trusted: { label: "Browser trusted", tone: "info" },
  device_revoked: { label: "Trust removed", tone: "info" },
  session_revoked: { label: "Session ended", tone: "info" },
  logout: { label: "Signed out", tone: "info" },
};

const REASON: Record<string, string> = {
  new_device: "new device",
  new_browser: "new browser",
  new_ip: "new IP",
  new_location: "new location",
  trust_expired: "trust ended",
};

const deviceIcon = (type?: string) => (type === "mobile" ? "phone" : type === "tablet" ? "tablet" : "monitor");

const describe = (item: { browserName?: string; browserVersion?: string; os?: string }) => {
  const version = item.browserVersion ? ` ${item.browserVersion.split(".")[0]}` : "";
  const browser = item.browserName && item.browserName !== "Unknown" ? `${item.browserName}${version}` : "Unknown browser";
  return item.os && item.os !== "Unknown" ? `${browser} on ${item.os}` : browser;
};

const deviceLine = (item: { deviceType?: string; deviceModel?: string }) =>
  [item.deviceType ? item.deviceType.charAt(0).toUpperCase() + item.deviceType.slice(1) : "", item.deviceModel].filter(Boolean).join(" · ");

const ago = (iso: string) => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

type Filter = "all" | "success" | "failed";

export default function AccountSecurity({
  setToast,
  onSignedOut,
}: {
  setToast: (message: string) => void;
  onSignedOut: () => void;
}) {
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [devices, setDevices] = useState<TrustedDeviceInfo[]>([]);
  const [records, setRecords] = useState<LoginRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [trustDays, setTrustDays] = useState(30);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [phonePassword, setPhonePassword] = useState("");

  const loadAll = useCallback(async () => {
    try {
      const [o, s, d] = await Promise.all([getOverview(), getSessions(), getDevices()]);
      setOverview(o);
      setSessions(s.sessions);
      setDevices(d.devices);
      setTrustDays(o.trustDefault);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Couldn't load your security details.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const h = await getHistory(filter, page);
      setRecords(h.records);
      setPages(h.pages);
    } catch {
      setToast("Couldn't load your sign-in history.");
    }
  }, [filter, page, setToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const run = async (key: string, action: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const message = await action();
      if (message) setToast(message);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "That didn't work. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const endSession = (session: SecuritySession) =>
    run(session.sid, async () => {
      if (!window.confirm(session.current ? "Sign out of this browser?" : `Sign out ${describe(session)}?`)) return;
      const result = await revokeSession(session.sid);
      if (result.current) {
        onSignedOut();
        return;
      }
      await Promise.all([loadAll(), loadHistory()]);
      return "That session was signed out.";
    });

  const endOthers = () =>
    run("others", async () => {
      if (!window.confirm("Sign out of every other browser and device?")) return;
      const result = await revokeOtherSessions();
      await Promise.all([loadAll(), loadHistory()]);
      return result.revoked ? `Signed out ${result.revoked} other session${result.revoked === 1 ? "" : "s"}.` : "There were no other sessions.";
    });

  const untrust = (device: TrustedDeviceInfo) =>
    run(device._id, async () => {
      if (!window.confirm("Stop trusting this browser? It will ask for a code next time.")) return;
      await removeDevice(device._id);
      await Promise.all([loadAll(), loadHistory()]);
      return "Trust removed.";
    });

  const trustCurrent = () =>
    run("trust", async () => {
      await trustThisBrowser(trustDays);
      await Promise.all([loadAll(), loadHistory()]);
      return `This browser is trusted for ${trustDays} days.`;
    });

  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setToast("New passwords do not match.");
      return;
    }
    setBusy("password");
    try {
      const result = await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setToast(result.message);
      await Promise.all([loadAll(), loadHistory()]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't change your password. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const submitPhone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("phone");
    try {
      const result = await setPhone(phoneInput, phonePassword);
      setPhoneInput("");
      setPhonePassword("");
      setToast(result.phone ? "Mobile number saved. Sign-in codes will be texted to it." : "Mobile number removed.");
      await loadAll();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't update your mobile number. Please try again.");
    } finally {
      setBusy("");
    }
  };

  const currentTrusted = devices.some((device) => device.current);
  const others = sessions.filter((session) => !session.current).length;

  if (loading) {
    return (
      <div className="page-wrap narrow-page">
        <div className="sec-skeleton" aria-busy="true" aria-label="Loading security details" />
      </div>
    );
  }

  if (loadError || !overview) {
    return (
      <div className="page-wrap narrow-page">
        <div className="empty-state">
          <h2>We couldn't load this page</h2>
          <p>{loadError}</p>
          <button className="primary-button" onClick={() => { setLoading(true); void loadAll(); }}>Try again</button>
        </div>
      </div>
    );
  }

  const last = overview.lastLogin;

  return (
    <div className="page-wrap sec-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h1>Account security.</h1>
        </div>
      </div>

      <p className="sec-intro">
        Review where your account is signed in and every sign-in attempt. We send a code to <strong>{overview.email}</strong>{overview.phone && <> and <strong>{overview.phone}</strong></>} when
        a sign-in comes from a new browser, device, IP address, or city.
      </p>

      <div className="sec-stats">
        <div><span>Active sessions</span><strong>{overview.activeSessions}</strong></div>
        <div><span>Trusted browsers</span><strong>{overview.trustedDevices}</strong></div>
        <div className={overview.failedLast30Days ? "warn" : ""}><span>Failed attempts, 30 days</span><strong>{overview.failedLast30Days}</strong></div>
        <div>
          <span>Previous sign-in</span>
          <strong className="sec-stat-text">{last ? ago(last.createdAt) : "None yet"}</strong>
          {last && <small>{last.location || "Unknown location"}</small>}
        </div>
      </div>

      <section className="sec-card" aria-labelledby="sec-phone">
        <header>
          <div>
            <h2 id="sec-phone">Mobile number</h2>
            <p>
              {overview.phone
                ? <>Sign-in codes are also texted to <strong>{overview.phone}</strong>. Leave the number empty to remove it.</>
                : "Add a mobile number to receive sign-in codes by text as well as email."}
            </p>
          </div>
        </header>
        <form className="sec-password-form" onSubmit={submitPhone}>
          <label>
            Mobile number
            <input
              type="tel"
              name="phone"
              autoComplete="tel"
              placeholder="+919876543210"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              required={!overview.phone}
            />
          </label>
          <label>
            Current password
            <input
              type="password"
              name="phonePassword"
              autoComplete="current-password"
              value={phonePassword}
              onChange={(event) => setPhonePassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy === "phone"}>
            {busy === "phone" ? "Saving…" : overview.phone && !phoneInput.trim() ? "Remove number" : "Save number"}
          </button>
        </form>
      </section>

      <section className="sec-card" aria-labelledby="sec-password">
        <header>
          <div>
            <h2 id="sec-password">Change password</h2>
            <p>Choose a new password. Other signed-in browsers will be signed out.</p>
          </div>
        </header>
        <form className="sec-password-form" onSubmit={submitPasswordChange}>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="newPassword"
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
              name="confirmPassword"
              autoComplete="new-password"
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy === "password"}>
            {busy === "password" ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="sec-card" aria-labelledby="sec-sessions">
        <header>
          <div>
            <h2 id="sec-sessions">Where you're signed in</h2>
            <p>Sign out any browser you don't recognise.</p>
          </div>
          <button className="line-button" onClick={endOthers} disabled={others === 0 || busy === "others"}>
            Sign out other sessions
          </button>
        </header>
        <ul className="sec-list">
          {sessions.map((session) => (
            <li key={session.sid}>
              <span className="sec-icon"><Icon name={deviceIcon(session.deviceType)} size={20} /></span>
              <div className="sec-main">
                <strong>
                  {describe(session)} {session.current && <em className="sec-badge">This device</em>}
                </strong>
                <small>{[deviceLine(session), session.ip, session.location].filter(Boolean).join(" · ")}</small>
                <small>Signed in {stamp(session.createdAt)} · active {ago(session.lastSeenAt)}</small>
              </div>
              <button className="sec-action" onClick={() => endSession(session)} disabled={busy === session.sid}>
                Sign out
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="sec-card" aria-labelledby="sec-devices">
        <header>
          <div>
            <h2 id="sec-devices">Trusted browsers</h2>
            <p>Trusted browsers skip the email code until the date shown.</p>
          </div>
          {!currentTrusted && (
            <div className="sec-trust">
              <select value={trustDays} onChange={(event) => setTrustDays(Number(event.target.value))} aria-label="Days to trust this browser">
                {overview.trustChoices.map((choice) => (
                  <option key={choice} value={choice}>{choice} days</option>
                ))}
              </select>
              <button className="line-button" onClick={trustCurrent} disabled={busy === "trust"}>Trust this browser</button>
            </div>
          )}
        </header>
        {devices.length === 0 ? (
          <p className="sec-empty">No trusted browsers. You'll get an email code on every new sign-in.</p>
        ) : (
          <ul className="sec-list">
            {devices.map((device) => (
              <li key={device._id}>
                <span className="sec-icon"><Icon name={deviceIcon(device.deviceType)} size={20} /></span>
                <div className="sec-main">
                  <strong>
                    {device.label || "Browser"} {device.current && <em className="sec-badge">This device</em>}
                  </strong>
                  <small>{[deviceLine(device), device.ip, device.location].filter(Boolean).join(" · ")}</small>
                  <small>Trusted until {day(device.expiresAt)}{device.lastUsedAt ? ` · last used ${ago(device.lastUsedAt)}` : ""}</small>
                </div>
                <button className="sec-action" onClick={() => untrust(device)} disabled={busy === device._id}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sec-card" aria-labelledby="sec-history">
        <header>
          <div>
            <h2 id="sec-history">Sign-in activity</h2>
            <p>Every attempt, code and change, newest first. Times are in IST.</p>
          </div>
          <div className="sec-filter" role="tablist" aria-label="Filter activity">
            {(["all", "success", "failed"] as Filter[]).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                className={filter === value ? "selected" : ""}
                onClick={() => { setFilter(value); setPage(1); }}
              >
                {value === "all" ? "All" : value === "success" ? "Successful" : "Failed"}
              </button>
            ))}
          </div>
        </header>

        {records.length === 0 ? (
          <p className="sec-empty">Nothing to show here yet.</p>
        ) : (
          <ul className="sec-log">
            {records.map((record) => {
              const meta = EVENT[record.event] || { label: record.event, tone: "info" as const };
              return (
                <li key={record._id}>
                  <span className={`sec-dot ${meta.tone}`} aria-hidden="true" />
                  <div className="sec-log-main">
                    <strong>
                      {meta.label}
                      {record.reasons?.length > 0 && (
                        <span className="sec-reasons">{record.reasons.map((reason) => REASON[reason] || reason).join(", ")}</span>
                      )}
                    </strong>
                    <small>{stamp(record.createdAt)}</small>
                  </div>
                  <div className="sec-log-device">
                    <span>{describe(record)}</span>
                    <small>{deviceLine(record) || "—"}</small>
                  </div>
                  <div className="sec-log-where">
                    <span>{record.location || "Unknown location"}</span>
                    <small>{record.ip || "—"}</small>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {pages > 1 && (
          <footer className="sec-pager">
            <button className="line-button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className="line-button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>Next</button>
          </footer>
        )}
      </section>
    </div>
  );
}
