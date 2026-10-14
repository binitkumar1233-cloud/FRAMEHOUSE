import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import "./VideoMeeting.css";
import { Icon } from "../components/Icon";
import { useSpeaking } from "../hooks/useSpeaking";
import { useWebRTC } from "../hooks/useWebRTC";
import type {
  ChatAttachment,
  ChatMessage,
  ConnectionQuality,
  HostAction,
  MediaDeviceGroups,
  MediaIssues,
  MeetingInfo,
  Participant,
  PeerStats,
  Role,
} from "../hooks/useWebRTC";
import { downloadBlob, MeetingRecorder, recordingSupported } from "../utils/meetingRecorder";

type VideoMeetingProps = {
  roomId: string;
  onLeave?: () => void;
};

type ActivePanel = "none" | "participants" | "chat" | "devices";

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ACCEPTED_FILES = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
const EMOJIS = ["👍", "👏", "🙌", "😀", "😂", "😍", "🤔", "😮", "🎉", "🔥", "❤️", "✅", "👀", "🙏", "💯", "🚀", "😅", "😢", "👋", "☕", "💡", "📌", "⏰", "🤝"];

const roleLabel = (role?: Role) => (role === "host" ? "Host" : role === "co-host" ? "Co-host" : "");

const qualityLabel: Record<ConnectionQuality, string> = {
  excellent: "Excellent connection",
  good: "Good connection",
  poor: "Poor connection",
  reconnecting: "Reconnecting…",
};

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
};

const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// ============================================================
// MAIN
// ============================================================

export default function VideoMeeting({ roomId, onLeave }: VideoMeetingProps) {
  const rtc = useWebRTC();
  const {
    status,
    statusMessage,
    self,
    participants,
    remoteStreams,
    peerStats,
    chatMessages,
    meeting,
    notice,
    connectionQuality,
    canModerate,
    localStream,
    micEnabled,
    cameraEnabled,
    screenSharing,
    handRaised,
    mediaIssues,
    joinRoom,
    leaveRoom,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    startScreenShare,
    stopScreenShare,
    toggleRaiseHand,
    hostAction,
    setRecordingActive,
  } = rtc;

  const [activePanel, setActivePanel] = useState<ActivePanel>("none");
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [leaveMenuOpen, setLeaveMenuOpen] = useState(false);
  const [visibleNotice, setVisibleNotice] = useState(notice);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [recordingLocally, setRecordingLocally] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [inviteDismissed, setInviteDismissed] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const seenMessagesRef = useRef(0);

  // ---------- join / leave ----------
  useEffect(() => {
    if (!roomId) return;
    void joinRoom(roomId);
    return () => leaveRoom();
  }, [roomId, joinRoom, leaveRoom]);

  // ---------- timer (from when the meeting started, so it survives refresh) ----------
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedSeconds = meeting?.startedAt ? Math.floor((now - new Date(meeting.startedAt).getTime()) / 1000) : 0;

  // ---------- notices ----------
  useEffect(() => {
    if (!notice) return;
    setVisibleNotice(notice);
    const timer = window.setTimeout(() => setVisibleNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ---------- unread chat ----------
  useEffect(() => {
    if (activePanel === "chat") {
      seenMessagesRef.current = chatMessages.length;
      setUnreadCount(0);
    } else {
      setUnreadCount(Math.max(0, chatMessages.length - seenMessagesRef.current));
    }
  }, [activePanel, chatMessages.length]);

  // Messages loaded from history on join shouldn't count as unread.
  useEffect(() => {
    if (status === "joined" && seenMessagesRef.current === 0) {
      seenMessagesRef.current = chatMessages.length;
      setUnreadCount(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // ---------- recording ----------
  const stopLocalRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecordingLocally(false);
    const blob = await recorder.stop();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadBlob(blob, `Framehouse-${roomId}-${stamp}.${recorder.extension}`);
  }, [roomId]);

  const toggleRecording = async () => {
    if (recordingLocally) {
      await stopLocalRecording();
      setRecordingActive(false);
      return;
    }

    if (!recordingSupported() || !stageRef.current) {
      setVisibleNotice({ id: Date.now(), text: "Recording isn't supported in this browser.", tone: "error" });
      return;
    }

    setConfirmRequest({
      title: "Start recording?",
      body: "Everyone in the meeting will see that it's being recorded. The recording is saved to this device when you stop — it isn't uploaded anywhere.",
      confirmLabel: "Start recording",
      onConfirm: () => {
        const recorder = new MeetingRecorder(stageRef.current!);
        recorder.setAudioStreams([localStream, ...Object.values(remoteStreams)].filter(Boolean) as MediaStream[]);
        recorder.start();
        recorderRef.current = recorder;
        setRecordingLocally(true);
        setRecordingActive(true);
      },
    });
  };

  // Keep the recording's audio mix in sync with who is talking.
  useEffect(() => {
    recorderRef.current?.setAudioStreams([localStream, ...Object.values(remoteStreams)].filter(Boolean) as MediaStream[]);
  }, [localStream, remoteStreams]);

  // Save the recording if the call ends underneath us.
  useEffect(() => {
    if (status !== "joined" && status !== "reconnecting" && recorderRef.current) void stopLocalRecording();
  }, [status, stopLocalRecording]);

  // ---------- actions ----------
  const togglePanel = (panel: ActivePanel) => setActivePanel((current) => (current === panel ? "none" : panel));

  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meeting/${roomId}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      // The invite card has done its job once the link is copied.
      window.setTimeout(() => setInviteDismissed(true), 1200);
    } catch {
      setVisibleNotice({ id: Date.now(), text: `Meeting ID: ${roomId}`, tone: "info" });
    }
  };

  const leave = async () => {
    setLeaveMenuOpen(false);
    if (recorderRef.current) {
      await stopLocalRecording();
      setRecordingActive(false);
    }
    leaveRoom();
    onLeave?.();
  };

  const endForEveryone = () => {
    setLeaveMenuOpen(false);
    setConfirmRequest({
      title: "End meeting for everyone?",
      body: "All participants will be disconnected and nobody will be able to rejoin.",
      confirmLabel: "End meeting",
      danger: true,
      onConfirm: async () => {
        if (recorderRef.current) await stopLocalRecording();
        hostAction("end-meeting");
      },
    });
  };

  const onAutoplayBlocked = useCallback(() => setAudioBlocked(true), []);

  const enableAudio = () => {
    stageRef.current?.querySelectorAll("video").forEach((video) => void video.play().catch(() => undefined));
    setAudioBlocked(false);
  };

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "m") { event.preventDefault(); void toggleMicrophone(); }
      if (key === "v") { event.preventDefault(); void toggleCamera(); }
      if (key === "h") { event.preventDefault(); toggleRaiseHand(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCamera, toggleMicrophone, toggleRaiseHand]);

  // ---------- derived ----------
  const sharer = screenSharing ? "local" : participants.find((p) => p.screenSharing)?.socketId;
  const orderedParticipants = useMemo(
    () => [...participants].sort((a, b) => Number(b.screenSharing) - Number(a.screenSharing)),
    [participants]
  );
  const peopleCount = participants.length + (self ? 1 : 0);
  const canShareScreen = canModerate || meeting?.permissions.participantScreenShare !== false;
  const canChat = canModerate || meeting?.permissions.participantChat !== false;
  const raisedHands = participants.filter((p) => p.handRaised).length + (handRaised ? 1 : 0);

  // ---------- terminal states ----------
  if (status === "ended" || status === "removed" || status === "error") {
    const title = status === "ended" ? "Meeting ended" : status === "removed" ? "You were removed" : "Couldn't join the meeting";
    return (
      <div className="video-meeting">
        <div className="meeting-end-screen" role="alert">
          <div className="meeting-end-card">
            <span className="meeting-end-icon"><Icon name={status === "error" ? "shield" : "phone-off"} size={26} /></span>
            <h1>{title}</h1>
            <p>{statusMessage || "You've left the meeting."}</p>
            <div className="meeting-end-actions">
              <button type="button" className="meeting-btn primary" onClick={() => onLeave?.()}>Back to meetings</button>
              {status === "error" && (
                <button type="button" className="meeting-btn" onClick={() => void joinRoom(roomId)}>Try again</button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="video-meeting">
      {/* ===================== TOP BAR ===================== */}
      <header className="meeting-topbar">
        <div className="meeting-brand">
          <div className="meeting-brand-logo">F</div>
          <div>
            <strong>{meeting?.title || "Framehouse meeting"}</strong>
            <span>{meeting?.type === "one-to-one" ? "One-to-one call" : "Group meeting"}</span>
          </div>
        </div>

        <div className="meeting-room-info">
          <span className="live-dot" />
          <span>LIVE</span>
          <div className="room-divider" />
          <span className="room-label">Room</span>
          <strong>{roomId}</strong>
          <button type="button" className="copy-room-button" onClick={copyMeetingLink} title="Copy meeting link" aria-label="Copy meeting link">
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        </div>

        <div className="meeting-top-actions">
          {meeting?.recording && (
            <span className="recording-pill" title={recordingLocally ? "You are recording" : "This meeting is being recorded"}>
              <i /> REC
            </span>
          )}
          {meeting?.isLocked && (
            <span className="meeting-pill" title="New people can't join">
              <Icon name="lock" size={13} /> Locked
            </span>
          )}
          <span className="meeting-pill secure" title="Media is encrypted end-to-end between participants (WebRTC DTLS-SRTP, peer-to-peer). Compare security codes in the People panel to verify.">
            <Icon name="shield" size={13} /> Encrypted
          </span>
          <div className="meeting-duration" aria-label="Call duration">
            <span>●</span>
            {formatDuration(elapsedSeconds)}
          </div>
        </div>
      </header>

      {/* ===================== BANNERS ===================== */}
      {(status === "reconnecting" || status === "joining") && (
        <div className="meeting-banner" role="status">
          <span className="banner-spinner" />
          {status === "joining" ? "Joining meeting…" : "Connection lost — reconnecting…"}
        </div>
      )}
      {audioBlocked && status === "joined" && (
        <div className="meeting-banner action" role="status">
          Your browser paused the call audio.
          <button type="button" onClick={enableAudio}>Enable audio</button>
        </div>
      )}
      {(mediaIssues.camera || mediaIssues.microphone) && status === "joined" && (
        <div className="meeting-banner warning" role="status">
          <Icon name="video-off" size={15} />
          {mediaIssues.microphone && mediaIssues.camera
            ? "Camera and microphone are unavailable — you've joined to watch and listen."
            : mediaIssues.microphone || mediaIssues.camera}
        </div>
      )}

      {/* ===================== MAIN ===================== */}
      <main className="meeting-main">
        <section className="video-stage" ref={stageRef}>
          <div className={`video-grid ${sharer ? "has-spotlight" : ""}`} data-count={peopleCount}>
            <MeetingTile
              name={self?.displayName ? `${self.displayName} (You)` : "You"}
              role={self?.role}
              stream={localStream}
              isLocal
              videoOn={Boolean(localStream?.getVideoTracks().length)}
              audioMuted={!micEnabled}
              handRaised={handRaised}
              screenSharing={screenSharing}
              spotlight={sharer === "local"}
              mirror={cameraEnabled && !screenSharing}
              quality={status === "joined" ? connectionQuality : "reconnecting"}
            />

            {orderedParticipants.map((participant) => (
              <MeetingTile
                key={participant.socketId}
                name={participant.displayName}
                role={participant.role}
                stream={remoteStreams[participant.socketId] ?? null}
                videoOn={!participant.videoMuted}
                audioMuted={participant.audioMuted}
                handRaised={participant.handRaised}
                screenSharing={participant.screenSharing}
                spotlight={sharer === participant.socketId}
                quality={peerStats[participant.socketId]?.quality ?? "reconnecting"}
                speakerId={rtc.selectedSpeaker}
                onAutoplayBlocked={onAutoplayBlocked}
              />
            ))}
          </div>

          {status === "joined" && participants.length === 0 && !inviteDismissed && (
            <div className="meeting-waiting" role="status">
              <button type="button" className="meeting-waiting-close" onClick={() => setInviteDismissed(true)} aria-label="Dismiss invite card">
                <Icon name="close" size={14} />
              </button>
              <strong>You're the only one here</strong>
              <span>Share the meeting link or room ID <b>{roomId}</b> to invite others.</span>
              <button type="button" onClick={copyMeetingLink}>
                <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Link copied" : "Copy invite link"}
              </button>
            </div>
          )}
        </section>

        {activePanel !== "none" && (
          <aside className="meeting-side-panel">
            {activePanel === "participants" && (
              <ParticipantsPanel
                self={self}
                participants={participants}
                peerStats={peerStats}
                micEnabled={micEnabled}
                cameraEnabled={cameraEnabled}
                handRaised={handRaised}
                canModerate={canModerate}
                meeting={meeting}
                onClose={() => setActivePanel("none")}
                onHostAction={hostAction}
                requestConfirm={setConfirmRequest}
              />
            )}

            {activePanel === "chat" && (
              <ChatPanel
                messages={chatMessages}
                selfUserId={self?.userId}
                canChat={canChat}
                onSend={rtc.sendChatMessage}
                onClose={() => setActivePanel("none")}
              />
            )}

            {activePanel === "devices" && (
              <DevicesPanel
                devices={rtc.devices}
                selectedCamera={rtc.selectedCamera}
                selectedMicrophone={rtc.selectedMicrophone}
                selectedSpeaker={rtc.selectedSpeaker}
                onSelectCamera={rtc.selectCamera}
                onSelectMicrophone={rtc.selectMicrophone}
                onSelectSpeaker={rtc.selectSpeaker}
                onSwitchCamera={switchCamera}
                noiseSuppression={rtc.noiseSuppression}
                onNoiseSuppression={rtc.setNoiseSuppression}
                lowBandwidth={rtc.lowBandwidth}
                onLowBandwidth={rtc.setLowBandwidth}
                mediaIssues={mediaIssues}
                onRefresh={rtc.loadDevices}
                onClose={() => setActivePanel("none")}
              />
            )}
          </aside>
        )}
      </main>

      {/* ===================== CONTROLS ===================== */}
      <footer className="meeting-controls">
        <div className="control-group">
          <ControlButton
            icon={micEnabled ? "mic" : "mic-off"}
            label={micEnabled ? "Mute" : "Unmute"}
            danger={!micEnabled}
            onClick={() => void toggleMicrophone()}
            title={`${micEnabled ? "Mute" : "Unmute"} (Ctrl+Shift+M)`}
          />
          <ControlButton
            icon={cameraEnabled ? "video" : "video-off"}
            label={cameraEnabled ? "Stop video" : "Start video"}
            danger={!cameraEnabled}
            onClick={() => void toggleCamera()}
            title={`${cameraEnabled ? "Stop" : "Start"} video (Ctrl+Shift+V)`}
          />
          <ControlButton icon="flip" label="Flip" onClick={() => void switchCamera()} title="Switch camera" className="mobile-only" />
          <ControlButton
            icon="screen"
            label={screenSharing ? "Stop share" : "Share"}
            active={screenSharing}
            disabled={!screenSharing && !canShareScreen}
            onClick={() => void (screenSharing ? stopScreenShare() : startScreenShare())}
            title={!canShareScreen ? "The host has disabled screen sharing" : screenSharing ? "Stop sharing" : "Share your screen"}
            className="desktop-only"
          />
          <ControlButton
            icon="hand"
            label={handRaised ? "Lower" : "Raise"}
            active={handRaised}
            onClick={toggleRaiseHand}
            title={`${handRaised ? "Lower" : "Raise"} hand (Ctrl+Shift+H)`}
          />
          <ControlButton
            icon="users"
            label="People"
            active={activePanel === "participants"}
            badge={raisedHands || undefined}
            onClick={() => togglePanel("participants")}
          />
          <ControlButton
            icon="message"
            label="Chat"
            active={activePanel === "chat"}
            badge={unreadCount || undefined}
            onClick={() => togglePanel("chat")}
          />
          {canModerate && (
            <ControlButton
              icon="record"
              label={recordingLocally ? "Stop rec" : "Record"}
              danger={recordingLocally}
              disabled={Boolean(meeting?.recording) && !recordingLocally}
              onClick={() => void toggleRecording()}
              title={meeting?.recording && !recordingLocally ? "Another host is recording" : "Record this meeting to your device"}
              className="desktop-only"
            />
          )}
          <ControlButton icon="settings" label="Settings" active={activePanel === "devices"} onClick={() => togglePanel("devices")} />
        </div>

        <div className="leave-wrap">
          <button
            type="button"
            className="leave-button"
            onClick={() => (self?.role === "host" ? setLeaveMenuOpen((open) => !open) : void leave())}
            aria-haspopup={self?.role === "host" ? "menu" : undefined}
            aria-expanded={self?.role === "host" ? leaveMenuOpen : undefined}
          >
            <Icon name="phone-off" size={18} />
            <span>Leave</span>
          </button>

          {leaveMenuOpen && (
            <div className="leave-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void leave()}>
                <strong>Leave meeting</strong>
                <span>Others can keep talking</span>
              </button>
              <button type="button" role="menuitem" className="danger" onClick={endForEveryone}>
                <strong>End for everyone</strong>
                <span>Disconnects all participants</span>
              </button>
            </div>
          )}
        </div>
      </footer>

      {/* ===================== OVERLAYS ===================== */}
      {visibleNotice && (
        <div className={`meeting-toast ${visibleNotice.tone === "error" ? "error" : ""}`} role="status" aria-live="polite">
          {visibleNotice.text}
        </div>
      )}

      {confirmRequest && (
        <ConfirmDialog
          request={confirmRequest}
          onCancel={() => setConfirmRequest(null)}
          onConfirm={() => {
            confirmRequest.onConfirm();
            setConfirmRequest(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// TILE
// ============================================================

function MeetingTile({
  name,
  role,
  stream,
  isLocal = false,
  videoOn,
  audioMuted,
  handRaised,
  screenSharing,
  spotlight,
  mirror = false,
  quality,
  speakerId,
  onAutoplayBlocked,
}: {
  name: string;
  role?: Role;
  stream: MediaStream | null;
  isLocal?: boolean;
  videoOn: boolean;
  audioMuted: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  spotlight: boolean;
  mirror?: boolean;
  quality: ConnectionQuality;
  speakerId?: string;
  onAutoplayBlocked?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const speaking = useSpeaking(stream, !audioMuted);

  // The <video> element stays mounted even when the camera is off,
  // because it is also what plays this person's audio.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (!stream) return;

    video.play().catch((error: { name?: string }) => {
      if (error?.name === "NotAllowedError" && !isLocal) onAutoplayBlocked?.();
    });
  }, [stream, isLocal, onAutoplayBlocked]);

  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!video || isLocal || !video.setSinkId) return;
    video.setSinkId(speakerId || "").catch((error) => console.warn("Unable to set speaker:", error));
  }, [speakerId, isLocal]);

  const showVideo = videoOn && Boolean(stream?.getVideoTracks().length);
  const badge = roleLabel(role);

  return (
    <div
      className={`video-tile ${speaking ? "speaking" : ""} ${spotlight ? "is-spotlight" : ""} ${screenSharing ? "is-screen" : ""}`}
      data-record-tile={name}
      data-video-on={String(showVideo)}
    >
      <div className={`video-content ${showVideo ? "" : "is-hidden"}`}>
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className={`meeting-video ${mirror ? "mirror" : ""}`} />
      </div>

      {!showVideo && (
        <div className="camera-off-view">
          <div className={`large-avatar ${speaking ? "speaking" : ""}`}>{name.charAt(0).toUpperCase()}</div>
          <span>{stream || isLocal ? "Camera is off" : "Connecting…"}</span>
        </div>
      )}

      <div className="video-overlay" />

      <div className={`connection-status quality-${quality}`} title={qualityLabel[quality]}>
        <span className="connection-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="connection-text">{qualityLabel[quality]}</span>
      </div>

      {badge && <div className="host-badge">{badge.toUpperCase()}</div>}

      <div className="participant-name">
        {handRaised && <b className="hand-badge" title="Hand raised"><Icon name="hand" size={14} /></b>}
        <span>{name}</span>
        {screenSharing && <small>is presenting</small>}
      </div>

      <div className="participant-status">
        {audioMuted && (
          <span className="status-icon muted" title="Muted" aria-label="Muted">
            <Icon name="mic-off" size={14} />
          </span>
        )}
        {speaking && !audioMuted && (
          <span className="status-icon speaking" title="Speaking" aria-label="Speaking">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// CONTROL BUTTON
// ============================================================

function ControlButton({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
  disabled = false,
  badge,
  title,
  className = "",
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  badge?: number;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`control-button ${active ? "active" : ""} ${danger ? "danger" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-pressed={active || undefined}
    >
      <span className="control-icon">
        <Icon name={icon} size={20} />
        {badge ? <em className="control-badge">{badge > 9 ? "9+" : badge}</em> : null}
      </span>
      <small>{label}</small>
    </button>
  );
}

// ============================================================
// PANEL HEADER
// ============================================================

function PanelHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return (
    <div className="panel-header">
      <div>
        <span className="panel-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <button type="button" onClick={onClose} aria-label="Close panel">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

// ============================================================
// PARTICIPANTS
// ============================================================

function ParticipantsPanel({
  self,
  participants,
  peerStats,
  micEnabled,
  cameraEnabled,
  handRaised,
  canModerate,
  meeting,
  onClose,
  onHostAction,
  requestConfirm,
}: {
  self: Participant | null;
  participants: Participant[];
  peerStats: Record<string, PeerStats>;
  micEnabled: boolean;
  cameraEnabled: boolean;
  handRaised: boolean;
  canModerate: boolean;
  meeting: MeetingInfo | null;
  onClose: () => void;
  onHostAction: (action: HostAction, targetSocketId?: string, value?: unknown) => void;
  requestConfirm: (request: ConfirmRequest) => void;
}) {
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const isHost = self?.role === "host";
  const sorted = [...participants].sort((a, b) => Number(b.handRaised) - Number(a.handRaised));

  const permissions = meeting?.permissions ?? { participantScreenShare: true, participantChat: true };

  return (
    <section className="meeting-panel">
      <PanelHeader eyebrow="PEOPLE" title="Participants" onClose={onClose} />

      <div className="participant-count">
        {participants.length + 1} of {meeting?.maxParticipants ?? "—"} people
      </div>

      <div className="participants-list">
        <div className="participant-row">
          <div className="mini-avatar">{(self?.displayName || "Y").charAt(0).toUpperCase()}</div>
          <div className="participant-details">
            <strong>{self?.displayName || "You"} (You)</strong>
            <span>{roleLabel(self?.role) || "Participant"}</span>
          </div>
          <div className="participant-icons">
            {handRaised && <span title="Hand raised"><Icon name="hand" size={15} /></span>}
            {!micEnabled && <span className="off" title="Muted"><Icon name="mic-off" size={15} /></span>}
            {!cameraEnabled && <span className="off" title="Camera off"><Icon name="video-off" size={15} /></span>}
          </div>
        </div>

        {sorted.map((participant) => {
          const stats = peerStats[participant.socketId];
          const targetIsHost = participant.role === "host";
          const canActOn = canModerate && (!targetIsHost || isHost);

          return (
            <div className="participant-block" key={participant.socketId}>
              <div className="participant-row">
                <div className="mini-avatar">{participant.displayName.charAt(0).toUpperCase()}</div>
                <div className="participant-details">
                  <strong>{participant.displayName}</strong>
                  <span>
                    {[roleLabel(participant.role), participant.handRaised ? "Hand raised" : "", participant.screenSharing ? "Presenting" : ""]
                      .filter(Boolean)
                      .join(" · ") || "Participant"}
                  </span>
                </div>

                <div className="participant-icons">
                  {participant.handRaised && <span title="Hand raised"><Icon name="hand" size={15} /></span>}
                  {participant.audioMuted && <span className="off" title="Muted"><Icon name="mic-off" size={15} /></span>}
                  {participant.videoMuted && <span className="off" title="Camera off"><Icon name="video-off" size={15} /></span>}
                  <span className={`quality-dot quality-${stats?.quality ?? "reconnecting"}`} title={qualityLabel[stats?.quality ?? "reconnecting"] + (stats?.rttMs !== undefined ? ` · ${stats.rttMs} ms` : "")} />
                </div>
              </div>

              <div className="participant-actions">
                <button type="button" onClick={() => setVerifyFor(verifyFor === participant.socketId ? null : participant.socketId)}>
                  <Icon name="shield" size={13} /> Verify
                </button>

                {canActOn && !participant.audioMuted && (
                  <button type="button" onClick={() => onHostAction("mute", participant.socketId)}>
                    <Icon name="mic-off" size={13} /> Mute
                  </button>
                )}
                {canActOn && participant.handRaised && (
                  <button type="button" onClick={() => onHostAction("lower-hand", participant.socketId)}>
                    <Icon name="hand" size={13} /> Lower hand
                  </button>
                )}
                {isHost && !targetIsHost && (
                  <button
                    type="button"
                    onClick={() => onHostAction(participant.role === "co-host" ? "remove-cohost" : "make-cohost", participant.socketId)}
                  >
                    <Icon name="crown" size={13} /> {participant.role === "co-host" ? "Remove co-host" : "Make co-host"}
                  </button>
                )}
                {canActOn && !targetIsHost && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      requestConfirm({
                        title: `Remove ${participant.displayName}?`,
                        body: "They'll be disconnected and won't be able to rejoin this meeting.",
                        confirmLabel: "Remove",
                        danger: true,
                        onConfirm: () => onHostAction("remove", participant.socketId),
                      })
                    }
                  >
                    <Icon name="user-x" size={13} /> Remove
                  </button>
                )}
              </div>

              {verifyFor === participant.socketId && (
                <div className="security-code">
                  {stats?.securityCode ? (
                    <>
                      <code>{stats.securityCode}</code>
                      <p>Ask {participant.displayName} to open “Verify” on your name. If you both see this same code, your call with them is end-to-end encrypted and nobody is intercepting it.</p>
                    </>
                  ) : (
                    <p>The security code appears once your connection with {participant.displayName} is established.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canModerate && (
        <div className="host-controls">
          <span className="panel-eyebrow">HOST CONTROLS</span>

          <button
            type="button"
            onClick={() =>
              requestConfirm({
                title: "Mute everyone?",
                body: "All participants will be muted. They can unmute themselves.",
                confirmLabel: "Mute all",
                onConfirm: () => onHostAction("mute-all"),
              })
            }
          >
            <Icon name="mic-off" size={15} /> Mute all participants
          </button>

          <button type="button" onClick={() => onHostAction(meeting?.isLocked ? "unlock" : "lock")}>
            <Icon name={meeting?.isLocked ? "unlock" : "lock"} size={15} />
            {meeting?.isLocked ? "Unlock meeting" : "Lock meeting (no new joins)"}
          </button>

          <label className="host-toggle">
            <span>
              <strong>Participants can share screen</strong>
            </span>
            <input
              type="checkbox"
              checked={permissions.participantScreenShare}
              onChange={(event) => onHostAction("set-permissions", undefined, { participantScreenShare: event.target.checked })}
            />
          </label>

          <label className="host-toggle">
            <span>
              <strong>Participants can chat</strong>
            </span>
            <input
              type="checkbox"
              checked={permissions.participantChat}
              onChange={(event) => onHostAction("set-permissions", undefined, { participantChat: event.target.checked })}
            />
          </label>
        </div>
      )}
    </section>
  );
}

// ============================================================
// CHAT
// ============================================================

function ChatPanel({
  messages,
  selfUserId,
  canChat,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  selfUserId?: string;
  canChat: boolean;
  onSend: (text: string, attachment?: ChatAttachment) => Promise<{ ok: boolean; message?: string }>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_BYTES) {
      setError("Files must be 2 MB or smaller.");
      return;
    }

    try {
      const dataUrl = await readAsDataUrl(file);
      const mimeType = dataUrl.slice(5, dataUrl.indexOf(";"));
      setAttachment({ name: file.name, mimeType: mimeType || file.type, size: file.size, dataUrl });
      setError("");
    } catch {
      setError("That file couldn't be read.");
    }
  };

  const send = async () => {
    if (sending || (!text.trim() && !attachment)) return;
    setSending(true);
    setError("");
    const result = await onSend(text.trim(), attachment ?? undefined);
    setSending(false);
    if (result.ok) {
      setText("");
      setAttachment(null);
      inputRef.current?.focus();
    } else {
      setError(result.message || "Message could not be sent.");
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    if (!input) {
      setText((value) => value + emoji);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setEmojiOpen(false);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  return (
    <section className="meeting-panel">
      <PanelHeader eyebrow="CONVERSATION" title="In-call chat" onClose={onClose} />

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div><Icon name="message" size={28} /></div>
            <strong>No messages yet</strong>
            <span>Messages, emoji and files you share here are visible to everyone in the meeting.</span>
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === selfUserId;
            return (
              <div className={`chat-message ${mine ? "mine" : ""}`} key={message.id}>
                <small>
                  {mine ? "You" : message.senderName} ·{" "}
                  {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </small>
                {message.attachment && <AttachmentView attachment={message.attachment} />}
                {message.text && <p>{message.text}</p>}
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {canChat ? (
        <div className="chat-compose">
          {attachment && (
            <div className="chat-attachment-preview">
              <Icon name="file" size={15} />
              <span>{attachment.name}</span>
              <small>{formatBytes(attachment.size)}</small>
              <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment">
                <Icon name="close" size={13} />
              </button>
            </div>
          )}
          {error && <div className="chat-error" role="alert">{error}</div>}

          {emojiOpen && (
            <div className="emoji-picker" role="listbox" aria-label="Emoji">
              {EMOJIS.map((emoji) => (
                <button type="button" key={emoji} onClick={() => insertEmoji(emoji)} aria-label={`Insert ${emoji}`}>
                  {emoji}
                </button>
              ))}
            </div>
          )}

          <div className="chat-input-area">
            <button type="button" className="chat-tool" onClick={() => setEmojiOpen((open) => !open)} aria-label="Add emoji" aria-expanded={emojiOpen}>
              <Icon name="smile" size={18} />
            </button>
            <button type="button" className="chat-tool" onClick={() => fileRef.current?.click()} aria-label="Attach a file (up to 2 MB)">
              <Icon name="paperclip" size={18} />
            </button>
            <input ref={fileRef} type="file" accept={ACCEPTED_FILES} hidden onChange={(event) => void pickFile(event)} />
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              maxLength={2000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message everyone…"
              aria-label="Chat message"
            />
            <button type="button" className="chat-send" onClick={() => void send()} disabled={sending || (!text.trim() && !attachment)} aria-label="Send message">
              <Icon name="send" size={17} />
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-disabled">The host has turned off chat for participants.</div>
      )}
    </section>
  );
}

function AttachmentView({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.mimeType.startsWith("image/")) {
    return (
      <a className="chat-image" href={attachment.dataUrl} download={attachment.name} title={`Download ${attachment.name}`}>
        <img src={attachment.dataUrl} alt={attachment.name} />
      </a>
    );
  }

  return (
    <a className="chat-file" href={attachment.dataUrl} download={attachment.name}>
      <Icon name="file" size={18} />
      <span>
        <strong>{attachment.name}</strong>
        <small>{formatBytes(attachment.size)}</small>
      </span>
      <Icon name="download" size={16} />
    </a>
  );
}

// ============================================================
// DEVICES
// ============================================================

function DevicesPanel({
  devices,
  selectedCamera,
  selectedMicrophone,
  selectedSpeaker,
  onSelectCamera,
  onSelectMicrophone,
  onSelectSpeaker,
  onSwitchCamera,
  noiseSuppression,
  onNoiseSuppression,
  lowBandwidth,
  onLowBandwidth,
  mediaIssues,
  onRefresh,
  onClose,
}: {
  devices: MediaDeviceGroups;
  selectedCamera: string;
  selectedMicrophone: string;
  selectedSpeaker: string;
  onSelectCamera: (id: string) => Promise<void>;
  onSelectMicrophone: (id: string) => Promise<void>;
  onSelectSpeaker: (id: string) => void;
  onSwitchCamera: () => Promise<void>;
  noiseSuppression: boolean;
  onNoiseSuppression: (value: boolean) => Promise<void>;
  lowBandwidth: boolean;
  onLowBandwidth: (value: boolean) => void;
  mediaIssues: MediaIssues;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    void onRefresh();
  }, [onRefresh]);

  const speakerSupported = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const label = (device: MediaDeviceInfo, fallback: string, index: number) => device.label || `${fallback} ${index + 1}`;

  return (
    <section className="meeting-panel">
      <PanelHeader eyebrow="SETTINGS" title="Audio & video" onClose={onClose} />

      <div className="device-settings">
        {(mediaIssues.camera || mediaIssues.microphone) && (
          <div className="device-issue" role="alert">
            {mediaIssues.microphone && <p><Icon name="mic-off" size={14} /> {mediaIssues.microphone}</p>}
            {mediaIssues.camera && <p><Icon name="video-off" size={14} /> {mediaIssues.camera}</p>}
          </div>
        )}

        <DeviceSelect id="camera-select" icon="video" label="Camera" value={selectedCamera} onChange={(id) => void onSelectCamera(id)}>
          <option value="">Default camera</option>
          {devices.cameras.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>{label(device, "Camera", index)}</option>
          ))}
        </DeviceSelect>

        <DeviceSelect id="microphone-select" icon="mic" label="Microphone" value={selectedMicrophone} onChange={(id) => void onSelectMicrophone(id)}>
          <option value="">Default microphone</option>
          {devices.microphones.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>{label(device, "Microphone", index)}</option>
          ))}
        </DeviceSelect>

        {speakerSupported && (
          <DeviceSelect id="speaker-select" icon="users" label="Speaker" value={selectedSpeaker} onChange={onSelectSpeaker}>
            <option value="">Default speaker</option>
            {devices.speakers.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>{label(device, "Speaker", index)}</option>
            ))}
          </DeviceSelect>
        )}

        <button type="button" className="device-action-button" onClick={() => void onSwitchCamera()}>
          <span><Icon name="flip" size={15} /></span>
          Switch camera
        </button>
        <p className="device-help">Flips between front and rear cameras on phones, or cycles through connected cameras.</p>

        <label className="device-toggle">
          <span>
            <strong>Noise suppression</strong>
            <small>Filters background noise like typing and fans.</small>
          </span>
          <input type="checkbox" checked={noiseSuppression} onChange={(event) => void onNoiseSuppression(event.target.checked)} />
        </label>

        <label className="device-toggle">
          <span>
            <strong>Low-bandwidth mode</strong>
            <small>Sends lower-resolution video to save data. Video quality also adapts automatically to your connection.</small>
          </span>
          <input type="checkbox" checked={lowBandwidth} onChange={(event) => onLowBandwidth(event.target.checked)} />
        </label>

        <p className="device-help">Shortcuts: Ctrl+Shift+M mute · Ctrl+Shift+V video · Ctrl+Shift+H raise hand</p>
      </div>
    </section>
  );
}

function DeviceSelect({
  id,
  icon,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="device-setting">
      <label htmlFor={id}>
        <span className="device-icon"><Icon name={icon} size={14} /></span>
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </div>
  );
}

// ============================================================
// CONFIRM DIALOG
// ============================================================

function ConfirmDialog({ request, onCancel, onConfirm }: { request: ConfirmRequest; onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="meeting-dialog-backdrop" onMouseDown={onCancel}>
      <div className="meeting-dialog" role="alertdialog" aria-modal="true" aria-labelledby="meeting-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="meeting-dialog-title">{request.title}</h2>
        <p>{request.body}</p>
        <div className="meeting-dialog-actions">
          <button type="button" className="meeting-btn" onClick={onCancel}>Cancel</button>
          <button type="button" ref={confirmRef} className={`meeting-btn ${request.danger ? "danger" : "primary"}`} onClick={onConfirm}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
