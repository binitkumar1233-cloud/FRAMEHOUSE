import { useCallback, useEffect, useRef, useState } from "react";
import "./Meetings.css";
import { Icon } from "../components/Icon";
import { ShareMenu } from "../components/ShareMenu";
import { API_URL } from "../services/api";

type MeetingsProps = {
  onJoin: (roomId: string) => void;
  /** Room ID from a shared meeting link (/meeting/ABC123). */
  initialRoomId?: string;
};

type MeetingSummary = {
  _id: string;
  roomId: string;
  title: string;
  status: "live" | "ended";
  type: "one-to-one" | "group";
  hasPassword?: boolean;
  createdAt: string;
};

export default function Meetings({ onJoin, initialRoomId = "" }: MeetingsProps) {
  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState<"group" | "one-to-one">("group");
  const [newPasscode, setNewPasscode] = useState("");
  const [roomId, setRoomId] = useState(initialRoomId.toUpperCase());
  const [passcode, setPasscode] = useState("");
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createdRoom, setCreatedRoom] = useState("");
  const [copied, setCopied] = useState(false);
  const [myMeetings, setMyMeetings] = useState<MeetingSummary[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [copiedRoomId, setCopiedRoomId] = useState("");
  const passcodeRef = useRef<HTMLInputElement>(null);

  const getToken = () => {
    const token = localStorage.getItem("token");
    if (!token) throw new Error("Please sign in first.");
    return token;
  };

  const loadMyMeetings = async () => {
    try {
      setMeetingsLoading(true);
      const token = localStorage.getItem("token");
      if (!token) {
        setMyMeetings([]);
        return;
      }
      const response = await fetch(`${API_URL}/meetings/mine`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) setMyMeetings(data.meetings || []);
    } catch (loadError) {
      console.error("Unable to load meetings:", loadError);
    } finally {
      setMeetingsLoading(false);
    }
  };

  useEffect(() => {
    loadMyMeetings();
  }, []);

  const clearHistory = async () => {
    if (!window.confirm("Clear all ended meetings from your history? Live meetings stay.")) return;
    try {
      const response = await fetch(`${API_URL}/meetings/mine`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to clear history.");
      setMyMeetings((current) => current.filter((meeting) => meeting.status !== "ended"));
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to clear history.");
    }
  };

  const createMeeting = async () => {
    try {
      setLoading(true);
      setError("");
      const token = getToken();
      const response = await fetch(`${API_URL}/meetings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim() || "Framehouse Meeting",
          type: meetingType,
          password: newPasscode.trim() || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to create meeting");
      }

      const newRoomId = data.meeting?.roomId || data.roomId;
      if (!newRoomId) throw new Error("Server did not return a room ID.");

      setCreatedRoom(newRoomId);
      setCopied(false);
      await loadMyMeetings();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create meeting.");
    } finally {
      setLoading(false);
    }
  };

  const joinMeeting = useCallback(
    async (requestedRoomId: string, code = "") => {
      const cleanRoomId = requestedRoomId.trim().toUpperCase();
      if (!cleanRoomId) {
        setError("Enter a meeting room ID.");
        return;
      }

      try {
        setLoading(true);
        setError("");
        const token = getToken();
        const response = await fetch(`${API_URL}/meetings/${encodeURIComponent(cleanRoomId)}/join`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(code ? { password: code } : {}),
        });
        const data = await response.json();

        if (data.code === "password-required") {
          setRoomId(cleanRoomId);
          setNeedsPasscode(true);
          setError(code ? data.message : "");
          window.requestAnimationFrame(() => passcodeRef.current?.focus());
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to join meeting");
        }

        setNeedsPasscode(false);
        setPasscode("");
        onJoin(cleanRoomId);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to join meeting.");
      } finally {
        setLoading(false);
      }
    },
    [onJoin]
  );

  // Arriving from a shared link: try to join straight away
  // (a passcode prompt appears if the meeting needs one).
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (initialRoomId && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      void joinMeeting(initialRoomId);
    }
  }, [initialRoomId, joinMeeting]);

  const copyMeetingLink = async () => {
    if (!createdRoom) return;

    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meeting/${createdRoom}`);
      setCopied(true);
    } catch {
      setError("Unable to copy the meeting link.");
    }
  };

  const copyRoomLink = async (targetRoomId: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meeting/${targetRoomId}`);
      setCopiedRoomId(targetRoomId);
      window.setTimeout(() => setCopiedRoomId(""), 2000);
    } catch {
      setError("Unable to copy the meeting link.");
    }
  };

  const formatMeetingDate = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div className="meetings-page">
      <div className="meetings-container">
        <div className="meetings-heading">
          <span className="eyebrow">FRAMEHOUSE MEETINGS</span>
          <h1>Meet. Connect. Share.</h1>
          <p>Start an encrypted video call or join an existing room with its ID or link.</p>
        </div>

        <div className="meetings-grid">
          <section className="meeting-card">
            <div className="meeting-card-header">
              <div className="meeting-icon"><Icon name="plus" size={22} /></div>
              <span className="meeting-card-label">NEW ROOM</span>
            </div>
            <h2>Create a meeting</h2>
            <p>Create a private room and invite others using a unique meeting link.</p>

            <div className="meeting-type-toggle" role="radiogroup" aria-label="Meeting type">
              <button type="button" role="radio" aria-checked={meetingType === "group"} className={meetingType === "group" ? "selected" : ""} onClick={() => setMeetingType("group")}>
                <Icon name="users" size={16} />
                <span><strong>Group</strong><small>Up to your plan's limit</small></span>
              </button>
              <button type="button" role="radio" aria-checked={meetingType === "one-to-one"} className={meetingType === "one-to-one" ? "selected" : ""} onClick={() => setMeetingType("one-to-one")}>
                <Icon name="video" size={16} />
                <span><strong>One-to-one</strong><small>Just you and one other</small></span>
              </button>
            </div>

            <label>
              Meeting title
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Team meeting" maxLength={120} />
            </label>
            <label>
              Passcode <span className="optional">(optional)</span>
              <input
                type="password"
                value={newPasscode}
                onChange={(event) => setNewPasscode(event.target.value)}
                placeholder="Require a passcode to join"
                autoComplete="new-password"
                maxLength={64}
              />
            </label>
            <button className="primary-button" onClick={createMeeting} disabled={loading}>
              {loading ? "Creating..." : "Create meeting"}
            </button>

            {createdRoom && (
              <div className="created-meeting">
                <span className="created-label">ROOM ID</span>
                <strong>{createdRoom}</strong>
                <div className="created-meeting-actions">
                  <button onClick={copyMeetingLink}>{copied ? "Copied" : "Copy link"}</button>
                  <ShareMenu
                    url={`${window.location.origin}/meeting/${createdRoom}`}
                    title="Join my Framehouse meeting"
                    className="share-inline-btn"
                  />
                  <button onClick={() => joinMeeting(createdRoom)} disabled={loading}>Join now</button>
                </div>
              </div>
            )}
          </section>

          <section className="meeting-card">
            <div className="meeting-card-header">
              <div className="meeting-icon"><Icon name="arrow-right" size={22} /></div>
              <span className="meeting-card-label">JOIN ROOM</span>
            </div>
            <h2>Join a meeting</h2>
            <p>Enter a room ID shared by the meeting host.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void joinMeeting(roomId, needsPasscode ? passcode : "");
              }}
            >
              <label>
                Room ID
                <input
                  value={roomId}
                  onChange={(event) => {
                    setRoomId(event.target.value);
                    setNeedsPasscode(false);
                  }}
                  placeholder="e.g. 4F9A21C7"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </label>
              {needsPasscode && (
                <label>
                  Passcode
                  <input
                    ref={passcodeRef}
                    type="password"
                    value={passcode}
                    onChange={(event) => setPasscode(event.target.value)}
                    placeholder="This meeting needs a passcode"
                    autoComplete="off"
                  />
                </label>
              )}
              <button type="submit" className="primary-button" disabled={loading}>
                {loading ? "Joining..." : "Join meeting"}
              </button>
            </form>

            <ul className="meeting-assurances" aria-label="Meeting privacy">
              <li><Icon name="shield" size={16} /><span><strong>Private by design</strong>Calls go directly between participants and are encrypted in transit.</span></li>
              <li><Icon name="users" size={16} /><span><strong>Host controls</strong>Hosts can mute, remove or lock the room at any time.</span></li>
              <li><Icon name="video" size={16} /><span><strong>Chat clears after the call</strong>Messages and shared files are deleted when the meeting ends.</span></li>
            </ul>
          </section>
        </div>

        {error && <div className="meeting-form-error">{error}</div>}

        <section className="meeting-history">
          <div className="meeting-history-heading">
            <div>
              <span className="eyebrow">HISTORY</span>
              <h2>My meetings</h2>
            </div>
            {!meetingsLoading && myMeetings.length > 0 && (
              <div className="meeting-history-tools">
                <span className="meeting-count">
                  {myMeetings.length} {myMeetings.length === 1 ? "MEETING" : "MEETINGS"}
                </span>
                <button type="button" className="meeting-clear-btn" onClick={clearHistory}>
                  <Icon name="trash" size={14} /> Clear history
                </button>
              </div>
            )}
          </div>

          {meetingsLoading ? (
            <div className="meeting-history-grid">
              {[0, 1, 2].map((key) => (
                <div className="meeting-history-skeleton" key={key} />
              ))}
            </div>
          ) : myMeetings.length === 0 ? (
            <div className="meeting-history-empty">
              <span className="meeting-empty-icon"><Icon name="video" size={24} /></span>
              <h3>No meetings yet</h3>
              <p>Meetings you create or join will show up here.</p>
            </div>
          ) : (
            <div className="meeting-history-grid">
              {myMeetings.map((meeting) => (
                <div className="meeting-history-card" key={meeting._id}>
                  <div className="meeting-history-top">
                    <div>
                      <span className="meeting-type">{meeting.type === "group" ? "GROUP" : "ONE-TO-ONE"}</span>
                      <h3>{meeting.title}</h3>
                    </div>
                    <span className={`meeting-status-pill ${meeting.status}`}>
                      <i />
                      {meeting.status === "live" ? "Live now" : "Ended"}
                    </span>
                  </div>
                  <div className="meeting-history-meta">
                    <span className="meeting-room-code">{meeting.roomId}</span>
                    <span>{formatMeetingDate(meeting.createdAt)}</span>
                  </div>
                  <div className="meeting-history-actions">
                    {meeting.status === "live" && (
                      <button className="primary-button" onClick={() => joinMeeting(meeting.roomId)}>
                        Join
                      </button>
                    )}
                    <button className="secondary-button" onClick={() => copyRoomLink(meeting.roomId)}>
                      {copiedRoomId === meeting.roomId ? "Copied" : "Copy link"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
