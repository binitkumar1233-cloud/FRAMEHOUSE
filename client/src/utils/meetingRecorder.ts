/**
 * Records a meeting locally in the browser.
 *
 * Video: every element marked `data-record-tile` inside `root` is drawn
 * into a 1280x720 grid on a canvas. Audio: all given streams are mixed.
 * Nothing is uploaded — the result is saved to the recording user's device.
 */

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;

const MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export const recordingSupported = () =>
  typeof window !== "undefined" &&
  "MediaRecorder" in window &&
  typeof HTMLCanvasElement.prototype.captureStream === "function";

export class MeetingRecorder {
  private canvas = document.createElement("canvas");
  private context2d = this.canvas.getContext("2d")!;
  private audioContext = new AudioContext();
  private destination = this.audioContext.createMediaStreamDestination();
  private connected = new Map<string, MediaStreamAudioSourceNode>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer = 0;
  private mimeType = "";
  private root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
  }

  /** Keeps the audio mix in sync with who is in the call. */
  setAudioStreams(streams: MediaStream[]) {
    const live = new Set<string>();

    for (const stream of streams) {
      for (const track of stream.getAudioTracks()) {
        live.add(track.id);
        if (this.connected.has(track.id) || track.readyState === "ended") continue;
        const source = this.audioContext.createMediaStreamSource(new MediaStream([track]));
        source.connect(this.destination);
        this.connected.set(track.id, source);
      }
    }

    for (const [id, source] of this.connected) {
      if (!live.has(id)) {
        source.disconnect();
        this.connected.delete(id);
      }
    }
  }

  start() {
    void this.audioContext.resume();

    this.mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const stream = new MediaStream([
      ...this.canvas.captureStream(FPS).getVideoTracks(),
      ...this.destination.stream.getAudioTracks(),
    ]);

    this.recorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start(1000);

    // setInterval keeps drawing when the tab is in the background (rAF would pause).
    this.timer = window.setInterval(() => this.draw(), 1000 / FPS);
  }

  /** Stops recording and resolves with the finished file. */
  stop(): Promise<Blob> {
    window.clearInterval(this.timer);

    return new Promise((resolve) => {
      const recorder = this.recorder;
      const finish = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || "video/webm" });
        this.connected.forEach((source) => source.disconnect());
        this.connected.clear();
        void this.audioContext.close();
        resolve(blob);
      };

      if (!recorder || recorder.state === "inactive") {
        finish();
        return;
      }
      recorder.onstop = finish;
      recorder.stop();
    });
  }

  get extension() {
    return this.mimeType.includes("mp4") ? "mp4" : "webm";
  }

  private draw() {
    const ctx = this.context2d;
    const tiles = Array.from(this.root.querySelectorAll<HTMLElement>("[data-record-tile]"));

    ctx.fillStyle = "#07080c";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (!tiles.length) return;

    const columns = Math.ceil(Math.sqrt(tiles.length));
    const rows = Math.ceil(tiles.length / columns);
    const gap = 8;
    const cellWidth = (WIDTH - gap * (columns + 1)) / columns;
    const cellHeight = (HEIGHT - gap * (rows + 1)) / rows;

    tiles.forEach((tile, index) => {
      const x = gap + (index % columns) * (cellWidth + gap);
      const y = gap + Math.floor(index / columns) * (cellHeight + gap);
      const video = tile.querySelector("video");
      const name = tile.dataset.recordTile || "";

      ctx.fillStyle = "#12151d";
      ctx.fillRect(x, y, cellWidth, cellHeight);

      if (video && video.readyState >= 2 && video.videoWidth && tile.dataset.videoOn === "true") {
        // Cover-fit the video into the cell.
        const scale = Math.max(cellWidth / video.videoWidth, cellHeight / video.videoHeight);
        const drawWidth = video.videoWidth * scale;
        const drawHeight = video.videoHeight * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cellWidth, cellHeight);
        ctx.clip();
        ctx.drawImage(video, x + (cellWidth - drawWidth) / 2, y + (cellHeight - drawHeight) / 2, drawWidth, drawHeight);
        ctx.restore();
      } else {
        ctx.fillStyle = "#2f7bff";
        ctx.beginPath();
        ctx.arc(x + cellWidth / 2, y + cellHeight / 2, Math.min(cellWidth, cellHeight) * 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${Math.round(Math.min(cellWidth, cellHeight) * 0.12)}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(name.charAt(0).toUpperCase(), x + cellWidth / 2, y + cellHeight / 2);
      }

      ctx.font = "600 16px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const labelWidth = ctx.measureText(name).width + 20;
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(x + 10, y + cellHeight - 36, labelWidth, 26);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name, x + 20, y + cellHeight - 18);
    });
  }
}

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
