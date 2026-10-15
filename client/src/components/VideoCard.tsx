import { API_URL } from "../services/api";
import type { User, View, Video } from "../types";
import { motion } from "motion/react";
import { Icon } from "./Icon";
import { BASE } from "./motionTokens";

type VideoCardProps = {
  video: Video;
  large?: boolean;
  user?: User | null;
  subscription?: { plan?: string } | null;
  navigate?: (view: View) => void;
  setToast?: (message: string) => void;
  onClick?: () => void;
};

const FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1200&q=85",
  "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=85",
];

export function VideoCard({
  video,
  large = false,
  user,
  subscription,
  navigate,
  setToast,
  onClick,
}: VideoCardProps) {
  const openProtectedVideo = async () => {
    if (!video._id) {
      setToast?.("This video is not available yet.");
      return;
    }

    const token = localStorage.getItem("token");

    if (!video.premium) {
      setToast?.(`Opening "${video.title}"...`);
      return;
    }

    if (!token || !user) {
      setToast?.("This is a premium video. Please subscribe to watch.");
      navigate?.("pricing");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/videos/${video._id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 403) {
          navigate?.("pricing");
        }

        throw new Error(data.message || "Unable to open video");
      }

      setToast?.(`Opening "${data.video.title}"...`);
    } catch (error) {
      setToast?.(
        error instanceof Error ? error.message : "Unable to open video."
      );
    }
  };

  const handleClick = onClick || openProtectedVideo;

  const fallbackImage =
    FALLBACK_IMAGES[
      Math.abs(
        String(video._id || video.title)
          .split("")
          .reduce((sum, char) => sum + char.charCodeAt(0), 0)
      ) % FALLBACK_IMAGES.length
    ];

  const imageSrc = video.thumbnail || video.image || fallbackImage;
  const viewCount = Number(video.views);
  const viewsLabel = Number.isFinite(viewCount)
    ? viewCount.toLocaleString()
    : "0";

  return (
    <motion.article
      className={`video-card ${large ? "large" : ""}`}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${video.locked ? "Locked: " : ""}${video.title}, ${video.category}${video.duration ? `, ${video.duration}` : ""}${video.premium ? `, ${video.locked ? "premium access required" : "premium video"}` : ""}, ${viewsLabel} views`}
      style={{ cursor: "pointer" }}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0, transition: BASE }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
    >
      <div className="video-image">
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(event) => {
            const image = event.currentTarget;

            if (image.src !== fallbackImage) {
              image.src = fallbackImage;
            }
          }}
        />

        <div className="image-shade" aria-hidden="true" />

        <span
          className="card-play"
          aria-hidden="true"
        >
          <Icon name="play" size={16} />
        </span>

        {(video.premium || video.locked) && (
          <span className={`premium-tag ${video.locked ? "is-locked" : ""}`}>
            {video.accessReason === "exclusive"
              ? "Gold exclusive"
              : video.accessReason === "early-access"
              ? "Early access"
              : video.locked
              ? `${video.requiredPlan || "Premium"}`
              : subscription?.plan
              ? "Included"
              : "Premium"}
          </span>
        )}

        {video.duration && (
          <span className="video-duration">{video.duration}</span>
        )}
      </div>

      <div className="video-meta">
        <div>
          <span>{video.category}</span>
          <h3>{video.title}</h3>
        </div>

        <small>
          {viewsLabel} views
        </small>
      </div>
    </motion.article>
  );
}