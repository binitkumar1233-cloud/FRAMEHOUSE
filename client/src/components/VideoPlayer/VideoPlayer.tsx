import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Video } from "../../types";
import { Icon } from "../Icon";

const speeds = [0.5, 1, 1.25, 1.5, 2];
const CONTROL_HIDE_DELAY_MS = 2500;
const AUTOPLAY_COUNTDOWN_SECONDS = 10;

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

const FALLBACK_POSTER =
  "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1600&q=90";

type VideoPlayerProps = {
  video: Video;
  startAt?: number;
  /** When true (e.g. daily watch limit reached) playback is paused and can't resume. */
  blocked?: boolean;
  onProgress?: (currentTime: number, duration: number) => void;
  quality?: string | null;
  nextVideo?: Video;
  onAutoPlayNext?: () => void;
};

export function VideoPlayer({
  video,
  startAt = 0,
  blocked = false,
  onProgress,
  quality,
  nextVideo,
  onAutoPlayNext,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [theater, setTheater] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);
  const [selectedCaption, setSelectedCaption] = useState(() => {
    const defaultIndex = video.captions?.findIndex((caption) => caption.default) ?? -1;
    return defaultIndex >= 0 ? String(defaultIndex) : "";
  });
  const hideControlsTimer = useRef<number | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ left: number; time: number } | null>(null);
  const captions = video.captions || [];

  const poster =
    video.thumbnail ||
    video.image ||
    FALLBACK_POSTER;

  useEffect(() => {
    if (blocked) videoRef.current?.pause();
  }, [blocked]);

  useEffect(() => {
    if (!playing || !showControls) return;
    hideControlsTimer.current = window.setTimeout(() => setShowControls(false), CONTROL_HIDE_DELAY_MS);
    return () => {
      if (hideControlsTimer.current !== null) window.clearTimeout(hideControlsTimer.current);
    };
  }, [playing, showControls]);

  useEffect(() => {
    if (autoplayCountdown === null || !nextVideo || !onAutoPlayNext) return;
    const timer = window.setTimeout(
      () => {
        if (autoplayCountdown <= 1) {
          setAutoplayCountdown(null);
          onAutoPlayNext();
        } else {
          setAutoplayCountdown((seconds) => seconds === null ? null : seconds - 1);
        }
      },
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [autoplayCountdown, nextVideo, onAutoPlayNext]);

  const updateBuffered = (player: HTMLVideoElement) => {
    if (!Number.isFinite(player.duration) || player.duration <= 0 || player.buffered.length === 0) {
      setBuffered(0);
      return;
    }
    setBuffered(Math.min(100, (player.buffered.end(player.buffered.length - 1) / player.duration) * 100));
  };

  const adjustVolume = (delta: number) => {
    const player = videoRef.current;
    if (!player) return;
    const nextVolume = Math.max(0, Math.min(1, player.volume + delta));
    player.volume = nextVolume;
    player.muted = nextVolume === 0;
    setVolume(nextVolume);
    setMuted(nextVolume === 0);
  };

  const revealControls = () => {
    setShowControls(true);
    if (hideControlsTimer.current !== null) window.clearTimeout(hideControlsTimer.current);
    if (playing) hideControlsTimer.current = window.setTimeout(() => setShowControls(false), CONTROL_HIDE_DELAY_MS);
  };

  const hidePlayerControls = () => {
    if (hideControlsTimer.current !== null) window.clearTimeout(hideControlsTimer.current);
    setShowControls(false);
  };

  const selectCaption = (index: string) => {
    setSelectedCaption(index);
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      // The native TextTrack API controls which caption stream the browser renders.
      // oxlint-disable-next-line react/immutability
      tracks[trackIndex].mode = String(trackIndex) === index ? "showing" : "disabled";
    }
  };

  const toggleCaptions = () => {
    if (selectedCaption !== "") {
      selectCaption("");
      return;
    }
    const preferredIndex = captions.findIndex((caption) => caption.default);
    selectCaption(String(preferredIndex >= 0 ? preferredIndex : 0));
  };

  const changeSpeed = (nextSpeed: number) => {
    setSpeed(nextSpeed);
    if (videoRef.current) videoRef.current.playbackRate = nextSpeed;
  };

  const togglePlay = async () => {
    const player = videoRef.current;

    if (!player || blocked) return;

    try {
      if (player.paused) {
        await player.play();
      } else {
        player.pause();
      }
    } catch (error) {
      console.error("Unable to play video:", error);
    }
  };

  const seek = (seconds: number) => {
    const player = videoRef.current;

    if (!player) return;

    const newTime = Math.max(
      0,
      Math.min(
        player.duration || 0,
        player.currentTime + seconds
      )
    );

    player.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
    }
  };

  const togglePictureInPicture = async () => {
    const player = videoRef.current as HTMLVideoElement & {
      requestPictureInPicture?: () => Promise<void>;
    };

    if (!player?.requestPictureInPicture) return;

    try {
      await player.requestPictureInPicture();
    } catch (error) {
      console.error("Picture-in-picture error:", error);
    }
  };

  const toggleMute = () => {
    const player = videoRef.current;

    if (!player) return;

    const newMuted = !muted;

    player.muted = newMuted;
    setMuted(newMuted);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.closest("button"))
    ) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    revealControls();
    const key = event.key.toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const interval = event.shiftKey ? 30 : 10;
      seek(event.key === "ArrowLeft" ? -interval : interval);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      adjustVolume(event.key === "ArrowUp" ? 0.05 : -0.05);
    } else if (key === "m") {
      toggleMute();
    } else if (key === "f") {
      void toggleFullscreen();
    } else if (key === "t") {
      setTheater((value) => !value);
    } else if (key === "p") {
      void togglePictureInPicture();
    } else if (key === "c" && captions.length > 0) {
      toggleCaptions();
    } else if (key === "n" && nextVideo && onAutoPlayNext) {
      onAutoPlayNext();
    } else if (event.key === ">" || event.key === "<") {
      const currentIndex = speeds.indexOf(speed);
      const nextIndex = Math.max(0, Math.min(speeds.length - 1, currentIndex + (event.key === ">" ? 1 : -1)));
      changeSpeed(speeds[nextIndex]);
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = videoRef.current;

      if (
        player &&
        !player.paused &&
        Number.isFinite(player.duration)
      ) {
        onProgress?.(
          player.currentTime,
          player.duration
        );
      }
    }, 10000);

    return () => window.clearInterval(interval);
  }, [onProgress]);

  const controlsVisible = showControls || !playing;

  return (
    <div
      ref={containerRef}
      className={`custom-player ${theater ? "is-theater" : ""}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
      onMouseLeave={hidePlayerControls}
    >
    {buffering && <div className="player-loading">Loading video…</div>}

    <video
      ref={videoRef}
      className="custom-player-video"
      tabIndex={0}
      poster={poster}
        autoPlay
        playsInline
        preload="metadata"
        muted={muted}
        onClick={togglePlay}
        onLoadedMetadata={(event) => {
          const player = event.currentTarget;

          setDuration(player.duration);

          if (startAt > 0 && startAt < player.duration - 5) {
            player.currentTime = startAt;
          }
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime);
          updateBuffered(event.currentTarget);
        }}
        onPlay={(event) => {
          if (blocked) {
            event.currentTarget.pause();
            return;
          }
          setAutoplayCountdown(null);
          setPlaying(true);
          // Only one video may play at a time.
          document.querySelectorAll<HTMLVideoElement>("video").forEach((other) => {
            if (other !== event.currentTarget && !other.paused && !other.dataset.previewOnly) other.pause();
          });
        }}
        onPause={() => {
          setPlaying(false);
        }}
        onWaiting={() => {
          setBuffering(true);
        }}
        onProgress={(event) => updateBuffered(event.currentTarget)}
        onCanPlay={() => {
          setBuffering(false);
          if (videoRef.current) updateBuffered(videoRef.current);
        }}
        onEnded={() => {
          setPlaying(false);
          onProgress?.(duration, duration);
          if (nextVideo && onAutoPlayNext) setAutoplayCountdown(AUTOPLAY_COUNTDOWN_SECONDS);
        }}
      >
        <source src={video.videoUrl} type="video/mp4" />
        {captions.map((caption, index) => (
          <track
            key={`${caption.language}-${caption.url}`}
            kind="captions"
            srcLang={caption.language}
            label={caption.label}
            src={caption.url}
            default={caption.default}
            onLoad={(event) => {
              event.currentTarget.track.mode = String(index) === selectedCaption ? "showing" : "disabled";
            }}
          />
        ))}

        Your browser does not support video playback.
      </video>

      {!playing && !buffering && (
        <button className="player-center-play" onClick={togglePlay} aria-label="Play video">
          <Icon name="play" size={26} />
        </button>
      )}

      {autoplayCountdown !== null && nextVideo && (
        <div className="player-autoplay" role="status" aria-live="polite">
          <div>
            <span>Up next in {autoplayCountdown}s</span>
            <strong>{nextVideo.title}</strong>
          </div>
          <button type="button" onClick={() => setAutoplayCountdown(null)}>Cancel</button>
        </div>
      )}

      <div className={`player-controls ${controlsVisible ? "is-visible" : ""}`}>
        <div
          className="player-timeline-wrap"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            setHoverPreview({ left: ratio * rect.width, time: ratio * duration });
            if (previewRef.current && duration > 0 && Number.isFinite(ratio)) {
              previewRef.current.currentTime = ratio * duration;
            }
          }}
          onMouseLeave={() => setHoverPreview(null)}
        >
          {hoverPreview && duration > 0 && (
            <div className="player-preview" style={{ left: hoverPreview.left }} aria-hidden="true">
              <video ref={previewRef} data-preview-only="true" src={video.videoUrl} muted preload="metadata" playsInline />
              <span>{formatTime(hoverPreview.time)}</span>
            </div>
          )}
        <input
          className="player-timeline"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          style={{
            "--progress": `${duration ? (currentTime / duration) * 100 : 0}%`,
            "--buffered": `${buffered}%`,
          } as React.CSSProperties}
          onChange={(event) => {
            const value = Number(event.target.value);

            setCurrentTime(value);

            if (videoRef.current) {
              videoRef.current.currentTime = value;
            }
          }}
          aria-label="Video progress"
        />
        </div>

        <div className="player-control-row">
          <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
            <Icon name={playing ? "pause" : "play"} size={20} />
          </button>

          <button onClick={() => seek(-10)} aria-label="Back 10 seconds" title="Back 10 seconds (←)">
            <Icon name="rewind" size={22} />
          </button>

          <button onClick={() => seek(10)} aria-label="Forward 10 seconds" title="Forward 10 seconds (→)">
            <Icon name="forward" size={22} />
          </button>

          <span className="player-volume">
            <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute (M)" : "Mute (M)"}>
              <Icon name={muted || volume === 0 ? "volume-off" : "volume"} size={20} />
            </button>

            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(event) => {
                const value = Number(event.target.value);

                setVolume(value);
                setMuted(value === 0);

                if (videoRef.current) {
                  videoRef.current.volume = value;
                  videoRef.current.muted = value === 0;
                }
              }}
              aria-label="Volume"
            />
          </span>

          <span className="player-time" aria-label="Playback position">
            {formatTime(currentTime)} <i>/</i> {formatTime(duration)} <i>·</i> -{formatTime(Math.max(0, duration - currentTime))}
          </span>

          <span className="player-spacer" />

          {quality && <span className="player-quality" aria-label={`Video quality ${quality}`}>{quality}</span>}

          <select
            value={speed}
            onChange={(event) => changeSpeed(Number(event.target.value))}
            aria-label="Playback speed"
            title="Playback speed"
          >
            {speeds.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>

          {captions.length > 0 && (
            <select
              value={selectedCaption}
              onChange={(event) => selectCaption(event.target.value)}
              aria-label="Captions"
              title="Captions (C)"
            >
              <option value="">Captions off</option>
              {captions.map((caption, index) => (
                <option key={`${caption.language}-${caption.label}`} value={String(index)}>{caption.label}</option>
              ))}
            </select>
          )}

          <button
            className="player-hide-mobile"
            onClick={() => setTheater((value) => !value)}
            aria-label={theater ? "Exit theater mode" : "Theater mode"}
            aria-pressed={theater}
            title="Theater mode"
          >
            <Icon name="theater" size={20} />
          </button>

          <button className="player-hide-mobile" onClick={togglePictureInPicture} aria-label="Picture in picture" title="Picture in picture">
            <Icon name="pip" size={20} />
          </button>

          <button onClick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
            <Icon name="maximize" size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
