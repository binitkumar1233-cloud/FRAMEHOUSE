import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import { API_URL } from "../services/api";
import { createMeetingSocket } from "../services/meetingSocket";

// ============================================================
// TYPES
// ============================================================

export type Role = "host" | "co-host" | "participant";

export type Participant = {
  socketId: string;
  userId: string;
  displayName: string;
  role: Role;
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  handRaised: boolean;
};

export type ChatAttachment = {
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type: "text" | "file" | "system";
  attachment?: ChatAttachment;
  createdAt: string;
};

export type MeetingPermissions = {
  participantScreenShare: boolean;
  participantChat: boolean;
};

export type MeetingInfo = {
  title: string;
  type: "one-to-one" | "group";
  startedAt: string;
  maxParticipants: number;
  isLocked: boolean;
  recording: boolean;
  permissions: MeetingPermissions;
};

export type ConnectionQuality = "excellent" | "good" | "poor" | "reconnecting";

export type PeerStats = {
  quality: ConnectionQuality;
  rttMs?: number;
  lossPct?: number;
  /** Matches on both ends only if the media is end-to-end encrypted between you. */
  securityCode?: string;
};

export type MeetingStatus = "idle" | "joining" | "joined" | "reconnecting" | "ended" | "removed" | "error";

export type MediaIssues = { camera?: string; microphone?: string };

export type Notice = { id: number; text: string; tone: "info" | "error" };

export type HostAction =
  | "mute"
  | "mute-all"
  | "remove"
  | "lower-hand"
  | "lock"
  | "unlock"
  | "set-permissions"
  | "make-cohost"
  | "remove-cohost"
  | "end-meeting";

export type MediaDeviceGroups = {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

type SignalData =
  | { type: "offer" | "answer"; sdp: RTCSessionDescriptionInit; pcId: string }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit; pcId: string };

type PeerEntry = {
  pc: RTCPeerConnection;
  pcId: string;
  remotePcId?: string;
  isOfferer: boolean;
  pending: { pcId: string; candidate: RTCIceCandidateInit }[];
  remoteStream: MediaStream;
  failedSince?: number;
  lastRestartAt?: number;
  lastStats?: { lost: number; received: number };
  securityCode?: string;
  appliedEncoding?: string;
};

// ============================================================
// CONFIG
// ============================================================

const buildIceServers = (): RTCIceServer[] => {
  const iceServers: RTCIceServer[] = [
    { urls: import.meta.env.VITE_STUN_SERVER || "stun:stun.l.google.com:19302" },
  ];

  if (import.meta.env.VITE_TURN_SERVER) {
    iceServers.push({
      urls: import.meta.env.VITE_TURN_SERVER,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_PASSWORD,
    });
  }

  return iceServers;
};

// Server-provided TURN/STUN (credentials stay out of the website bundle).
let serverIce: { iceServers: RTCIceServer[]; relayOnly: boolean } | null = null;

const loadIceServers = async () => {
  try {
    const response = await fetch(`${API_URL}/meetings/ice-servers`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    const data = await response.json();
    if (response.ok && Array.isArray(data.iceServers)) {
      serverIce = { iceServers: data.iceServers, relayOnly: Boolean(data.relayOnly) };
    }
  } catch {
    serverIce = null; // fall back to the build-time settings
  }
};

const STATS_INTERVAL_MS = 4000;
const RESTART_AFTER_MS = 4000;
const RECREATE_AFTER_MS = 15000;
const UPLOAD_BUDGET_BPS = 2_500_000;
const LOW_BANDWIDTH_BPS = 150_000;

const audioConstraints = (noiseSuppression: boolean, deviceId?: string): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: true,
  noiseSuppression,
  autoGainControl: true,
});

const videoConstraints = ({ deviceId, facingMode }: { deviceId?: string; facingMode?: string }): MediaTrackConstraints => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facingMode || "user" }),
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
});

// ============================================================
// MEDIA HELPERS
// ============================================================

const mediaSupported = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

const describeMediaError = (error: unknown, device: "camera" | "microphone") => {
  const name = (error as { name?: string })?.name;
  const Device = device === "camera" ? "Camera" : "Microphone";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return `${Device} access is blocked. Allow it in your browser's site settings, then try again.`;
    case "NotFoundError":
    case "OverconstrainedError":
      return `No ${device} was found on this device.`;
    case "NotReadableError":
    case "AbortError":
      return `Your ${device} is in use by another app.`;
    default:
      return `Your ${device} couldn't be started.`;
  }
};

const getTrack = async (kind: "audio" | "video", constraints: MediaTrackConstraints) => {
  const stream = await navigator.mediaDevices.getUserMedia(
    kind === "audio" ? { audio: constraints } : { video: constraints }
  );
  const track = kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  if (!track) throw Object.assign(new Error("No track"), { name: "NotFoundError" });
  return track;
};

export const getMediaDevices = async (): Promise<MediaDeviceGroups> => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((device) => device.kind === "videoinput"),
    microphones: devices.filter((device) => device.kind === "audioinput"),
    speakers: devices.filter((device) => device.kind === "audiooutput"),
  };
};

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const senderFor = (pc: RTCPeerConnection, kind: "audio" | "video") =>
  pc.getTransceivers().find((t) => t.receiver.track?.kind === kind && t.direction !== "stopped")?.sender;

// A short code derived from both ends' DTLS certificate fingerprints.
// If both people see the same code, nobody is intercepting the media.
const computeSecurityCode = async (stats: RTCStatsReport) => {
  if (!crypto?.subtle) return undefined;

  const certificates = new Map<string, string>();
  let localId: string | undefined;
  let remoteId: string | undefined;

  stats.forEach((report) => {
    if (report.type === "certificate") certificates.set(report.id, report.fingerprint);
    if (report.type === "transport" && report.localCertificateId && report.remoteCertificateId) {
      localId = report.localCertificateId;
      remoteId = report.remoteCertificateId;
    }
  });

  const local = localId && certificates.get(localId);
  const remote = remoteId && certificates.get(remoteId);
  if (!local || !remote) return undefined;

  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode([local, remote].sort().join("|")))
  );

  const groups: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const value = ((digest[i * 3] << 16) | (digest[i * 3 + 1] << 8) | digest[i * 3 + 2]) % 10000;
    groups.push(String(value).padStart(4, "0"));
  }
  return groups.join(" ");
};

// ============================================================
// HOOK
// ============================================================

export function useWebRTC() {
  // ---------- state ----------
  const [status, setStatus] = useState<MeetingStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStats, setPeerStats] = useState<Record<string, PeerStats>>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaIssues, setMediaIssues] = useState<MediaIssues>({});

  const [devices, setDevices] = useState<MediaDeviceGroups>({ cameras: [], microphones: [], speakers: [] });
  const [selectedCamera, setSelectedCamera] = useState("");
  const [selectedMicrophone, setSelectedMicrophone] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [noiseSuppression, setNoiseSuppressionState] = useState(true);
  const [lowBandwidth, setLowBandwidthState] = useState(false);

  // ---------- refs (read inside socket/peer callbacks) ----------
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef("");
  const sessionRef = useRef(0);
  const peersRef = useRef(new Map<string, PeerEntry>());
  const signalQueueRef = useRef(new Map<string, Promise<void>>());

  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const facingModeRef = useRef<"user" | "environment">("user");
  const selectedCameraRef = useRef("");
  const noiseSuppressionRef = useRef(true);
  const lowBandwidthRef = useRef(false);
  const selfRef = useRef<Participant | null>(null);
  const meetingRef = useRef<MeetingInfo | null>(null);

  useEffect(() => { selfRef.current = self; }, [self]);
  useEffect(() => { meetingRef.current = meeting; }, [meeting]);

  const noticeIdRef = useRef(0);
  const showNotice = useCallback((text: string, tone: Notice["tone"] = "info") => {
    noticeIdRef.current += 1;
    setNotice({ id: noticeIdRef.current, text, tone });
  }, []);

  // ==========================================================
  // LOCAL MEDIA
  // ==========================================================

  const outgoingVideo = () => screenTrackRef.current ?? camTrackRef.current;

  const refreshLocalState = useCallback(() => {
    const mic = micTrackRef.current;
    const video = outgoingVideo();
    const tracks = [mic, video].filter(Boolean) as MediaStreamTrack[];
    setLocalStream(tracks.length ? new MediaStream(tracks) : null);
    setMicEnabled(Boolean(mic && mic.enabled));
    setCameraEnabled(Boolean(camTrackRef.current));
    setScreenSharing(Boolean(screenTrackRef.current));
  }, []);

  const publishMediaState = useCallback(() => {
    const mic = micTrackRef.current;
    socketRef.current?.emit("media-state", {
      audioMuted: !(mic && mic.enabled),
      videoMuted: !outgoingVideo(),
      screenSharing: Boolean(screenTrackRef.current),
    });
  }, []);

  const replaceOnAllPeers = useCallback((kind: "audio" | "video", track: MediaStreamTrack | null) => {
    peersRef.current.forEach((entry) => {
      senderFor(entry.pc, kind)?.replaceTrack(track).catch((error) => {
        console.warn(`Unable to replace ${kind} track:`, error);
      });
    });
  }, []);

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      setDevices(await getMediaDevices());
    } catch (error) {
      console.error("Unable to load devices:", error);
    }
  }, []);

  // Handles a device being unplugged or revoked mid-call.
  const watchTrack = useCallback(
    (track: MediaStreamTrack | null, kind: "audio" | "video") => {
      if (!track) return;
      track.onended = async () => {
        if (kind === "audio" && micTrackRef.current === track) {
          micTrackRef.current = null;
          try {
            const replacement = await getTrack("audio", audioConstraints(noiseSuppressionRef.current));
            replacement.enabled = track.enabled;
            micTrackRef.current = replacement;
            watchTrack(replacement, "audio");
            setSelectedMicrophone("");
            showNotice("Microphone disconnected — switched to your default microphone.");
          } catch (error) {
            setMediaIssues((issues) => ({ ...issues, microphone: describeMediaError(error, "microphone") }));
            showNotice("Your microphone was disconnected.", "error");
          }
          replaceOnAllPeers("audio", micTrackRef.current);
        }

        if (kind === "video" && camTrackRef.current === track) {
          camTrackRef.current = null;
          if (!screenTrackRef.current) replaceOnAllPeers("video", null);
          showNotice("Your camera was disconnected.", "error");
        }

        refreshLocalState();
        publishMediaState();
        void loadDevices();
      };
    },
    [loadDevices, publishMediaState, refreshLocalState, replaceOnAllPeers, showNotice]
  );

  const acquireInitialMedia = async () => {
    const issues: MediaIssues = {};

    if (!mediaSupported()) {
      const message = "Camera and microphone need a secure (https) connection.";
      return { mic: null, cam: null, issues: { camera: message, microphone: message } };
    }

    const audio = audioConstraints(noiseSuppressionRef.current);
    const video = videoConstraints({ facingMode: facingModeRef.current });

    try {
      // One prompt for both when possible.
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video });
      return { mic: stream.getAudioTracks()[0] ?? null, cam: stream.getVideoTracks()[0] ?? null, issues };
    } catch {
      // Find out which one failed and join with whatever works.
      let mic: MediaStreamTrack | null = null;
      let cam: MediaStreamTrack | null = null;
      try { mic = await getTrack("audio", audio); } catch (error) { issues.microphone = describeMediaError(error, "microphone"); }
      try { cam = await getTrack("video", video); } catch (error) { issues.camera = describeMediaError(error, "camera"); }
      return { mic, cam, issues };
    }
  };

  // ==========================================================
  // PEER CONNECTIONS
  // ==========================================================

  const emitSignal = (to: string, data: SignalData) => {
    socketRef.current?.emit("signal", { to, data });
  };

  const attachLocalTracks = (pc: RTCPeerConnection) => {
    senderFor(pc, "audio")?.replaceTrack(micTrackRef.current).catch(() => undefined);
    senderFor(pc, "video")?.replaceTrack(outgoingVideo()).catch(() => undefined);
  };

  const closePeer = useCallback((socketId: string, { keepStream = false } = {}) => {
    const entry = peersRef.current.get(socketId);
    if (entry) {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
      peersRef.current.delete(socketId);
    }
    signalQueueRef.current.delete(socketId);
    if (!keepStream) {
      setRemoteStreams(({ [socketId]: _removed, ...rest }) => rest);
      setPeerStats(({ [socketId]: _removed, ...rest }) => rest);
    }
  }, []);

  const makeOffer = async (socketId: string, entry: PeerEntry, iceRestart = false) => {
    const offer = await entry.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await entry.pc.setLocalDescription(offer);
    emitSignal(socketId, { type: "offer", sdp: entry.pc.localDescription!.toJSON(), pcId: entry.pcId });
  };

  const recreatePeer = async (socketId: string) => {
    closePeer(socketId, { keepStream: true });
    const entry = createPeer(socketId, true);
    await makeOffer(socketId, entry);
  };

  function createPeer(socketId: string, isOfferer: boolean): PeerEntry {
    const pc = new RTCPeerConnection({
      iceServers: serverIce?.iceServers ?? buildIceServers(),
      ...(serverIce?.relayOnly ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy } : {}),
    });
    const entry: PeerEntry = {
      pc,
      pcId: newId(),
      isOfferer,
      pending: [],
      remoteStream: new MediaStream(),
    };
    peersRef.current.set(socketId, entry);

    if (isOfferer) {
      // Fixed audio + video slots: tracks can be swapped later with
      // replaceTrack (camera on/off, flip, screen share) without renegotiating.
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "sendrecv" });
      attachLocalTracks(pc);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        emitSignal(socketId, { type: "ice-candidate", candidate: event.candidate.toJSON(), pcId: entry.pcId });
      }
    };

    pc.ontrack = (event) => {
      if (!entry.remoteStream.getTracks().includes(event.track)) {
        entry.remoteStream.addTrack(event.track);
      }
      setRemoteStreams((streams) => ({ ...streams, [socketId]: new MediaStream(entry.remoteStream.getTracks()) }));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === "connected") {
        entry.failedSince = undefined;
        return;
      }

      if (state === "disconnected" || state === "failed") {
        entry.failedSince = entry.failedSince ?? Date.now();
        setPeerStats((stats) => ({ ...stats, [socketId]: { ...stats[socketId], quality: "reconnecting" } }));
      }
    };

    return entry;
  };

  const flushCandidates = async (entry: PeerEntry) => {
    const ready = entry.pending.filter((item) => item.pcId === entry.remotePcId);
    entry.pending = [];
    for (const item of ready) {
      await entry.pc.addIceCandidate(item.candidate).catch((error) => console.warn("ICE candidate rejected:", error));
    }
  };

  const handleSignal = async (from: string, data: SignalData) => {
    let entry = peersRef.current.get(from);

    if (data.type === "offer") {
      // A new connection from the other side replaces the old one.
      if (entry && entry.remotePcId && entry.remotePcId !== data.pcId) {
        closePeer(from, { keepStream: true });
        entry = undefined;
      }

      // Offer collision: the socket with the lower id yields.
      if (entry && entry.pc.signalingState !== "stable") {
        const myId = socketRef.current?.id ?? "";
        if (myId > from) return;
        await entry.pc.setLocalDescription({ type: "rollback" });
      }

      if (!entry) entry = createPeer(from, false);

      entry.remotePcId = data.pcId;
      await entry.pc.setRemoteDescription(data.sdp);

      entry.pc.getTransceivers().forEach((transceiver) => {
        if (transceiver.direction !== "stopped") transceiver.direction = "sendrecv";
      });
      attachLocalTracks(entry.pc);

      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      emitSignal(from, { type: "answer", sdp: entry.pc.localDescription!.toJSON(), pcId: entry.pcId });
      await flushCandidates(entry);
      return;
    }

    if (!entry) return;

    if (data.type === "answer") {
      if (entry.pc.signalingState !== "have-local-offer") return;
      entry.remotePcId = data.pcId;
      await entry.pc.setRemoteDescription(data.sdp);
      await flushCandidates(entry);
      return;
    }

    if (data.type === "ice-candidate") {
      if (entry.remotePcId && data.pcId !== entry.remotePcId) return;
      if (!entry.pc.remoteDescription) {
        entry.pending.push({ pcId: data.pcId, candidate: data.candidate });
        return;
      }
      await entry.pc.addIceCandidate(data.candidate).catch((error) => console.warn("ICE candidate rejected:", error));
    }
  };

  // Signals for one peer are processed strictly in order.
  const enqueueSignal = (from: string, data: SignalData) => {
    const previous = signalQueueRef.current.get(from) ?? Promise.resolve();
    const next = previous
      .then(() => handleSignal(from, data))
      .catch((error) => console.error("WebRTC signal error:", error));
    signalQueueRef.current.set(from, next);
  };

  const closeAllPeers = useCallback(() => {
    [...peersRef.current.keys()].forEach((socketId) => closePeer(socketId));
    peersRef.current.clear();
    signalQueueRef.current.clear();
    setRemoteStreams({});
    setPeerStats({});
  }, [closePeer]);

  // ==========================================================
  // TEARDOWN
  // ==========================================================

  const teardown = useCallback(() => {
    sessionRef.current += 1;

    closeAllPeers();

    [micTrackRef, camTrackRef, screenTrackRef].forEach((ref) => {
      if (ref.current) {
        ref.current.onended = null;
        ref.current.stop();
        ref.current = null;
      }
    });

    const socket = socketRef.current;
    socketRef.current = null;
    roomIdRef.current = "";
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
    }

    setLocalStream(null);
    setMicEnabled(false);
    setCameraEnabled(false);
    setScreenSharing(false);
    setParticipants([]);
  }, [closeAllPeers]);

  // ==========================================================
  // JOIN
  // ==========================================================

  const joinRoom = useCallback(
    async (roomId: string) => {
      const session = ++sessionRef.current;

      setStatus("joining");
      setStatusMessage("");
      setChatMessages([]);
      setParticipants([]);
      setMeeting(null);
      setSelf(null);

      if (!micTrackRef.current && !camTrackRef.current) {
        const { mic, cam, issues } = await acquireInitialMedia();

        // The component unmounted (or re-joined) while we were waiting.
        if (session !== sessionRef.current) {
          mic?.stop();
          cam?.stop();
          return;
        }

        micTrackRef.current = mic;
        camTrackRef.current = cam;
        watchTrack(mic, "audio");
        watchTrack(cam, "video");
        setMediaIssues(issues);
        refreshLocalState();
        void loadDevices();
      }

      await loadIceServers();
      if (session !== sessionRef.current) return;

      let socket: Socket;
      try {
        socket = createMeetingSocket();
      } catch (error) {
        setStatus("error");
        setStatusMessage(error instanceof Error ? error.message : "Unable to connect.");
        return;
      }

      socketRef.current = socket;
      roomIdRef.current = roomId;

      socket.on("connect", () => socket.emit("join-room", { roomId }));

      socket.on("connect_error", (error) => {
        if (/token|auth|user not found/i.test(error.message)) {
          setStatus("error");
          setStatusMessage("Your session has expired. Please sign in again.");
          teardown();
          return;
        }
        setStatus((current) => (current === "joined" ? "reconnecting" : current));
      });

      socket.on("disconnect", (reason) => {
        if (reason === "io client disconnect") return;
        // Peers are rebuilt from scratch once the socket reconnects.
        setStatus("reconnecting");
        closeAllPeers();
        setParticipants([]);
      });

      socket.on(
        "joined",
        async (payload: { self: Participant; participants: Participant[]; meeting: MeetingInfo; chatHistory: ChatMessage[] }) => {
          setSelf(payload.self);
          setParticipants(payload.participants);
          setMeeting(payload.meeting);
          setChatMessages(payload.chatHistory || []);
          setStatus("joined");
          publishMediaState();

          // The newcomer calls everyone already in the room.
          for (const participant of payload.participants) {
            try {
              const entry = createPeer(participant.socketId, true);
              await makeOffer(participant.socketId, entry);
            } catch (error) {
              console.error("Unable to call participant:", error);
            }
          }
        }
      );

      socket.on("join-error", ({ code, message }: { code: string; message: string }) => {
        setStatus(code === "removed" ? "removed" : code === "ended" ? "ended" : "error");
        setStatusMessage(message);
        teardown();
      });

      socket.on("user-joined", (participant: Participant) => {
        setParticipants((current) => [...current.filter((p) => p.socketId !== participant.socketId), participant]);
      });

      socket.on("user-left", ({ socketId }: { socketId: string }) => {
        closePeer(socketId);
        setParticipants((current) => current.filter((p) => p.socketId !== socketId));
      });

      socket.on("signal", ({ from, data }: { from: string; data: SignalData }) => enqueueSignal(from, data));

      socket.on(
        "media-state",
        ({ socketId, audioMuted, videoMuted, screenSharing: sharing }: Pick<Participant, "socketId" | "audioMuted" | "videoMuted" | "screenSharing">) => {
          setParticipants((current) =>
            current.map((p) => (p.socketId === socketId ? { ...p, audioMuted, videoMuted, screenSharing: sharing } : p))
          );
        }
      );

      socket.on("raise-hand", ({ socketId, handRaised }: { socketId: string; handRaised: boolean }) => {
        if (socketId === socket.id) {
          setSelf((current) => (current ? { ...current, handRaised } : current));
          return;
        }
        setParticipants((current) => current.map((p) => (p.socketId === socketId ? { ...p, handRaised } : p)));
      });

      socket.on("role-updated", ({ userId, role }: { userId: string; role: Role }) => {
        if (selfRef.current?.userId === userId) {
          showNotice(role === "co-host" ? "You're now a co-host." : "You're no longer a co-host.");
        }
        setSelf((current) => (current && current.userId === userId ? { ...current, role } : current));
        setParticipants((current) => current.map((p) => (p.userId === userId ? { ...p, role } : p)));
      });

      socket.on("meeting-updated", (patch: Partial<MeetingInfo>) => {
        setMeeting((current) => (current ? { ...current, ...patch } : current));
      });

      socket.on("recording-state", ({ active, by }: { active: boolean; by: string }) => {
        setMeeting((current) => (current ? { ...current, recording: active } : current));
        showNotice(active ? `${by} started recording this meeting.` : "Recording has stopped.");
      });

      socket.on("chat-message", (message: ChatMessage) => {
        setChatMessages((current) => [...current, message]);
      });

      socket.on("force-mute", ({ by }: { by?: string }) => {
        if (micTrackRef.current) micTrackRef.current.enabled = false;
        refreshLocalState();
        publishMediaState();
        showNotice(by ? `${by} muted you.` : "You were muted by the host.");
      });

      socket.on("stop-screen-share", ({ reason }: { reason: string }) => {
        stopScreenShareRef.current();
        showNotice(reason, "error");
      });

      socket.on("removed", ({ reason }: { reason?: string }) => {
        setStatus("removed");
        setStatusMessage(reason || "You were removed from the meeting.");
        teardown();
      });

      socket.on("meeting-ended", () => {
        setStatus("ended");
        setStatusMessage("The host ended the meeting.");
        teardown();
      });

      socket.on("session-replaced", () => {
        setStatus("ended");
        setStatusMessage("You joined this meeting from another tab or device.");
        teardown();
      });

      socket.on("error-message", ({ message }: { message: string }) => showNotice(message, "error"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closeAllPeers, closePeer, loadDevices, publishMediaState, refreshLocalState, showNotice, teardown, watchTrack]
  );

  // ==========================================================
  // CONTROLS
  // ==========================================================

  const toggleMicrophone = useCallback(async () => {
    const mic = micTrackRef.current;

    if (!mic) {
      try {
        const track = await getTrack("audio", audioConstraints(noiseSuppressionRef.current, selectedMicrophone || undefined));
        micTrackRef.current = track;
        watchTrack(track, "audio");
        replaceOnAllPeers("audio", track);
        setMediaIssues(({ microphone: _cleared, ...rest }) => rest);
      } catch (error) {
        const message = describeMediaError(error, "microphone");
        setMediaIssues((issues) => ({ ...issues, microphone: message }));
        showNotice(message, "error");
        return;
      }
    } else {
      mic.enabled = !mic.enabled;
    }

    refreshLocalState();
    publishMediaState();
  }, [publishMediaState, refreshLocalState, replaceOnAllPeers, selectedMicrophone, showNotice, watchTrack]);

  const toggleCamera = useCallback(async () => {
    const cam = camTrackRef.current;

    if (cam) {
      // Stop the track entirely so the camera light turns off.
      cam.onended = null;
      cam.stop();
      camTrackRef.current = null;
      if (!screenTrackRef.current) replaceOnAllPeers("video", null);
    } else {
      try {
        const track = await getTrack(
          "video",
          videoConstraints({ deviceId: selectedCameraRef.current || undefined, facingMode: facingModeRef.current })
        );
        camTrackRef.current = track;
        watchTrack(track, "video");
        if (!screenTrackRef.current) replaceOnAllPeers("video", track);
        setMediaIssues(({ camera: _cleared, ...rest }) => rest);
        void loadDevices();
      } catch (error) {
        const message = describeMediaError(error, "camera");
        setMediaIssues((issues) => ({ ...issues, camera: message }));
        showNotice(message, "error");
        return;
      }
    }

    refreshLocalState();
    publishMediaState();
  }, [loadDevices, publishMediaState, refreshLocalState, replaceOnAllPeers, showNotice, watchTrack]);

  const swapCameraTrack = useCallback(
    async (constraints: MediaTrackConstraints) => {
      const previous = camTrackRef.current;
      // Many phones can't open two cameras at once, so release the old one first.
      if (previous) {
        previous.onended = null;
        previous.stop();
      }
      const track = await getTrack("video", constraints);
      camTrackRef.current = track;
      watchTrack(track, "video");
      if (!screenTrackRef.current) replaceOnAllPeers("video", track);
      refreshLocalState();
      publishMediaState();
    },
    [publishMediaState, refreshLocalState, replaceOnAllPeers, watchTrack]
  );

  const switchCamera = useCallback(async () => {
    if (!camTrackRef.current) {
      showNotice("Turn your camera on to switch cameras.");
      return;
    }

    const next = facingModeRef.current === "user" ? "environment" : "user";

    try {
      await swapCameraTrack({ ...videoConstraints({}), facingMode: { exact: next } });
      facingModeRef.current = next;
      selectedCameraRef.current = "";
      setSelectedCamera("");
    } catch {
      // No front/rear pair (e.g. a laptop) — cycle through the cameras instead.
      const cameras = (await getMediaDevices()).cameras;
      if (cameras.length < 2) {
        showNotice("No other camera is available.");
        await swapCameraTrack(videoConstraints({ facingMode: facingModeRef.current })).catch(() => undefined);
        return;
      }
      const currentId = camTrackRef.current?.getSettings().deviceId || selectedCameraRef.current;
      const index = cameras.findIndex((camera) => camera.deviceId === currentId);
      const nextCamera = cameras[(index + 1) % cameras.length];
      try {
        await swapCameraTrack(videoConstraints({ deviceId: nextCamera.deviceId }));
        selectedCameraRef.current = nextCamera.deviceId;
        setSelectedCamera(nextCamera.deviceId);
      } catch (error) {
        showNotice(describeMediaError(error, "camera"), "error");
      }
    }
  }, [showNotice, swapCameraTrack]);

  const selectCamera = useCallback(
    async (deviceId: string) => {
      selectedCameraRef.current = deviceId;
      setSelectedCamera(deviceId);
      if (!camTrackRef.current) return;
      try {
        await swapCameraTrack(videoConstraints({ deviceId: deviceId || undefined, facingMode: facingModeRef.current }));
      } catch (error) {
        showNotice(describeMediaError(error, "camera"), "error");
      }
    },
    [showNotice, swapCameraTrack]
  );

  const selectMicrophone = useCallback(
    async (deviceId: string) => {
      setSelectedMicrophone(deviceId);
      const previous = micTrackRef.current;
      try {
        const track = await getTrack("audio", audioConstraints(noiseSuppressionRef.current, deviceId || undefined));
        track.enabled = previous ? previous.enabled : true;
        micTrackRef.current = track;
        watchTrack(track, "audio");
        replaceOnAllPeers("audio", track);
        if (previous) {
          previous.onended = null;
          previous.stop();
        }
        refreshLocalState();
        publishMediaState();
      } catch (error) {
        showNotice(describeMediaError(error, "microphone"), "error");
      }
    },
    [publishMediaState, refreshLocalState, replaceOnAllPeers, showNotice, watchTrack]
  );

  const setNoiseSuppression = useCallback(
    async (enabled: boolean) => {
      noiseSuppressionRef.current = enabled;
      setNoiseSuppressionState(enabled);
      const mic = micTrackRef.current;
      if (!mic) return;
      try {
        await mic.applyConstraints({ echoCancellation: true, autoGainControl: true, noiseSuppression: enabled });
      } catch {
        showNotice("Your browser doesn't support changing noise suppression.", "error");
      }
    },
    [showNotice]
  );

  const setLowBandwidth = useCallback((enabled: boolean) => {
    lowBandwidthRef.current = enabled;
    setLowBandwidthState(enabled);
    peersRef.current.forEach((entry) => {
      entry.appliedEncoding = undefined;
    });
  }, []);

  const stopScreenShare = useCallback(() => {
    const screen = screenTrackRef.current;
    if (!screen) return;
    screen.onended = null;
    screen.stop();
    screenTrackRef.current = null;
    replaceOnAllPeers("video", camTrackRef.current);
    peersRef.current.forEach((entry) => {
      entry.appliedEncoding = undefined;
    });
    refreshLocalState();
    publishMediaState();
  }, [publishMediaState, refreshLocalState, replaceOnAllPeers]);

  const stopScreenShareRef = useRef(stopScreenShare);
  useEffect(() => {
    stopScreenShareRef.current = stopScreenShare;
  }, [stopScreenShare]);

  const startScreenShare = useCallback(async () => {
    const role = selfRef.current?.role;
    if (role === "participant" && meetingRef.current?.permissions.participantScreenShare === false) {
      showNotice("The host has disabled screen sharing for participants.", "error");
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      showNotice("Screen sharing isn't supported on this device.", "error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      track.contentHint = "detail";
      screenTrackRef.current = track;
      track.onended = () => stopScreenShareRef.current();

      replaceOnAllPeers("video", track);
      peersRef.current.forEach((entry) => {
        entry.appliedEncoding = undefined;
      });
      refreshLocalState();
      publishMediaState();
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "AbortError") return;
      console.error("Screen sharing failed:", error);
      showNotice("Screen sharing couldn't be started.", "error");
    }
  }, [publishMediaState, refreshLocalState, replaceOnAllPeers, showNotice]);

  const toggleRaiseHand = useCallback(() => {
    const next = !selfRef.current?.handRaised;
    setSelf((current) => (current ? { ...current, handRaised: next } : current));
    socketRef.current?.emit("raise-hand", { handRaised: next });
  }, []);

  const sendChatMessage = useCallback(
    (text: string, attachment?: ChatAttachment) =>
      new Promise<{ ok: boolean; message?: string }>((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({ ok: false, message: "You're offline. Reconnecting…" });
          return;
        }
        socket.timeout(10000).emit("chat-message", { text, attachment }, (error: Error | null, result?: { ok: boolean; message?: string }) => {
          if (error) resolve({ ok: false, message: "Message timed out. Try again." });
          else resolve(result ?? { ok: true });
        });
      }),
    []
  );

  const hostAction = useCallback((action: HostAction, targetSocketId?: string, value?: unknown) => {
    socketRef.current?.emit("host-action", { action, targetSocketId, value });
  }, []);

  const setRecordingActive = useCallback((active: boolean) => {
    socketRef.current?.emit("recording", { active });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave-room");
    teardown();
    setStatus("idle");
  }, [teardown]);

  // ==========================================================
  // EFFECTS
  // ==========================================================

  // Clean up on unmount.
  useEffect(() => () => teardown(), [teardown]);

  // Tell the server immediately when the tab is closed or refreshed.
  useEffect(() => {
    const onPageHide = () => socketRef.current?.emit("leave-room");
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Keep the device list current when devices are plugged in or out.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => void loadDevices();
    mediaDevices.addEventListener("devicechange", onChange);
    return () => mediaDevices.removeEventListener("devicechange", onChange);
  }, [loadDevices]);

  // Connection quality, recovery, bandwidth adaptation and security codes.
  useEffect(() => {
    const interval = window.setInterval(async () => {
      const entries = [...peersRef.current.entries()];
      const peerCount = Math.max(1, entries.length);
      const updates: Record<string, PeerStats> = {};

      for (const [socketId, entry] of entries) {
        const { pc } = entry;

        // Recovery: the side that made the offer restarts ICE, then rebuilds.
        if (entry.failedSince && entry.isOfferer) {
          const downFor = Date.now() - entry.failedSince;
          if (downFor > RECREATE_AFTER_MS) {
            void recreatePeer(socketId).catch((error) => console.error("Peer rebuild failed:", error));
            continue;
          }
          if (downFor > RESTART_AFTER_MS && pc.signalingState === "stable" && (!entry.lastRestartAt || Date.now() - entry.lastRestartAt > RESTART_AFTER_MS * 2)) {
            entry.lastRestartAt = Date.now();
            pc.restartIce?.();
            void makeOffer(socketId, entry, true).catch((error) => console.error("ICE restart failed:", error));
          }
        }

        if (pc.connectionState !== "connected") {
          updates[socketId] = { quality: "reconnecting", securityCode: entry.securityCode };
          continue;
        }

        try {
          const stats = await pc.getStats();
          let lost = 0;
          let received = 0;
          let rtt: number | undefined;
          let available: number | undefined;

          stats.forEach((report) => {
            if (report.type === "inbound-rtp") {
              lost += report.packetsLost || 0;
              received += report.packetsReceived || 0;
            }
            if (report.type === "candidate-pair" && report.nominated && report.state === "succeeded") {
              if (typeof report.currentRoundTripTime === "number") rtt = report.currentRoundTripTime * 1000;
              if (typeof report.availableOutgoingBitrate === "number") available = report.availableOutgoingBitrate;
            }
          });

          const previous = entry.lastStats ?? { lost: 0, received: 0 };
          const deltaLost = Math.max(0, lost - previous.lost);
          const deltaReceived = Math.max(0, received - previous.received);
          entry.lastStats = { lost, received };
          const lossPct = deltaLost + deltaReceived > 0 ? (deltaLost / (deltaLost + deltaReceived)) * 100 : 0;

          const quality: ConnectionQuality =
            lossPct < 2 && (rtt ?? 0) < 200 ? "excellent" : lossPct < 8 && (rtt ?? 0) < 450 ? "good" : "poor";

          if (!entry.securityCode) entry.securityCode = await computeSecurityCode(stats);

          updates[socketId] = { quality, rttMs: rtt !== undefined ? Math.round(rtt) : undefined, lossPct: Math.round(lossPct * 10) / 10, securityCode: entry.securityCode };

          // Adapt what we send to this peer.
          const sender = senderFor(pc, "video");
          if (sender?.track) {
            const isScreen = sender.track === screenTrackRef.current;
            let maxBitrate = Math.min(1_500_000, Math.max(250_000, UPLOAD_BUDGET_BPS / peerCount));
            if (available) maxBitrate = Math.min(maxBitrate, available * 0.85);
            let scale = 1;
            let maxFramerate = isScreen ? 15 : 30;

            if (quality === "poor") {
              maxBitrate = Math.min(maxBitrate, 300_000);
              scale = isScreen ? 1 : 2;
              maxFramerate = 15;
            }
            if (lossPct > 12) {
              maxBitrate = Math.min(maxBitrate, LOW_BANDWIDTH_BPS);
              scale = isScreen ? 1.5 : 4;
              maxFramerate = 10;
            }
            if (lowBandwidthRef.current) {
              maxBitrate = LOW_BANDWIDTH_BPS;
              scale = isScreen ? 1.5 : 4;
              maxFramerate = isScreen ? 5 : 12;
            }

            maxBitrate = Math.round(maxBitrate / 50_000) * 50_000 || 50_000;
            const key = `${maxBitrate}|${scale}|${maxFramerate}`;

            if (entry.appliedEncoding !== key) {
              const params = sender.getParameters();
              if (params.encodings?.length) {
                params.encodings[0].maxBitrate = maxBitrate;
                params.encodings[0].scaleResolutionDownBy = scale;
                params.encodings[0].maxFramerate = maxFramerate;
                await sender.setParameters(params).then(
                  () => {
                    entry.appliedEncoding = key;
                  },
                  (error) => console.warn("Unable to adapt video bitrate:", error)
                );
              }
            }
          }
        } catch (error) {
          console.warn("Stats error:", error);
        }
      }

      if (entries.length) setPeerStats((current) => ({ ...current, ...updates }));
    }, STATS_INTERVAL_MS);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================================
  // DERIVED
  // ==========================================================

  const qualities = Object.values(peerStats).map((stats) => stats.quality);
  const connectionQuality: ConnectionQuality =
    status === "reconnecting" || status === "joining"
      ? "reconnecting"
      : qualities.includes("poor")
      ? "poor"
      : qualities.includes("reconnecting")
      ? "good"
      : qualities.includes("good")
      ? "good"
      : "excellent";

  const canModerate = self?.role === "host" || self?.role === "co-host";

  return {
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
    handRaised: Boolean(self?.handRaised),
    mediaIssues,

    devices,
    selectedCamera,
    selectedMicrophone,
    selectedSpeaker,
    noiseSuppression,
    lowBandwidth,

    joinRoom,
    leaveRoom,
    loadDevices,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    selectCamera,
    selectMicrophone,
    selectSpeaker: setSelectedSpeaker,
    setNoiseSuppression,
    setLowBandwidth,
    startScreenShare,
    stopScreenShare,
    toggleRaiseHand,
    sendChatMessage,
    hostAction,
    setRecordingActive,
  };
}
