import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import "./App.css";
import "./brand.css";
import "./polish.css";
import "./motion.css";
import "./design.css";
import { Footer as SharedFooter } from "./components/Footer";
import { ShareMenu } from "./components/ShareMenu";
import { Icon } from "./components/Icon";
import { LoadingSkeleton } from "./components/LoadingSkeleton";
import { AppMotion, DialogMotion, PageTransition } from "./components/Motion";
import { BackToTop, Reveal, RevealGroup, RevealItem, ScrollProgress } from "./components/ScrollEffects";
import { useParallax } from "./hooks/useParallax";
import { ScrollTriggeredCards } from "./components/ScrollTriggeredCards";
import { DragConstraints } from "./components/DragConstraints";
import { HorizontalScrollGallery } from "./components/HorizontalScrollGallery";
import { ShaderBanner } from "./components/ShaderBanner";
import { BASE, item, stagger } from "./components/motionTokens";
import { DownloadsPanel } from "./components/DownloadsPanel";
import { getQuota, startDownload, DownloadError } from "./services/downloads";
import type { DownloadQuota } from "./services/downloads";
import { Navbar as SharedNavbar } from "./components/Navbar";
import { SubscriptionCard as SharedSubscriptionCard } from "./components/SubscriptionCard";
import { VideoCard as SharedVideoCard } from "./components/VideoCard";
import { VideoPlayer } from "./components/VideoPlayer/VideoPlayer";
import { useCheckout } from "./hooks/useCheckout";
import { UpiApprovals } from "./components/UpiApprovals";
import type { Cycle, PlanName, SubscriptionStatus } from "./services/billing";
import { ErrorBoundary, PageLoading } from "./components/ErrorBoundary";
import { API_URL } from "./services/api";
import { OtpStep } from "./components/OtpStep";
import { Comments } from "./components/Comments";
import { ForgotPasswordForm } from "./components/ForgotPasswordForm";
import { deviceHeaders, setThemePreference } from "./services/security";
import type { OtpChallenge } from "./services/security";
import { applyTheme } from "./utils/theme";
import type { ThemePreference } from "./utils/theme";

// Heavier pages load only when they're opened, which keeps the first load fast.
const Meetings = lazy(() => import("./pages/Meetings"));
const VideoMeeting = lazy(() => import("./pages/VideoMeeting"));
const Pricing = lazy(() => import("./pages/Pricing").then((m) => ({ default: m.Pricing })));
const CommentModeration = lazy(() => import("./pages/CommentModeration"));
const AccountSecurity = lazy(() => import("./pages/AccountSecurity"));
const SubscriptionDashboard = lazy(() => import("./pages/SubscriptionDashboard").then((m) => ({ default: m.SubscriptionDashboard })));

type View = "home" | "browse" | "dashboard" | "downloads" | "pricing" | "subscription" | "profile" | "settings" | "security" | "moderation" | "watch" | "admin" | "meetings" | "meeting";
type AuthMode = "login" | "register";
type User = { name: string; email: string; role?: string; subscriptionPlan?: string; theme?: "light" | "dark"; themeSource?: "auto" | "manual" };
type Video = { _id?: string; title: string; description?: string; category: string; duration: string; views: number | string; image?: string; thumbnail?: string; videoUrl?: string; captions?: { language: string; label: string; url: string; default?: boolean }[]; premium?: boolean; locked?: boolean; createdAt?: string; minPlan?: PlanName; requiredPlan?: PlanName; accessReason?: "premium" | "early-access" | "exclusive" | null; earlyAccessUntil?: string | null; exclusive?: boolean };
type Playback = { plan: PlanName; maxQuality: string; quality: string | null; ads: boolean; unlockedWithAllowance: boolean; watch: { usedSeconds: number; limitSeconds: number | null; remainingSeconds: number | null; resetsAt: string } };
type UnlockPrompt = { video: Video; startAt: number; remaining: number; limit: number };
type DashboardMeeting = { _id: string; roomId: string; title: string; status: "live" | "ended"; type: "one-to-one" | "group"; createdAt: string };

const ACTIVE_MEETING_KEY = "framehouse.activeMeeting";

const FALLBACK_THUMBNAIL = "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=1600&q=90";
const handleImageError = (event: SyntheticEvent<HTMLImageElement>) => { const image = event.currentTarget; if (image.src !== FALLBACK_THUMBNAIL) image.src = FALLBACK_THUMBNAIL; };
// Lets clickable cards open with Enter / Space like a real button.
const onActivateKey = (action: () => void) => (event: ReactKeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
};

const PAGE_TITLES: Record<string, string> = {
  home: "Watch, connect, experience",
  browse: "Library",
  dashboard: "My library",
  pricing: "Plans and pricing",
  subscription: "Subscription",
  profile: "Profile",
  settings: "Settings",
  security: "Account security",
  moderation: "Comment moderation",
  watch: "Now watching",
  admin: "Admin",
  meetings: "Meetings",
  meeting: "Meeting",
};

const authHeaders = (): Record<string, string> => { const token = localStorage.getItem("token"); return token ? { Authorization: `Bearer ${token}`, ...deviceHeaders() } : deviceHeaders(); };

function App() {
  const [view, setView] = useState<View>("home");
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [otp, setOtp] = useState<OtpChallenge | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [subscriptionRefresh, setSubscriptionRefresh] = useState(0);
  const [videos, setVideos] = useState<Video[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);
  const [watchProgress, setWatchProgress] = useState<any[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [selectedPlayback, setSelectedPlayback] = useState<Playback | null>(null);
  const [selectedStart, setSelectedStart] = useState(0);
  const [unlockPrompt, setUnlockPrompt] = useState<UnlockPrompt | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [meetingRoomId, setMeetingRoomId] = useState("");
  // Room ID from a shared link (/meeting/ABC123), handed to the Meetings page to join.
  const [linkRoomId, setLinkRoomId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const navigate = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const applyStatus = (status: SubscriptionStatus | null) => {
    setSubscriptionStatus(status);
    // Older components read `subscription.plan`; null means Free.
    setSubscription(status?.active ? { plan: status.plan, status: status.status, expiryDate: status.expiryDate } : null);
  };
  const loadSubscription = async () => {
    const token = localStorage.getItem("token");
    if (!token) { applyStatus(null); return; }
    try {
      const response = await fetch(`${API_URL}/subscription/me`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (response.ok && data.success) applyStatus(data.subscription);
    } catch (error) { console.error("Unable to load subscription:", error); }
  };
  const loadVideos = async () => {
    try { setVideosLoading(true); const response = await fetch(`${API_URL}/videos`, { headers: authHeaders() }); const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.message || "Failed to load videos"); setVideos(data.videos || []); } catch (error) { console.error("Load videos error:", error); setToast("Failed to load videos"); } finally { setVideosLoading(false); }
  };
  const loadWatchProgress = async () => {
    const token = localStorage.getItem("token");
    if (!token) { setWatchProgress([]); return; }
    try {
      const response = await fetch(`${API_URL}/watch-progress`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load progress");
      setWatchProgress(data.progress || []);
    } catch (error) { console.error("Watch progress error:", error); }
  };
  useEffect(() => { const storedUser = localStorage.getItem("user"); const token = localStorage.getItem("token"); if (storedUser && token) { setUser(JSON.parse(storedUser)); loadSubscription(); loadWatchProgress(); void syncProfile(); } loadVideos(); }, []);
  // Pulls the saved theme from the account, and drops the local login if its session was ended elsewhere.
  const syncProfile = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, { headers: authHeaders() });
      if (response.status === 401) { localStorage.removeItem("token"); localStorage.removeItem("user"); setUser(null); applyStatus(null); setToast("You were signed out. Please sign in again."); return; }
      const data = await response.json();
      if (data.success && data.user) {
        applyTheme(data.user.theme);
        const merged = { ...JSON.parse(localStorage.getItem("user") || "{}"), theme: data.user.theme, themeSource: data.user.themeSource };
        localStorage.setItem("user", JSON.stringify(merged));
        setUser(merged);
      }
    } catch { /* offline: keep what we have */ }
  };

  // Meeting links and refresh recovery.
  useEffect(() => {
    const signedIn = Boolean(localStorage.getItem("token"));
    const activeRoom = sessionStorage.getItem(ACTIVE_MEETING_KEY);
    const linkMatch = window.location.pathname.match(/^\/meeting\/([A-Za-z0-9]{4,32})\/?$/);
    const linkedRoom = linkMatch?.[1].toUpperCase() || "";

    // A refresh while in a call goes straight back into it.
    if (signedIn && activeRoom && (!linkedRoom || linkedRoom === activeRoom)) {
      setMeetingRoomId(activeRoom);
      setView("meeting");
      return;
    }

    if (linkedRoom) {
      setLinkRoomId(linkedRoom);
      if (signedIn) {
        setView("meetings");
      } else {
        setAuthMode("login");
        setToast("Sign in to join the meeting.");
      }
    }
  }, []);

  // Keep the address bar in step with the call so the link can be copied or refreshed.
  useEffect(() => {
    if (view === "meeting" && meetingRoomId) {
      sessionStorage.setItem(ACTIVE_MEETING_KEY, meetingRoomId);
      if (window.location.pathname !== `/meeting/${meetingRoomId}`) window.history.replaceState(null, "", `/meeting/${meetingRoomId}`);
    } else if (window.location.pathname.startsWith("/meeting/") && !linkRoomId) {
      window.history.replaceState(null, "", "/");
    }
  }, [view, meetingRoomId, linkRoomId]);

  useEffect(() => {
    const page = view === "watch" && selectedVideo ? selectedVideo.title : PAGE_TITLES[view];
    document.title = page ? `${page} · Framehouse` : "Framehouse";
  }, [view, selectedVideo]);

  const enterMeeting = (roomId: string) => { setLinkRoomId(""); setMeetingRoomId(roomId); setView("meeting"); };
  const exitMeeting = () => { sessionStorage.removeItem(ACTIVE_MEETING_KEY); setMeetingRoomId(""); setView("meetings"); window.history.replaceState(null, "", "/"); };
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4500); return () => window.clearTimeout(timer); }, [toast]);

  const openVideo = async (video: Video, startAt = 0) => {
    try {
      if (!localStorage.getItem("token")) {
        setToast("Sign in to watch videos. It's free.");
        setAuthMode("login");
        return;
      }

      const response = await fetch(`${API_URL}/videos/${video._id}`, { headers: authHeaders() });
      const data = await response.json();

      if (!response.ok) {
        if (data.code === "login-required") { setAuthMode("login"); setToast(data.message); return; }
        if (data.code === "unlock-available") { setUnlockPrompt({ video, startAt, remaining: data.remaining, limit: data.limit }); return; }
        setToast(data.message || "Unable to watch this video");
        if (data.code === "upgrade-required" || data.code === "watch-limit") navigate("pricing");
        return;
      }

      setSelectedVideo(data.video);
      setSelectedPlayback(data.playback || null);
      setSelectedStart(startAt);
      setView("watch");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      console.error("Video error:", error);
      setToast("Something went wrong while opening the video");
    }
  };

  const confirmUnlock = async () => {
    if (!unlockPrompt?.video._id) return;
    const prompt = unlockPrompt;
    setUnlockPrompt(null);
    try {
      const response = await fetch(`${API_URL}/videos/${prompt.video._id}/unlock`, { method: "POST", headers: authHeaders() });
      const data = await response.json();
      if (!response.ok || !data.success) { setToast(data.message || "This video couldn't be unlocked."); if (data.code === "upgrade-required") navigate("pricing"); return; }
      await openVideo(prompt.video, prompt.startAt);
    } catch {
      setToast("This video couldn't be unlocked. Please try again.");
    }
  };

  const finishLogin = async (data: { token: string; user: User }) => {
    localStorage.setItem("token", data.token); localStorage.setItem("user", JSON.stringify(data.user));
    applyTheme(data.user.theme); setUser(data.user); setOtp(null);
    await loadSubscription(); await loadWatchProgress(); await loadVideos();
    setAuthMode(null); navigate(linkRoomId ? "meetings" : view === "pricing" ? "pricing" : "dashboard"); setToast("Welcome back. Your studio is ready.");
  };
  // Both resolve to an error message for the code form, or null on success.
  const verifyOtp = async (code: string, trust: boolean, days: number): Promise<string | null> => {
    if (!otp) return "This verification has ended. Please sign in again.";
    try {
      setAuthLoading(true);
      const response = await fetch(`${API_URL}/auth/login/verify`, { method: "POST", headers: { "Content-Type": "application/json", ...deviceHeaders() }, body: JSON.stringify({ challengeId: otp.challengeId, code, trustDevice: trust, trustDays: days }) });
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (data.locked) { setOtp(null); setToast(data.message); return null; }
        return data.message || "Verification failed.";
      }
      await finishLogin(data);
      return null;
    } catch { return "Couldn't reach the server. Please try again."; } finally { setAuthLoading(false); }
  };
  const resendOtp = async (): Promise<string | null> => {
    if (!otp) return "This verification has ended. Please sign in again.";
    try {
      const response = await fetch(`${API_URL}/auth/login/resend`, { method: "POST", headers: { "Content-Type": "application/json", ...deviceHeaders() }, body: JSON.stringify({ challengeId: otp.challengeId }) });
      const data = await response.json();
      if (!response.ok || !data.success) return data.message || "Couldn't send a new code.";
      setToast("A new code is on its way.");
      return null;
    } catch { return "Couldn't reach the server. Please try again."; }
  };
  const handleAuth = async (event: FormEvent<HTMLFormElement>, mode: AuthMode) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "").trim(); const email = String(form.get("email") || "").trim(); const phone = String(form.get("phone") || "").trim(); const password = String(form.get("password") || ""); const confirm = String(form.get("confirmPassword") || "");
    if (!email || !password || (mode === "register" && (!name || password !== confirm))) { setToast(mode === "register" && password !== confirm ? "Passwords do not match." : "Please complete all required fields."); return; }
    try {
      setAuthLoading(true);
      const response = await fetch(`${API_URL}${mode === "login" ? "/auth/login" : "/auth/register"}`, { method: "POST", headers: { "Content-Type": "application/json", ...deviceHeaders() }, body: JSON.stringify(mode === "login" ? { email, password } : { name, email, password, ...(phone ? { phone } : {}) }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Authentication failed");
      if (mode === "register") { setAuthMode("login"); setToast("Account created. Sign in to continue."); }
      else if (data.otpRequired) { setOtp(data); setToast("We sent you a verification code."); }
      else await finishLogin(data);
    } catch (error: any) { setToast(error.message || "Authentication failed."); } finally { setAuthLoading(false); }
  };
  const logout = () => { void fetch(`${API_URL}/auth/logout`, { method: "POST", headers: authHeaders() }).catch(() => undefined); localStorage.removeItem("token"); localStorage.removeItem("user"); setUser(null); applyStatus(null); setWatchProgress([]); navigate("home"); setToast("You have been signed out."); void loadVideos(); };

  // Premium features switch on only after the server has verified the payment.
  const onPaid = useCallback((status: SubscriptionStatus) => {
    applyStatus(status);
    setSubscriptionRefresh((n) => n + 1);
    void loadVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const checkout = useCheckout({ onPaid, setToast });
  const choosePlan = (plan: PlanName, cycle: Cycle) => {
    if (!localStorage.getItem("token")) { setAuthMode("login"); setToast("Sign in to choose a plan."); return; }
    void checkout.purchase(plan, cycle);
  };

  if (view === "meeting" && meetingRoomId) {
    return <ErrorBoundary fullScreen key={meetingRoomId}><Suspense fallback={<PageLoading />}><VideoMeeting roomId={meetingRoomId} onLeave={exitMeeting} /></Suspense></ErrorBoundary>;
  }

  return <AppMotion><div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><Navbar user={user} view={view} navigate={navigate} openAuth={() => setAuthMode("login")} logout={logout} searchQuery={searchQuery} setSearchQuery={setSearchQuery} /><ScrollProgress /><BackToTop /><main id="main-content" tabIndex={-1}><PageTransition id={view === "watch" ? `watch-${selectedVideo?._id ?? ""}` : view}><ErrorBoundary key={view}><Suspense fallback={<PageLoading />}>{view === "home" && <Home videos={videos} videosLoading={videosLoading} user={user} subscription={subscription} navigate={navigate} setToast={setToast} openAuth={() => setAuthMode("login")} onVideoClick={openVideo} />}{view === "browse" && <Browse videos={videos} videosLoading={videosLoading} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onVideoClick={openVideo} query={searchQuery} setQuery={setSearchQuery} />}{view === "dashboard" && <Dashboard videos={videos} videosLoading={videosLoading} watchProgress={watchProgress} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onVideoClick={openVideo} />}{view === "watch" && selectedVideo && <WatchVideo openAuth={() => setAuthMode("login")} video={selectedVideo} playback={selectedPlayback} startAt={selectedStart} goBack={() => navigate("browse")} videos={videos} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onVideoClick={openVideo} />}{view === "downloads" && (user ? <div className="page-wrap narrow-page"><div className="page-heading"><div><span className="eyebrow">OFFLINE</span><h1>Downloaded videos.</h1></div></div><DownloadsPanel onUpgrade={() => navigate("pricing")} setToast={setToast} /></div> : <div className="page-wrap narrow-page"><div className="empty-state"><h2>Sign in to see your downloads</h2><button className="primary-button" onClick={() => setAuthMode("login")}>Sign in</button></div></div>)}{view === "meetings" && <Meetings onJoin={enterMeeting} initialRoomId={linkRoomId} />}{view === "admin" && user?.role === "admin" && <AdminDashboard loadVideos={loadVideos} setToast={setToast} />}{view === "pricing" && <Pricing current={subscriptionStatus} signedIn={Boolean(user)} busyKey={checkout.busyKey} onChoose={choosePlan} onManage={() => navigate("subscription")} openAuth={() => setAuthMode("login")} />}{view === "subscription" && (user ? <SubscriptionDashboard refreshKey={subscriptionRefresh} busyKey={checkout.busyKey} onChoose={choosePlan} onChanged={applyStatus} goToPricing={() => navigate("pricing")} setToast={setToast} /> : <div className="page-wrap narrow-page"><div className="empty-state"><h2>Sign in to see your subscription</h2><button className="primary-button" onClick={() => setAuthMode("login")}>Sign in</button></div></div>)}{view === "profile" && <Profile user={user} subscription={subscription} logout={logout} watchProgress={watchProgress} onVideoClick={openVideo} navigate={navigate} setToast={setToast} />}{view === "settings" && <Settings logout={logout} navigate={navigate} setToast={setToast} />}{view === "moderation" && (user?.role === "admin" ? <CommentModeration setToast={setToast} /> : <div className="page-wrap narrow-page"><div className="empty-state"><h2>Admins only</h2><p>You need an admin account to open comment moderation.</p></div></div>)}{view === "security" && (user ? <AccountSecurity setToast={setToast} onSignedOut={logout} /> : <div className="page-wrap narrow-page"><div className="empty-state"><h2>Sign in to see your account security</h2><button className="primary-button" onClick={() => setAuthMode("login")}>Sign in</button></div></div>)}</Suspense></ErrorBoundary></PageTransition></main><Footer navigate={navigate} /><div className="sr-only" role="status" aria-live="polite">{toast}</div><AnimatePresence>{toast && <motion.div key={toast} aria-hidden="true" className={`toast ${/fail|unable|wrong|error|not |please|invalid|do not match|couldn't|declined|cancelled/i.test(toast) ? "is-error" : ""}`} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: BASE }} exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }}><span className="toast-dot" />{toast}</motion.div>}</AnimatePresence><AnimatePresence>{checkout.checkoutUi}</AnimatePresence>{checkout.confirming && <div className="modal-backdrop"><div className="confirming-card" role="status"><span className="banner-spinner" />Confirming your payment…</div></div>}<AnimatePresence>{unlockPrompt && <UnlockDialog key="unlock" prompt={unlockPrompt} onConfirm={() => void confirmUnlock()} onUpgrade={() => { setUnlockPrompt(null); navigate("pricing"); }} onClose={() => setUnlockPrompt(null)} />}</AnimatePresence><AnimatePresence>{authMode && <AuthModal key="auth" mode={authMode} setMode={setAuthMode} loading={authLoading} submit={handleAuth} close={() => { setAuthMode(null); setOtp(null); }} otp={otp} onVerify={verifyOtp} onResend={resendOtp} onCancelOtp={() => setOtp(null)} />}</AnimatePresence></div></AppMotion>;
}

function UnlockDialog({ prompt, onConfirm, onUpgrade, onClose }: { prompt: UnlockPrompt; onConfirm: () => void; onUpgrade: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <DialogMotion className="unlock-dialog" onBackdrop={onClose} labelledBy="unlock-title">
        <span className="empty-icon"><Icon name="play" size={20} /></span>
        <h2 id="unlock-title">Watch “{prompt.video.title}”?</h2>
        <p>This is a premium video. Free members can watch {prompt.limit} premium videos a month. This will use 1 of your {prompt.remaining} remaining.</p>
        <div className="unlock-actions">
          <button className="primary-button" onClick={onConfirm}>Watch now</button>
          <button className="secondary-button" onClick={onUpgrade}>See plans</button>
        </div>
    </DialogMotion>
  );
}


function Navbar({ user, view, navigate, openAuth, logout, searchQuery, setSearchQuery }: { user: User | null; view: View; navigate: (view: View) => void; openAuth: () => void; logout: () => void; searchQuery: string; setSearchQuery: (value: string) => void }) { return <SharedNavbar user={user} view={view} navigate={navigate} openAuth={openAuth} logout={logout} searchQuery={searchQuery} onSearchChange={setSearchQuery} onSearchSubmit={() => navigate("browse")} />; }

function Home({ videos, videosLoading, user, subscription, navigate, setToast, openAuth, onVideoClick }: { videos: Video[]; videosLoading: boolean; user: User | null; subscription: any; navigate: (view: View) => void; setToast: (message: string) => void; openAuth: () => void; onVideoClick: (video: Video) => void }) {
  const featured = videos.slice(0, 4);
  const heroVideo = featured[0];
  const { ref: heroRef, y: heroImageY } = useParallax<HTMLElement>(70);

  return (
    <>
      <section className="hero-home hero-home-premium" ref={heroRef}>
        <motion.div className="hero-copy" variants={stagger(0.08, 0.05)} initial="hidden" animate="show">
          <motion.div className="eyebrow" variants={item}>
            <span className="eyebrow-line" />
            Streaming &amp; meetings
          </motion.div>

          <motion.h1 variants={item}>
            Watch.
            <br />
            Connect.
            <br />
            <em>Experience.</em>
          </motion.h1>

          <motion.p className="hero-lead" variants={item}>
            A premium home for cinematic stories and real-time
            conversations — stream in up to 4K, then meet face to face
            in one click.
          </motion.p>

          <motion.div className="hero-actions" variants={item}>
            <button
              className="primary-button hero-primary"
              onClick={() => (user ? navigate("browse") : openAuth())}
            >
              Explore the library
              <Icon name="arrow-right" size={16} />
            </button>

            <button
              className="ghost-button hero-secondary"
              onClick={() => (user ? navigate("meetings") : openAuth())}
            >
              <Icon name="video" size={16} />
              Create or join a meeting
            </button>
          </motion.div>

          <motion.ul className="hero-trust" variants={item}>
            <li className="hero-trust-item">
              <Icon name="hd" />
              <div>
                <strong>Up to 4K</strong>
                <span>Adaptive quality streaming</span>
              </div>
            </li>
            <li className="hero-trust-item">
              <Icon name="users" />
              <div>
                <strong>Live meetings</strong>
                <span>Video rooms with chat</span>
              </div>
            </li>
            <li className="hero-trust-item">
              <Icon name="shield" />
              <div>
                <strong>No auto-renew</strong>
                <span>Monthly, quarterly or yearly</span>
              </div>
            </li>
          </motion.ul>
        </motion.div>

        <motion.div className="hero-visual-premium" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1, transition: { ...BASE, duration: 0.6, delay: 0.15 } }}>
          <motion.div className="hero-image-frame" style={{ y: heroImageY }}>
            <img
              src={heroVideo?.thumbnail || heroVideo?.image || FALLBACK_THUMBNAIL}
              alt={heroVideo?.title || "Cinematic film set"}
              onError={handleImageError}
            />
            <div className="hero-visual-overlay" />
            <div className="hero-image-gradient" />

            <div className="hero-content-badge">
              <span className="live-dot" />
              Featured
            </div>

            <div className="hero-image-info">
              <span className="eyebrow">{heroVideo?.category || "Cinematic collection"}</span>
              <h3>{heroVideo?.title || "Stories worth staying for"}</h3>
              <button
                className="hero-watch-link"
                onClick={() => heroVideo && onVideoClick(heroVideo)}
              >
                <Icon name="play" size={14} />
                Watch now
              </button>
            </div>
          </motion.div>

          <div className="hero-floating-card">
            <span className="floating-icon"><Icon name="sparkle" size={16} /></span>
            <div>
              <strong>Curated for you</strong>
              <span>Fresh stories every week</span>
            </div>
          </div>
        </motion.div>
      </section>

      <section className="content-section featured-section home-featured">
        <SectionIntro
          label="FEATURED COLLECTION"
          title="Stories worth staying for"
          action="View all"
          onAction={() => navigate("browse")}
        />

        {videosLoading ? (
          <LoadingState />
        ) : featured.length ? (
          <div className="feature-grid">
            {featured.map((video, index) => (
              <VideoCard
                key={video._id || video.title}
                video={video}
                large={index === 0}
                user={user}
                subscription={subscription}
                navigate={navigate}
                setToast={setToast}
                onClick={() => onVideoClick(video)}
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>

      {videos.length >= 3 && (
        <HorizontalScrollGallery
          eyebrow="Now streaming"
          title="Scroll through the library"
          action="Open the library"
          onAction={() => navigate("browse")}
          fallbackImage={FALLBACK_THUMBNAIL}
          items={videos.slice(0, 8).map((video) => ({
            id: video._id || video.title,
            image: video.thumbnail || video.image || FALLBACK_THUMBNAIL,
            label: video.title,
            kicker: video.category,
            tag: video.requiredPlan && video.requiredPlan !== "Free" ? (video.accessReason === "exclusive" ? "Gold" : video.requiredPlan) : undefined,
            onClick: () => onVideoClick(video),
          }))}
        />
      )}

      <section className="content-section scroll-cards-section" aria-label="What Framehouse includes">
        <SectionIntro label="Why Framehouse" title="Everything you need to watch and connect" />
        <ScrollTriggeredCards
          items={[
            { icon: "film", kicker: "Streaming", title: "A premium film library", text: "Curated films and series, with new releases every week and early access on Silver and Gold.", cta: "Browse the library", hueA: 205, hueB: 225, onClick: () => navigate("browse") },
            { icon: "hd", kicker: "Quality", title: "Up to 4K playback", text: "Picture quality that scales with your plan, from 480p on Free to 4K on Gold.", cta: "Compare plans", hueA: 195, hueB: 215, onClick: () => navigate("pricing") },
            { icon: "users", kicker: "Meetings", title: "Live video rooms", text: "Host one-to-one or group calls with chat, screen sharing and host controls.", cta: "Start a meeting", hueA: 215, hueB: 240, onClick: () => (user ? navigate("meetings") : openAuth()) },
            { icon: "download", kicker: "Offline", title: "Downloads on your devices", text: "Save videos to watch without a connection, with daily limits by plan.", cta: "View downloads", hueA: 190, hueB: 210, onClick: () => (user ? navigate("downloads") : openAuth()) },
            { icon: "shield", kicker: "Privacy", title: "Encrypted calls", text: "Meeting audio and video are encrypted end to end between participants.", cta: "Learn about meetings", hueA: 200, hueB: 225, onClick: () => (user ? navigate("meetings") : openAuth()) },
            { icon: "crown", kicker: "Gold", title: "Exclusive courses", text: "In-depth premium courses, available only to Gold members.", cta: "See Gold", hueA: 220, hueB: 245, onClick: () => navigate("pricing") },
          ]}
        />
      </section>

      <RevealGroup as="section" className="home-stats" gap={0.1} aria-label="Framehouse at a glance">
        {[
          { value: "4K", label: "Ultra HD streaming" },
          { value: "50", label: "People per meeting" },
          { value: "Private", label: "Encrypted video calls" },
          { value: "24/7", label: "Watch anywhere" },
        ].map((stat) => (
          <RevealItem key={stat.label} className="home-stat">
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </RevealItem>
        ))}
      </RevealGroup>

      <section className="content-section home-steps" aria-label="How Framehouse works">
        <SectionIntro label="How it works" title="From sign-up to showtime in three steps" />
        <RevealGroup className="steps-grid" gap={0.14}>
          {[
            { icon: "users", title: "Create your account", text: "Sign up free in under a minute. No card needed to start watching." },
            { icon: "film", title: "Pick what to watch", text: "Browse the library, resume where you left off and download for offline." },
            { icon: "video", title: "Meet face to face", text: "Start a private room, share the link and talk with chat and screen sharing." },
          ].map((step, index) => (
            <RevealItem key={step.title} className="step-card">
              <span className="step-number">0{index + 1}</span>
              <span className="step-icon"><Icon name={step.icon as any} size={22} /></span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </section>

      <RevealGroup as="section" className="home-showcase" gap={0.14}>
        <RevealItem className="home-showcase-copy">
          <span className="eyebrow">More than streaming</span>
          <h2>One place to watch, meet and share.</h2>
          <p>
            Discover great content and switch seamlessly from watching
            together to talking together with Framehouse meetings.
          </p>

          <div className="showcase-actions">
            <button
              className="primary-button"
              onClick={() => (user ? navigate("meetings") : openAuth())}
            >
              Start a meeting
            </button>
            <button
              className="line-button"
              onClick={() => navigate("browse")}
            >
              Explore videos
            </button>
          </div>
        </RevealItem>

        <RevealItem className="home-showcase-panel">
          <div className="showcase-panel-top">
            <span className="showcase-status">Live room</span>
            <span>Video · Chat · Screen share</span>
          </div>

          <DragConstraints className="showcase-drag-area" itemClassName="showcase-orb is-draggable" label="Drag the Framehouse orb">
            <span>F</span>
          </DragConstraints>
          <span className="showcase-drag-hint" aria-hidden="true">Drag me</span>

          <div className="showcase-users">
            <div className="showcase-avatars" aria-hidden="true">
              <span>BM</span>
              <span>AK</span>
              <span>+3</span>
            </div>
            <p>Private conversations. Real-time connection.</p>
          </div>
        </RevealItem>
      </RevealGroup>

      <ShaderBanner
        signedIn={Boolean(user)}
        onPrimary={() => (user ? navigate("browse") : openAuth())}
        onSecondary={() => navigate("pricing")}
      />

      <section className="home-cta" aria-label="Get started">
        <div className="home-cta-inner">
          <h2>Ready to press play?</h2>
          <p>Join Framehouse today. Stream premium films, then meet face to face, all in one place.</p>
          <div className="home-cta-actions">
            <button className="primary-button" onClick={() => (user ? navigate("browse") : openAuth())}>
              {user ? "Explore the library" : "Get started free"}
              <Icon name="arrow-right" size={16} />
            </button>
            <button className="line-button" onClick={() => navigate("pricing")}>View plans</button>
          </div>
        </div>
      </section>
    </>
  );
}

function Dashboard({ videos, videosLoading, watchProgress, user, subscription, navigate, setToast, onVideoClick }: { videos: Video[]; videosLoading: boolean; watchProgress: any[]; user: User | null; subscription: any; navigate: (view: View) => void; setToast: (message: string) => void; onVideoClick: (video: Video) => void }) {
  const [meetingsCount, setMeetingsCount] = useState<number | null>(null);
  const [recentMeetings, setRecentMeetings] = useState<DashboardMeeting[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_URL}/meetings/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message || "Unable to load meetings.");
        const meetings = Array.isArray(data.meetings) ? data.meetings : [];
        setRecentMeetings(meetings);
        setMeetingsCount(meetings.length);
      })
      .catch((error) => {
        console.error("Unable to load dashboard meetings:", error);
        setMeetingsCount(null);
        setToast("Unable to load your meeting history.");
      });
  }, [setToast]);

  const totalWatchSeconds = watchProgress.reduce((total, item) => total + (Number(item.progress) || 0), 0);
  const videosWatchedCount = watchProgress.filter((item) => Number(item.progress) > 0).length;
  const watchHours = Math.floor(totalWatchSeconds / 3600);
  const watchMinutes = Math.floor((totalWatchSeconds % 3600) / 60);
  const watchTimeLabel = watchHours > 0 ? `${watchHours}h ${watchMinutes}m` : `${watchMinutes}m`;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return <div className="page-wrap dashboard-page">
    <div className="page-heading"><div><span className="eyebrow">YOUR STUDIO</span><h1>{greeting}, {user?.name?.split(" ")[0] || "friend"}.</h1><p>Pick up where you left off.</p></div><div className="dashboard-heading-actions"><button className="primary-button" onClick={() => navigate("meetings")}><Icon name="video" size={16} />Create or join a meeting</button><button className="secondary-button" onClick={() => navigate("browse")}>Browse library</button></div></div>
    <RevealGroup className="dashboard-stats">
      <RevealItem className="stat-card" lift={false}><span>Watch time</span><strong>{watchTimeLabel}</strong></RevealItem>
      <RevealItem className="stat-card" lift={false}><span>Videos watched</span><strong>{videosWatchedCount}</strong></RevealItem>
      <RevealItem className="stat-card" lift={false}><span>Subscription</span><strong>{subscription?.plan || "Free"}</strong></RevealItem>
      <RevealItem className="stat-card" lift={false}><span>Meetings</span><strong>{meetingsCount === null ? "—" : meetingsCount}</strong></RevealItem>
    </RevealGroup>
    <section className="dashboard-meeting-history" aria-labelledby="dashboard-meetings-title">
      <div className="dashboard-section-heading">
        <div><span className="eyebrow">YOUR ROOMS</span><h2 id="dashboard-meetings-title">Recent meetings</h2></div>
        <button className="line-button" onClick={() => navigate("meetings")}>Open meetings <Icon name="arrow-right" size={14} /></button>
      </div>
      {recentMeetings.length ? (
        <div className="dashboard-meeting-list">
          {recentMeetings.slice(0, 3).map((meeting) => (
            <article className="dashboard-meeting-item" key={meeting._id}>
              <span className={`meeting-status-pill ${meeting.status}`}>
                <i />{meeting.status === "live" ? "Live" : "Ended"}
              </span>
              <div className="dashboard-meeting-details">
                <h3>{meeting.title}</h3>
                <p>{meeting.type === "one-to-one" ? "One-to-one" : "Group"} · {new Date(meeting.createdAt).toLocaleDateString()}</p>
              </div>
              <code>{meeting.roomId}</code>
              <button className="secondary-button" onClick={() => navigate("meetings")}>Open meeting lobby</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="dashboard-meetings-empty">
          <span className="empty-icon"><Icon name="video" size={19} /></span>
          <div><strong>No meetings yet</strong><p>Create a room or join one with a meeting ID to get started.</p></div>
          <button className="secondary-button" onClick={() => navigate("meetings")}>Go to meetings</button>
        </div>
      )}
    </section>
    <ContinueWatching watchProgress={watchProgress} onVideoClick={onVideoClick} /> <SectionIntro label="RECOMMENDED FOR YOU" title="Your library" />{videosLoading ? <LoadingState /> : videos.length ? <div className="video-grid">{videos.map((video) => <VideoCard key={video._id || video.title} video={video} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onClick={() => onVideoClick(video)} />)}</div> : <EmptyState />}<SubscriptionCard subscription={subscription} navigate={navigate} />
  </div>;
}

function Browse({ videos, videosLoading, user, subscription, navigate, setToast, onVideoClick, query, setQuery }: { videos: Video[]; videosLoading: boolean; user: User | null; subscription: any; navigate: (view: View) => void; setToast: (message: string) => void; onVideoClick: (video: Video) => void; query: string; setQuery: (value: string) => void }) { const [category, setCategory] = useState("All films"); const [access, setAccess] = useState<"all" | "premium" | "free">("all"); const filtered = useMemo(() => videos.filter((video) => (category === "All films" || video.category === category) && (access === "all" || (access === "premium" ? Boolean(video.premium) : !video.premium)) && video.title.toLowerCase().includes(query.toLowerCase())), [videos, category, access, query]); return <div className="page-wrap browse-page"><div className="page-heading"><div><span className="eyebrow">THE LIBRARY</span><h1>Find your next story.</h1><p>Thoughtful films, series, and conversations, all in one place.</p></div><div className="search-field"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the library" /></div></div><div className="filter-row">{(["all", "premium", "free"] as const).map((item) => <button key={item} className={access === item ? "selected" : ""} onClick={() => setAccess(item)}>{item === "all" ? "All videos" : item === "premium" ? "Premium" : "Free"}</button>)}</div><div className="filter-row">{["All films", ...Array.from(new Set(videos.map((video) => video.category)))].map((item) => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>{videosLoading ? <LoadingState /> : filtered.length ? <div className="video-grid browse-grid">{filtered.map((video) => <VideoCard key={video._id || video.title} video={video} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onClick={() => onVideoClick(video)} />)}</div> : <EmptyState query={query} />}</div>; }

function ContinueWatching({ watchProgress, onVideoClick }: { watchProgress: any[]; onVideoClick: (video: Video, startAt?: number) => void }) { const continueWatching = watchProgress.filter((item) => item.video && !item.completed && item.progress > 0).map((item) => ({ ...item.video, progress: item.duration > 0 ? Math.min(100, Math.round((item.progress / item.duration) * 100)) : 0, resumeSeconds: item.progress })); return <section className="continue-watching"><SectionIntro label="CONTINUE WATCHING" title="Pick up where you left off" />{continueWatching.length === 0 ? <div className="empty-state"><h3>No videos in progress</h3><p>Start watching a video and your progress will appear here.</p></div> : <div className="video-grid">{continueWatching.map((video) => <article key={video._id} className="continue-video-card" role="button" tabIndex={0} aria-label={`Resume ${video.title}, ${video.progress}% watched`} onClick={() => onVideoClick(video, video.resumeSeconds)} onKeyDown={onActivateKey(() => onVideoClick(video, video.resumeSeconds))}><div className="video-thumbnail"><img src={video.thumbnail || video.image || FALLBACK_THUMBNAIL} onError={handleImageError} alt={video.title} /><span className="continue-progress">{video.progress}% watched</span></div><div className="video-card-content"><h3>{video.title}</h3><p>{video.category}</p><div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${video.progress}%` }} /></div></div></article>)}</div>}</section>; }

function VideoCard({ video, large = false, user, subscription, navigate, setToast, onClick }: { video: Video; large?: boolean; user?: User | null; subscription?: any; navigate?: (view: View) => void; setToast?: (message: string) => void; onClick?: () => void }) { return <SharedVideoCard video={video} large={large} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onClick={onClick} />; }

function SubscriptionCard({ subscription, navigate }: { subscription: any; navigate: (view: View) => void }) { return <SharedSubscriptionCard subscription={subscription} navigate={navigate} />; }
function Profile({ user, subscription, logout, watchProgress, onVideoClick, navigate, setToast }: { user: User | null; subscription: any; logout: () => void; watchProgress: any[]; onVideoClick: (video: Video, startAt?: number) => void; navigate: (view: View) => void; setToast: (message: string) => void }) {
  const [tab, setTab] = useState<"overview" | "history" | "downloads">("overview");
  const history = watchProgress.filter((item) => item.video);

  return <div className="page-wrap narrow-page">
    <div className="page-heading"><div><span className="eyebrow">ACCOUNT</span><h1>Your profile.</h1></div></div>
    <div className="profile-card">
      <div className="profile-avatar">{user?.name?.slice(0, 1).toUpperCase() || "F"}</div>
      <div><h2>{user?.name || "Framehouse member"}</h2><p>{user?.email}</p><span className="profile-badge">{subscription?.plan || "Free member"}</span></div>
    </div>

    <div className="tab-row" role="tablist" aria-label="Profile sections">
      <button role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "selected" : ""} onClick={() => setTab("overview")}>Overview</button>
      <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "selected" : ""} onClick={() => setTab("history")}>Watch history</button>
      <button role="tab" aria-selected={tab === "downloads"} className={tab === "downloads" ? "selected" : ""} onClick={() => setTab("downloads")}>Downloads</button>
    </div>

    {tab === "overview" && (
      <div className="info-grid">
        <div><strong>Email</strong><p>{user?.email}</p></div>
        <div><strong>Subscription</strong><p>{subscription?.plan ? `${subscription.plan} member${subscription.expiryDate ? ` · until ${new Date(subscription.expiryDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}` : "Free member"}</p><button className="line-button" onClick={() => navigate("subscription")}>Manage subscription<Icon name="arrow-right" size={14} /></button></div>
      </div>
    )}

    {tab === "history" && (
      history.length === 0 ? (
        <div className="empty-state"><span className="empty-icon"><Icon name="film" size={22} /></span><h2>Your watch history is empty</h2><p>Videos you watch will appear here.</p></div>
      ) : (
        <div className="video-grid">
          {history.map((item) => {
            const progressPercent = item.duration > 0 ? Math.min(100, Math.round((item.progress / item.duration) * 100)) : 0;
            return (
              <article key={item._id || item.video._id} className="continue-video-card" role="button" tabIndex={0} aria-label={`Watch ${item.video.title}`} onClick={() => onVideoClick(item.video, item.progress)} onKeyDown={onActivateKey(() => onVideoClick(item.video, item.progress))}>
                <div className="video-thumbnail"><img src={item.video.thumbnail || item.video.image || FALLBACK_THUMBNAIL} onError={handleImageError} alt={item.video.title} /><span className="continue-progress">{progressPercent}% watched</span></div>
                <div className="video-card-content"><h3>{item.video.title}</h3><p>{item.video.category}</p></div>
              </article>
            );
          })}
        </div>
      )
    )}

    {tab === "downloads" && <DownloadsPanel onUpgrade={() => navigate("pricing")} setToast={setToast} />}

    <button className="danger-button" onClick={logout}>Sign out</button>
  </div>;
}
function Settings({ logout, navigate, setToast }: { logout: () => void; navigate: (view: View) => void; setToast: (message: string) => void }) {
  const [tab, setTab] = useState<"account" | "appearance">("account");
  const [reduceMotion, setReduceMotion] = useState(() => localStorage.getItem("pref_reduce_motion") === "true");
  // "auto" follows the sign-in time (light 5 AM to 12 PM IST); light / dark are a fixed choice saved to the account.
  const [themePref, setThemePref] = useState<ThemePreference>(() => {
    try { const stored = JSON.parse(localStorage.getItem("user") || "{}"); return stored.themeSource === "manual" ? (stored.theme === "light" ? "light" : "dark") : "auto"; } catch { return "auto"; }
  });
  const [themeBusy, setThemeBusy] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduceMotion);
    localStorage.setItem("pref_reduce_motion", String(reduceMotion));
  }, [reduceMotion]);

  const chooseTheme = async (next: ThemePreference) => {
    if (themeBusy || next === themePref) return;
    setThemeBusy(true);
    try {
      const result = await setThemePreference(next);
      applyTheme(result.theme);
      setThemePref(next);
      try { localStorage.setItem("user", JSON.stringify({ ...JSON.parse(localStorage.getItem("user") || "{}"), theme: result.theme, themeSource: result.themeSource })); } catch { /* ignore */ }
      setToast(next === "auto" ? `Automatic theme is on. It's ${result.theme} right now.` : `${result.theme === "light" ? "Light" : "Dark"} theme saved to your account.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Couldn't save your theme.");
    } finally { setThemeBusy(false); }
  };

  const themeOptions: { value: ThemePreference; label: string; hint: string; icon: "sun" | "moon" | "sparkle" }[] = [
    { value: "light", label: "Light", hint: "Always light", icon: "sun" },
    { value: "dark", label: "Dark", hint: "Always dark", icon: "moon" },
    { value: "auto", label: "Automatic", hint: "Light 5 AM to 12 PM IST at sign-in, dark otherwise", icon: "sparkle" },
  ];

  return <div className="page-wrap narrow-page">
    <div className="page-heading"><div><span className="eyebrow">PREFERENCES</span><h1>Settings.</h1></div></div>
    <div className="tab-row" role="tablist" aria-label="Settings sections">
      <button role="tab" aria-selected={tab === "account"} className={tab === "account" ? "selected" : ""} onClick={() => setTab("account")}>Account</button>
      <button role="tab" aria-selected={tab === "appearance"} className={tab === "appearance" ? "selected" : ""} onClick={() => setTab("appearance")}>Appearance</button>
    </div>

    {tab === "account" && (
      <div className="settings-list">
        <div className="settings-toggle-row">
          <div><strong>Account security</strong><small>Sign-in history, trusted browsers and active sessions.</small></div>
          <button className="settings-link" onClick={() => navigate("security")}>Review<Icon name="arrow-right" size={14} /></button>
        </div>
        <div className="settings-toggle-row">
          <div><strong>Session</strong><small>Sign out of Framehouse on this device.</small></div>
          <button className="danger-button" onClick={logout}>Sign out</button>
        </div>
      </div>
    )}

    {tab === "appearance" && (
      <div className="settings-list">
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {themeOptions.map((option) => (
            <button key={option.value} type="button" role="radio" aria-checked={themePref === option.value} className={`theme-option ${themePref === option.value ? "selected" : ""}`} onClick={() => void chooseTheme(option.value)} disabled={themeBusy}>
              <Icon name={option.icon} size={20} />
              <strong>{option.label}</strong>
              <small>{option.hint}</small>
            </button>
          ))}
        </div>
        <label className="settings-toggle-row">
          <div><strong>Reduce motion</strong><small>Minimize animations and transitions across the app.</small></div>
          <input type="checkbox" checked={reduceMotion} onChange={(event) => setReduceMotion(event.target.checked)} />
        </label>
      </div>
    )}
  </div>;
}
function AdminDashboard({ loadVideos, setToast }: { loadVideos: () => Promise<void>; setToast: (message: string) => void }) {
  // The public list hides stream URLs, so the admin view loads its own copy with them.
  const [videos, setVideos] = useState<Video[]>([]);
  const refresh = async () => {
    try { const response = await fetch(`${API_URL}/videos/admin/all`, { headers: authHeaders() }); const data = await response.json(); if (response.ok && data.success) setVideos(data.videos || []); } catch { setToast("Couldn't load videos"); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);
  const emptyForm = { title: "", description: "", category: "", thumbnail: "", videoUrl: "", duration: "", minPlan: "Free" as PlanName, earlyAccessUntil: "" };
  const [showForm, setShowForm] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [form, setForm] = useState(emptyForm);

  const openAdd = () => { setEditingVideo(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (video: Video) => { setEditingVideo(video); setForm({ title: video.title || "", description: video.description || "", category: video.category || "", thumbnail: video.thumbnail || video.image || "", videoUrl: video.videoUrl || "", duration: video.duration || "", minPlan: (video.minPlan || (video.premium ? "Bronze" : "Free")) as PlanName, earlyAccessUntil: video.earlyAccessUntil ? video.earlyAccessUntil.slice(0, 10) : "" }); setShowForm(true); };
  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { const { name, value, type } = event.target; setForm((previous) => ({ ...previous, [name]: type === "checkbox" ? (event.target as HTMLInputElement).checked : value })); };
  const saveVideo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const token = localStorage.getItem("token"); if (!token) { setToast("Please login again"); return; }
    try { const url = editingVideo?._id ? `${API_URL}/videos/${editingVideo._id}` : `${API_URL}/videos`; const response = await fetch(url, { method: editingVideo?._id ? "PUT" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...form, earlyAccessUntil: form.earlyAccessUntil || null }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "Failed to save video"); setToast(editingVideo ? "Video updated successfully" : "Video added successfully"); setShowForm(false); setEditingVideo(null); setForm(emptyForm); await refresh(); await loadVideos(); } catch (error) { setToast(error instanceof Error ? error.message : "Failed to save video"); }
  };
  const deleteVideo = async (id?: string) => { if (!id || !window.confirm("Are you sure you want to delete this video?")) return; const token = localStorage.getItem("token"); try { const response = await fetch(`${API_URL}/videos/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "Failed to delete video"); setToast("Video deleted successfully"); await refresh(); await loadVideos(); } catch (error) { setToast(error instanceof Error ? error.message : "Failed to delete video"); } };

  return <main className="admin-page"><div className="admin-header"><div><span className="eyebrow">Admin panel</span><h1>Video management</h1><p>Add, edit and publish titles in your library.</p></div><button className="primary-button" onClick={openAdd}><Icon name="plus" size={16} />Add video</button></div>{showForm && <form className="admin-video-form" onSubmit={saveVideo}><h2>{editingVideo ? "Edit video" : "Add a new video"}</h2><div className="admin-form-grid"><label className="span-2">Title<input name="title" placeholder="e.g. The Last Frame" value={form.title} onChange={handleChange} required /></label><label className="span-2">Description<textarea name="description" placeholder="A short synopsis shown on the watch page" value={form.description} onChange={handleChange} /></label><label>Category<input name="category" placeholder="e.g. Documentary" value={form.category} onChange={handleChange} required /></label><label>Duration<input name="duration" placeholder="e.g. 25:30" value={form.duration} onChange={handleChange} /></label><label className="span-2">Thumbnail URL<input name="thumbnail" type="url" placeholder="https://…" value={form.thumbnail} onChange={handleChange} required /></label><label className="span-2">Video URL<input name="videoUrl" type="url" placeholder="https://… (MP4)" value={form.videoUrl} onChange={handleChange} required /></label></div><div className="admin-form-grid"><label>Who can watch<select name="minPlan" value={form.minPlan} onChange={handleChange}><option value="Free">Everyone (free)</option><option value="Bronze">Premium: Bronze and above</option><option value="Silver">Silver and above</option><option value="Gold">Gold only (exclusive course)</option></select></label><label>Early access until (optional)<input name="earlyAccessUntil" type="date" value={form.earlyAccessUntil} onChange={handleChange} /></label></div><p className="admin-hint">Before the early-access date, only Silver and Gold members can watch. Free members can use their 3 monthly premium views on Bronze-level videos only.</p><div className="admin-form-actions"><button type="submit" className="primary-button">{editingVideo ? "Save changes" : "Publish video"}</button><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button></div></form>}<UpiApprovals setToast={setToast} /><div className="admin-video-list"><div className="admin-list-header"><h2>Library</h2><span>{videos.length} {videos.length === 1 ? "video" : "videos"}</span></div>{videos.map((video) => <div className="admin-video-row" key={video._id}><img src={video.thumbnail || video.image || FALLBACK_THUMBNAIL} onError={handleImageError} alt={video.title} /><div className="admin-video-info"><h3>{video.title}</h3><p>{video.category}{video.duration ? ` · ${video.duration}` : ""}</p><span className={(video.minPlan || (video.premium ? "Bronze" : "Free")) === "Free" ? "free-badge" : "premium-badge"}>{(video.minPlan || (video.premium ? "Bronze" : "Free")) === "Free" ? "Free" : `${video.minPlan || "Bronze"}+`}</span>{video.earlyAccessUntil && new Date(video.earlyAccessUntil) > new Date() ? <span className="premium-badge">Early access</span> : null}</div><div className="admin-actions"><button onClick={() => openEdit(video)}>Edit</button><button onClick={() => deleteVideo(video._id)}>Delete</button></div></div>)}</div></main>;
}
function LoadingState() { return <LoadingSkeleton count={4} />; }
function EmptyState({ query }: { query?: string } = {}) { return <div className="empty-state"><span className="empty-icon"><Icon name={query ? "search" : "film"} size={22} /></span><h2>{query ? "No videos found" : "No videos yet"}</h2><p>{query ? `We couldn't find anything matching "${query}". Try a different search.` : "New titles will appear here as soon as they're published."}</p></div>; }
function SectionIntro({ label, title, action, onAction }: { label: string; title: string; action?: string; onAction?: () => void }) { return <Reveal className="section-intro"><div><span className="eyebrow">{label}</span><h2>{title}</h2></div>{action && <button className="line-button" onClick={onAction}>{action}<Icon name="arrow-right" size={14} /></button>}</Reveal>; }
function Footer({ navigate }: { navigate: (view: View) => void }) { return <SharedFooter navigate={navigate} />; }
function AuthModal({ mode, setMode, loading, submit, close, otp, onVerify, onResend, onCancelOtp, setToast = () => {} }: { mode: AuthMode; setMode: (mode: AuthMode) => void; loading: boolean; submit: (event: FormEvent<HTMLFormElement>, mode: AuthMode) => void; close: () => void; otp: OtpChallenge | null; onVerify: (code: string, trust: boolean, days: number) => Promise<string | null>; onResend: () => Promise<string | null>; onCancelOtp: () => void; setToast?: (message: string) => void }) {
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const passwordField = (
    name: "password" | "confirmPassword",
    label: string,
    autoComplete: "current-password" | "new-password"
  ) => (
    <label key={name}>
      {label}
      <span className="password-input-wrap">
        <input
          name={name}
          type={showPassword ? "text" : "password"}
          placeholder="••••••••"
          autoComplete={autoComplete}
          required
          minLength={name === "password" && autoComplete === "new-password" ? 8 : undefined}
        />
        <button
          type="button"
          className="password-visibility-toggle"
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          onClick={() => setShowPassword((visible) => !visible)}
        >
          <Icon name={showPassword ? "eye-off" : "eye"} size={17} />
        </button>
      </span>
    </label>
  );

  return (
    <DialogMotion className="auth-modal" onBackdrop={close} labelledBy="auth-title">
      <button className="modal-close" onClick={close} aria-label="Close">×</button>
      <div className="auth-art">
        <span className="eyebrow">FRAMEHOUSE MEMBERSHIP</span>
        <h2>Stay curious.<br /><em>Stay awhile.</em></h2>
      </div>
      <div className="auth-form-wrap">
        {otp ? (
          <OtpStep challenge={otp} busy={loading} onVerify={onVerify} onResend={onResend} onCancel={onCancelOtp} />
        ) : showForgotPassword ? (
          <ForgotPasswordForm onBack={() => setShowForgotPassword(false)} onComplete={(message) => setToast(message)} />
        ) : (
          <>
            <span className="eyebrow">{mode === "login" ? "WELCOME BACK" : "JOIN THE CLUB"}</span>
            <h2 id="auth-title">{mode === "login" ? "Sign in to continue" : "Create your account"}</h2>
            <form key={mode} onSubmit={(event) => submit(event, mode)}>
              {mode === "register" && (
                <label>Full name<input name="name" placeholder="Alex Morgan" autoComplete="name" required autoFocus /></label>
              )}
              <label>Email address<input name="email" type="email" placeholder="you@example.com" autoComplete="email" required autoFocus={mode === "login"} /></label>
              {mode === "register" && (
                <label>Mobile number (optional)<input name="phone" type="tel" placeholder="+919876543210" autoComplete="tel" /></label>
              )}
              {passwordField("password", "Password", mode === "login" ? "current-password" : "new-password")}
              {mode === "login" && (
                <button className="forgot-password-link" type="button" onClick={() => setShowForgotPassword(true)}>
                  Forgot password?
                </button>
              )}
              {mode === "register" && passwordField("confirmPassword", "Confirm password", "new-password")}
              <button className="primary-button full" type="submit" disabled={loading}>
                {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
            <p className="auth-switch">
              {mode === "login" ? "New to Framehouse?" : "Already a member?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setShowPassword(false);
                  setMode(mode === "login" ? "register" : "login");
                }}
              >
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </>
        )}
      </div>
    </DialogMotion>
  );
}

function WatchVideo({ video, playback, startAt = 0, goBack, videos, user, subscription, navigate, setToast, onVideoClick, openAuth }: { openAuth: () => void; video: Video; playback: Playback | null; startAt?: number; goBack: () => void; videos: Video[]; user: User | null; subscription: any; navigate: (view: View) => void; setToast: (message: string) => void; onVideoClick: (video: Video) => void }) {
  const [savedProgress, setSavedProgress] = useState(startAt);
  // Set by the server's heartbeat reply when today's watch limit is used up.
  const [limitReached, setLimitReached] = useState(false);
  const [watchLeft, setWatchLeft] = useState<number | null>(playback?.watch.remainingSeconds ?? null);

  useEffect(() => {
    const loadProgress = async () => {
      const token = localStorage.getItem("token");

      if (!token || !video._id) {
        return;
      }

      try {
        const response = await fetch(`${API_URL}/watch-progress`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();

        if (response.ok) {
          const saved = data.progress?.find(
            (item: any) => item.video?._id === video._id || item.video === video._id
          );

          if (saved) setSavedProgress(Number(saved.progress) || 0);
        }
      } catch (error) {
        console.error("Load video progress error:", error);
      } finally {
      }
    };

    loadProgress();
  }, [video._id]);

  const saveProgress = async (progressValue: number, durationValue: number) => {
    const token = localStorage.getItem("token");

    if (!token || !video._id) return;

    try {
      const response = await fetch(`${API_URL}/watch-progress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          videoId: video._id,
          progress: progressValue,
          duration: durationValue,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.watch) setWatchLeft(data.watch.remainingSeconds);
      if (data.limitReached) setLimitReached(true);
    } catch (error) {
      console.error("Progress save error:", error);
    }
  };

  const [quota, setQuota] = useState<DownloadQuota | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!user) return;
    getQuota().then(setQuota).catch(() => setQuota(null));
  }, [user, video._id]);

  const downloadVideo = async () => {
    if (!user) {
      setToast("Sign in to download videos.");
      return;
    }
    if (!video._id) return;
    setDownloading(true);
    try {
      const result = await startDownload(video._id);
      setQuota(result.quota);
      setToast(result.counted ? `Download started. ${result.quota.remaining} left today.` : "Download started. It didn't use your quota.");
    } catch (error) {
      if (error instanceof DownloadError) {
        if (error.quota) setQuota(error.quota);
        setToast(error.message);
        if (error.code === "subscription-required" || error.code === "subscription-expired") navigate("pricing");
      } else {
        setToast("Download couldn't start. Please try again.");
      }
    } finally {
      setDownloading(false);
    }
  };

  const recommended = videos.filter((item) => item._id !== video._id && item.category === video.category).slice(0, 4);

  return <main className="watch-page">
    <button className="back-button" onClick={goBack}><Icon name="arrow-left" size={16} />Back to library</button>
    <div className="video-player-wrapper">
      {video.videoUrl ? <VideoPlayer video={video} startAt={savedProgress} blocked={limitReached} quality={playback?.quality} nextVideo={recommended[0]} onAutoPlayNext={() => { if (recommended[0]) onVideoClick(recommended[0]); }} onProgress={(progress, duration) => { if (video._id) saveProgress(progress, duration); }} /> : <div className="player-error"><strong>Video unavailable</strong><p>This video URL is not playable yet. Add a real MP4 URL to the video record.</p></div>}
      {limitReached && (
        <div className="player-limit" role="alert">
          <strong>You've reached today's watch limit</strong>
          <p>Your {playback?.plan || "Free"} plan includes {playback?.watch.limitSeconds ? Math.round(playback.watch.limitSeconds / 60) : 60} minutes a day. It resets {playback?.watch.resetsAt ? `at ${new Date(playback.watch.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "tomorrow"}.</p>
          <button className="primary-button" onClick={() => navigate("pricing")}>Upgrade for more watch time</button>
        </div>
      )}
    </div>
    {playback && (
      <div className="playback-strip">
        <span><Icon name="hd" size={15} />Streaming up to {playback.maxQuality} on {playback.plan}</span>
        {watchLeft !== null && !limitReached && <span>{Math.max(0, Math.floor(watchLeft / 60))} min of watch time left today</span>}
        {playback.unlockedWithAllowance && <span>Unlocked with a free premium view</span>}
        {playback.plan !== "Gold" && <button className="line-button" onClick={() => navigate("pricing")}>Upgrade<Icon name="arrow-right" size={13} /></button>}
      </div>
    )}
    {playback?.ads && (
      <aside className="house-ad" aria-label="Advertisement">
        <span className="house-ad-label">Advertisement</span>
        <div>
          <strong>Watch without ads</strong>
          <p>Bronze removes ads, unlocks every premium film and streams in HD. From ₹199 a month.</p>
        </div>
        <button className="secondary-button small" onClick={() => navigate("pricing")}>Go ad-free</button>
      </aside>
    )}
    <div className="watch-info">
      <span className="video-category">{video.category}</span>
      <h1>{video.title}</h1>
      <div className="watch-meta">
        <span>{Number(video.views).toLocaleString()} views</span>
        {video.createdAt && <span>{new Date(video.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>}
        <span>{video.duration}</span>
      </div>
      <div className="watch-actions">
        <button className="primary-button" onClick={() => void downloadVideo()} disabled={downloading || !video.videoUrl}><Icon name="download" size={16} />{downloading ? "Preparing…" : "Download"}</button>
        <ShareMenu url={window.location.href} title={video.title} onNotify={setToast} />
        {quota && <span className="download-hint">{quota.remaining > 0 ? `${quota.remaining} of ${quota.daily.limit} downloads left today` : `Daily limit reached · resets ${new Date(quota.daily.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}</span>}
      </div>
      {video.description && <p className="watch-description">{video.description}</p>}
    </div>

    {video._id && <div className="watch-comments"><Comments key={video._id} videoId={video._id} signedIn={Boolean(user)} openAuth={openAuth} setToast={setToast} /></div>}

    {recommended.length > 0 && (
      <section className="content-section recommended-section">
        <SectionIntro label="UP NEXT" title="Recommended for you" />
        <div className="video-grid">
          {recommended.map((item) => <VideoCard key={item._id || item.title} video={item} user={user} subscription={subscription} navigate={navigate} setToast={setToast} onClick={() => onVideoClick(item)} />)}
        </div>
      </section>
    )}
  </main>;
}

export default App;
