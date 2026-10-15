import { useCallback, useEffect, useState } from "react";

import { Icon } from "./Icon";
import {
  formatBytes,
  formatResetIn,
  listDevices,
  listDownloads,
  removeDevice,
  startDownload,
  DownloadError,
} from "../services/downloads";
import type { DownloadDevice, DownloadQuota, DownloadRecord, DownloadStatus } from "../services/downloads";

const STATUS_LABEL: Record<DownloadStatus, string> = {
  authorized: "Starting",
  downloading: "Downloading",
  completed: "Completed",
  interrupted: "Interrupted",
  failed: "Failed",
  blocked: "Blocked",
  expired: "Link expired",
};

const FALLBACK_THUMBNAIL = "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=600&q=80";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export function DownloadsPanel({ onUpgrade, setToast }: { onUpgrade: () => void; setToast: (message: string) => void }) {
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [quota, setQuota] = useState<DownloadQuota | null>(null);
  const [devices, setDevices] = useState<DownloadDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [confirmDevice, setConfirmDevice] = useState("");

  const load = useCallback(async () => {
    try {
      const [downloadData, deviceData] = await Promise.all([listDownloads(), listDevices()]);
      setDownloads(downloadData.downloads);
      setQuota(downloadData.quota);
      setDevices(deviceData.devices);
      setDeviceLimit(deviceData.limit);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Downloads couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Poll while something is in progress so the status updates by itself.
  const inProgress = downloads.some((d) => d.status === "authorized" || d.status === "downloading");
  useEffect(() => {
    if (!inProgress) return;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [inProgress, load]);

  const downloadAgain = async (record: DownloadRecord) => {
    if (!record.videoId) return;
    setBusyId(record.id);
    try {
      const result = await startDownload(record.videoId);
      setToast(result.counted ? "Download started." : "Download started. It didn't use your quota.");
      await load();
    } catch (downloadError) {
      setToast(downloadError instanceof Error ? downloadError.message : "Download couldn't start.");
      if (downloadError instanceof DownloadError && downloadError.quota) setQuota(downloadError.quota);
    } finally {
      setBusyId("");
    }
  };

  const confirmRemoveDevice = async (deviceId: string) => {
    try {
      await removeDevice(deviceId);
      setToast("Device removed.");
      setConfirmDevice("");
      await load();
    } catch (removeError) {
      setToast(removeError instanceof Error ? removeError.message : "Device couldn't be removed.");
    }
  };

  if (loading) {
    return <div className="downloads-loading" aria-busy="true"><div className="loading-line" /><div className="loading-line loading-line-short" /></div>;
  }

  if (error && !quota) {
    return (
      <div className="empty-state">
        <span className="empty-icon"><Icon name="download" size={22} /></span>
        <h2>Downloads couldn't be loaded</h2>
        <p>{error}</p>
        <button className="secondary-button" onClick={() => void load()}>Try again</button>
      </div>
    );
  }

  return (
    <div className="downloads">
      {quota && (
        <section className="quota-card" aria-label="Download quota">
          <div className="quota-head">
            <div>
              <span className="eyebrow">Download quota</span>
              <h2>{quota.remaining} {quota.remaining === 1 ? "download" : "downloads"} left today</h2>
            </div>
            <span className={`plan-chip plan-${quota.plan.toLowerCase()}`}>{quota.plan} plan</span>
          </div>

          <div className="quota-meters">
            <QuotaMeter label="Today" period={quota.daily} />
            <QuotaMeter label="This month" period={quota.monthly} />
          </div>

          {quota.subscriptionExpired && (
            <p className="quota-alert">
              Your subscription has expired, so Free limits apply and premium videos can't be downloaded.{" "}
              <button className="link-inline" onClick={onUpgrade}>Renew plan</button>
            </p>
          )}
          {!quota.subscriptionActive && !quota.subscriptionExpired && (
            <p className="quota-note">
              Free members can download 1 video a day. <button className="link-inline" onClick={onUpgrade}>See plans</button> for more downloads and premium titles.
            </p>
          )}
          {quota.subscriptionActive && quota.subscriptionExpiresAt && (
            <p className="quota-note">Your {quota.plan} plan is active until {new Date(quota.subscriptionExpiresAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.</p>
          )}
        </section>
      )}

      <section className="downloads-section" aria-label="Download devices">
        <div className="downloads-section-head">
          <h3>Download devices</h3>
          <span>{devices.length} of {deviceLimit} registered</span>
        </div>
        {devices.length === 0 ? (
          <p className="downloads-muted">This device is registered automatically the first time you download a video.</p>
        ) : (
          <ul className="device-list">
            {devices.map((device) => (
              <li key={device.deviceId}>
                <span className="device-glyph"><Icon name={device.deviceType === "mobile" ? "video" : "screen"} size={17} /></span>
                <div>
                  <strong>
                    {device.browser || "Browser"} on {device.os || "unknown system"}
                    {device.current && <em className="tag">This device</em>}
                  </strong>
                  <small>Registered {formatDateTime(device.registeredAt)} · last used {formatDateTime(device.lastUsedAt)}</small>
                </div>
                {confirmDevice === device.deviceId ? (
                  <span className="device-confirm">
                    <button className="danger-button small" onClick={() => void confirmRemoveDevice(device.deviceId)}>Remove</button>
                    <button className="text-button" onClick={() => setConfirmDevice("")}>Cancel</button>
                  </span>
                ) : (
                  <button className="text-button" onClick={() => setConfirmDevice(device.deviceId)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="downloads-section" aria-label="Downloaded videos">
        <div className="downloads-section-head">
          <h3>Downloaded videos</h3>
          <button className="text-button" onClick={() => void load()}>Refresh</button>
        </div>

        {downloads.length === 0 ? (
          <div className="empty-state compact">
            <span className="empty-icon"><Icon name="download" size={22} /></span>
            <h2>No downloads yet</h2>
            <p>Use the Download button on any video to save it to this device.</p>
          </div>
        ) : (
          <ul className="download-list">
            {downloads.map((record) => (
              <li key={record.id} className="download-row">
                <img
                  src={record.thumbnail || FALLBACK_THUMBNAIL}
                  alt=""
                  onError={(event) => {
                    if (event.currentTarget.src !== FALLBACK_THUMBNAIL) event.currentTarget.src = FALLBACK_THUMBNAIL;
                  }}
                />
                <div className="download-main">
                  <strong>{record.title || "Deleted video"}</strong>
                  <dl className="download-meta">
                    <div><dt>Requested</dt><dd>{formatDateTime(record.requestedAt)}</dd></div>
                    <div><dt>Size</dt><dd>{formatBytes(record.fileSize)}</dd></div>
                    <div><dt>Plan</dt><dd>{record.plan}</dd></div>
                    <div><dt>Device</dt><dd>{[record.browser, record.os].filter(Boolean).join(" · ") || "—"}</dd></div>
                  </dl>
                  {record.status === "downloading" && record.fileSize ? (
                    <div className="download-progress" aria-label="Progress">
                      <span style={{ width: `${Math.min(100, Math.round((record.bytesSent / record.fileSize) * 100))}%` }} />
                    </div>
                  ) : null}
                  {record.reason && <p className="download-reason">{record.reason}</p>}
                </div>
                <div className="download-side">
                  <span className={`status-pill status-${record.status}`}>{STATUS_LABEL[record.status]}</span>
                  {!record.counted && record.status !== "blocked" && <span className="tag muted">Not counted</span>}
                  {record.videoAvailable && record.status !== "authorized" && record.status !== "downloading" && (
                    <button className="secondary-button small" disabled={busyId === record.id} onClick={() => void downloadAgain(record)}>
                      <Icon name="download" size={14} />
                      {busyId === record.id ? "Starting…" : "Download again"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function QuotaMeter({ label, period }: { label: string; period: DownloadQuota["daily"] }) {
  const percent = period.limit ? Math.min(100, Math.round((period.used / period.limit) * 100)) : 0;
  return (
    <div className="quota-meter">
      <div className="quota-meter-top">
        <span>{label}</span>
        <strong>{period.used} / {period.limit}</strong>
      </div>
      <div className={`quota-bar ${percent >= 100 ? "full" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={period.limit} aria-valuenow={period.used} aria-label={`${label}: ${period.used} of ${period.limit} used`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>Resets {formatResetIn(period.resetsAt)}</small>
    </div>
  );
}
