import type { View } from "../types";

type SubscriptionCardProps = {
  subscription?: {
    plan?: string;
    status?: string;
  } | null;
  navigate: (view: View) => void;
};

export function SubscriptionCard({
  subscription,
  navigate,
}: SubscriptionCardProps) {
  const isActive = Boolean(subscription);

  return (
    <div className="subscription-card">
      <div className="subscription-card-top">
        <span className="eyebrow">
          CURRENT MEMBERSHIP
        </span>

        {isActive && (
          <span className="status-active">
            <span className="status-dot" />
            Active
          </span>
        )}
      </div>

      <div className="subscription-plan">
        <strong>
          {subscription?.plan || "Free"}
        </strong>
      </div>

      <p>
        {isActive
          ? `Your ${subscription?.plan || ""} membership is active.`
          : "Unlock the full library and premium content."}
      </p>

      <button
        className="line-button"
        onClick={() => navigate(isActive ? "subscription" : "pricing")}
      >
        {isActive
          ? "Manage membership"
          : "Explore plans"}
      </button>
    </div>
  );
}