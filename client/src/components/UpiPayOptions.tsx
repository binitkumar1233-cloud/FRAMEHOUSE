import { useEffect, useState } from "react";
import QRCode from "qrcode";

const APPS = [
  { name: "Google Pay", scheme: "gpay://upi/pay" },
  { name: "PhonePe", scheme: "phonepe://pay" },
  { name: "Paytm", scheme: "paytmmp://pay" },
  { name: "Any UPI app", scheme: "upi://pay" },
];

/** QR code (for scanning from another phone) plus one-tap buttons for the popular UPI apps. */
export function UpiPayOptions({ link }: { link: string }) {
  const [qr, setQr] = useState("");

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(link, { width: 220, margin: 1, color: { dark: "#12163f", light: "#ffffff" } })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(""));
    return () => {
      live = false;
    };
  }, [link]);

  const query = link.slice(link.indexOf("?"));

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {qr && (
        <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <img src={qr} alt="UPI QR code. Scan it with any UPI app to pay." width={180} height={180} style={{ borderRadius: 12, background: "#fff", padding: 6 }} />
          <small style={{ opacity: 0.75 }}>Scan with any UPI app, or pick an app below</small>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {APPS.map((app) => (
          <a key={app.name} className="line-button" href={`${app.scheme}${query}`} style={{ textAlign: "center" }}>
            {app.name}
          </a>
        ))}
      </div>
    </div>
  );
}
