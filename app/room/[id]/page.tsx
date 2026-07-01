"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, uploadStrip, supabaseReady } from "@/lib/supabase";

/* WebRTC ICE servers. STUN handles most connections; the free public
 * Open Relay TURN servers relay media when a strict/symmetric NAT would
 * otherwise block the peer-to-peer connection (common on mobile data). */
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/* ------------------------------------------------------------------ *
 * Constants for the captured frames + the final strip layout.
 * ------------------------------------------------------------------ */
const HALF_W = 420; // width of ONE person's half of a combined photo
const HALF_H = 520; // height of a combined photo
const COMBINED_ASPECT = (HALF_W * 2) / HALF_H;

const STRIP_W = 520;
const PAD = 22;
const GAP = 14;
const FOOTER = 120;
const CELL_W = STRIP_W - PAD * 2;
const CELL_H = Math.round(CELL_W / COMBINED_ASPECT);
const STRIP_H = PAD + 4 * CELL_H + 3 * GAP + FOOTER + PAD;

type Status = "connecting" | "waiting" | "ready" | "full";

/* Filter definitions: `css` is applied while drawing each photo; the
 * boolean flags trigger whole-strip overlays drawn afterward. */
const FILTERS: Record<
  string,
  { css: string; vignette?: boolean; grain?: boolean; blue?: boolean }
> = {
  Original: { css: "none" },
  Mono: { css: "grayscale(1)" },
  Retro: { css: "sepia(0.55) contrast(0.9) brightness(1.05)", vignette: true },
  Film: { css: "contrast(1.15) brightness(0.94) saturate(1.05)", grain: true },
  Cool: { css: "saturate(1.1)", blue: true },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Draw a video/image into a box using object-fit: cover (center crop). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}

function todayLabel() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export default function Room({ params }: { params: { id: string } }) {
  const roomId = params.id;

  const [status, setStatus] = useState<Status>("connecting");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Editor state
  const [filter, setFilter] = useState("Original");
  const [bgColor, setBgColor] = useState("#ffd7e4");
  const [names, setNames] = useState({ me: "Me", partner: "Mayaa" });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "cloud" | "local">("idle");
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const peerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const myIdRef = useRef<string>("");
  const creatingRef = useRef(false);
  const runningRef = useRef(false);
  const runRef = useRef<() => void>(() => {});

  /* ---------------------------------------------------------------- *
   * Init: camera -> Supabase Realtime channel -> WebRTC.
   * Signaling runs entirely over Supabase (works on Vercel — no server).
   * ---------------------------------------------------------------- */
  useEffect(() => {
    const sb = supabase;
    if (!sb) {
      // Realtime signaling requires Supabase to be configured.
      return;
    }
    let mounted = true;
    myIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

    const teardownPeer = () => {
      peerRef.current?.destroy?.();
      peerRef.current = null;
      creatingRef.current = false;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };

    const createPeer = async (initiator: boolean, channel: RealtimeChannel) => {
      if (peerRef.current || creatingRef.current || !streamRef.current) return;
      creatingRef.current = true;
      // Prebundled browser build ships its own Buffer/process polyfills.
      // @ts-expect-error no types for the prebundled entry
      const PeerMod = await import("simple-peer/simplepeer.min.js");
      const Peer = PeerMod.default;

      const peer = new Peer({
        initiator,
        stream: streamRef.current,
        trickle: true,
        config: { iceServers: ICE_SERVERS },
      });

      peer.on("signal", (d: unknown) =>
        channel.send({ type: "broadcast", event: "signal", payload: d })
      );
      peer.on("stream", (rs: MediaStream) => {
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = rs;
        setStatus("ready");
      });
      peer.on("error", (e: Error) => console.warn("[peer]", e.message));
      peer.on("close", () => teardownPeer());
      peerRef.current = peer;
    };

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 1280, height: 720 },
          audio: true,
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e: any) {
        setMediaError(
          e?.name === "NotAllowedError"
            ? "Camera and microphone access was blocked. Enable it in your browser and refresh."
            : "Couldn't access your camera. It may be in use by another application."
        );
        return;
      }

      const channel = sb.channel(`room-${roomId}`, {
        config: {
          broadcast: { self: false },
          presence: { key: myIdRef.current },
        },
      });
      channelRef.current = channel;

      // Relay WebRTC signaling from the partner into our peer.
      channel.on("broadcast", { event: "signal" }, ({ payload }) =>
        peerRef.current?.signal(payload)
      );
      // Partner pressed "Start session" — run the same sequence here.
      channel.on("broadcast", { event: "start" }, () => runRef.current());

      // Presence tells us who's in the room and who initiates the offer.
      channel.on("presence", { event: "sync" }, () => {
        const keys = Object.keys(channel.presenceState()).sort();
        const allowed = keys.slice(0, 2); // first two participants only
        if (!allowed.includes(myIdRef.current)) {
          setStatus("full");
          channel.untrack();
          return;
        }
        if (keys.length >= 2) {
          // Deterministic initiator: the lower-sorted id makes the offer.
          createPeer(allowed[0] === myIdRef.current, channel);
        } else {
          teardownPeer();
          setStatus("waiting");
        }
      });

      channel.subscribe(async (s) => {
        if (s === "SUBSCRIBED") {
          setStatus("waiting");
          await channel.track({ joinedAt: Date.now() });
        }
      });
    };

    init();

    return () => {
      mounted = false;
      channelRef.current?.unsubscribe();
      channelRef.current = null;
      peerRef.current?.destroy?.();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /* ---------------------------------------------------------------- *
   * Capture flow (runs identically on both peers, kicked by socket).
   * ---------------------------------------------------------------- */
  const captureCombined = useCallback(() => {
    const c = document.createElement("canvas");
    c.width = HALF_W * 2;
    c.height = HALF_H;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1a1016";
    ctx.fillRect(0, 0, c.width, c.height);

    const lv = localVideoRef.current;
    const rv = remoteVideoRef.current;
    if (lv) drawCover(ctx, lv, lv.videoWidth, lv.videoHeight, 0, 0, HALF_W, HALF_H);
    if (rv && rv.videoWidth)
      drawCover(ctx, rv, rv.videoWidth, rv.videoHeight, HALF_W, 0, HALF_W, HALF_H);
    else {
      ctx.fillStyle = "#ff8fab";
      ctx.font = "bold 26px Georgia";
      ctx.textAlign = "center";
      ctx.fillText("waiting…", HALF_W + HALF_W / 2, HALF_H / 2);
    }
    // thin divider between the two feeds
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(HALF_W - 1, 0, 2, HALF_H);
    return c.toDataURL("image/png");
  }, []);

  const triggerFlash = () => {
    const el = flashRef.current;
    if (!el) return;
    el.classList.remove("on");
    void el.offsetWidth; // reflow to restart animation
    el.classList.add("on");
  };

  const runSequence = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setEditing(false);
    setPhotos([]);
    setCapturing(true);

    const shots: string[] = [];
    for (let i = 0; i < 4; i++) {
      for (let c = 3; c >= 1; c--) {
        setCountdown(c);
        await sleep(1000);
      }
      setCountdown(null);
      triggerFlash();
      await sleep(130);
      shots.push(captureCombined());
      setPhotos([...shots]);
      if (i < 3) await sleep(2000);
    }

    setCapturing(false);
    setEditing(true);
    runningRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureCombined]);

  // Keep a stable ref so the Realtime "start" handler always calls the latest.
  useEffect(() => {
    runRef.current = runSequence;
  }, [runSequence]);

  const startBooth = () => {
    // Tell the partner to start, then run locally (broadcast has self:false).
    channelRef.current?.send({ type: "broadcast", event: "start" });
    runSequence();
  };

  /* ---------------------------------------------------------------- *
   * Editor: render the final strip to the canvas (also used for export).
   * ---------------------------------------------------------------- */
  const renderStrip = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || photos.length < 4) return;
    const ctx = canvas.getContext("2d")!;
    const f = FILTERS[filter];

    const imgs = await Promise.all(
      photos.map(
        (src) =>
          new Promise<HTMLImageElement>((res) => {
            const im = new Image();
            im.onload = () => res(im);
            im.src = src;
          })
      )
    );

    // Background
    ctx.filter = "none";
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, STRIP_W, STRIP_H);

    // Photos
    imgs.forEach((im, i) => {
      const y = PAD + i * (CELL_H + GAP);
      ctx.save();
      const r = 12;
      ctx.beginPath();
      ctx.moveTo(PAD + r, y);
      ctx.arcTo(PAD + CELL_W, y, PAD + CELL_W, y + CELL_H, r);
      ctx.arcTo(PAD + CELL_W, y + CELL_H, PAD, y + CELL_H, r);
      ctx.arcTo(PAD, y + CELL_H, PAD, y, r);
      ctx.arcTo(PAD, y, PAD + CELL_W, y, r);
      ctx.closePath();
      ctx.clip();
      ctx.filter = f.css;
      ctx.drawImage(im, PAD, y, CELL_W, CELL_H);
      ctx.restore();
    });
    ctx.filter = "none";

    // Footer text
    const footTop = PAD + 4 * CELL_H + 3 * GAP;
    ctx.textAlign = "center";
    ctx.fillStyle = "#5b3a4a";
    ctx.font = "italic 30px Georgia";
    ctx.fillText(`${names.me} & ${names.partner}`, STRIP_W / 2, footTop + 52);
    ctx.font = "16px Georgia";
    ctx.fillStyle = "rgba(91,58,74,0.7)";
    ctx.fillText(todayLabel(), STRIP_W / 2, footTop + 86);

    // ---- Whole-strip overlays ----
    if (f.vignette) {
      const g = ctx.createRadialGradient(
        STRIP_W / 2, STRIP_H / 2, STRIP_H * 0.2,
        STRIP_W / 2, STRIP_H / 2, STRIP_H * 0.62
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(40,20,10,0.4)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STRIP_W, STRIP_H);
    }
    if (f.blue) {
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(60,130,230,0.55)";
      ctx.fillRect(0, 0, STRIP_W, STRIP_H);
      ctx.globalCompositeOperation = "source-over";
    }
    if (f.grain) {
      const noise = ctx.createImageData(STRIP_W, STRIP_H);
      for (let i = 0; i < noise.data.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
        noise.data[i + 3] = 22; // low alpha grain
      }
      const nc = document.createElement("canvas");
      nc.width = STRIP_W;
      nc.height = STRIP_H;
      nc.getContext("2d")!.putImageData(noise, 0, 0);
      ctx.globalCompositeOperation = "overlay";
      ctx.drawImage(nc, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
  }, [photos, filter, bgColor, names]);

  useEffect(() => {
    if (editing) renderStrip();
  }, [editing, renderStrip]);

  /* ---------------------------------------------------------------- *
   * Actions
   * ---------------------------------------------------------------- */
  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const savePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");

    // 1) Local download
    const a = document.createElement("a");
    a.href = url;
    a.download = `photobooth-${roomId}.png`;
    a.click();

    // 2) Cloud upload (if Supabase configured)
    if (!supabaseReady) {
      setSaveState("local");
      return;
    }
    setSaveState("saving");
    const res = await uploadStrip(roomId, url);
    if (res) {
      setCloudUrl(res.url);
      setSaveState("cloud");
    } else {
      setSaveState("local");
    }
  };

  const retake = () => {
    setEditing(false);
    setPhotos([]);
    setSaveState("idle");
    setCloudUrl(null);
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  if (!supabaseReady) {
    return (
      <Centered>
        <p className="max-w-sm text-cocoa/80">
          Connection service isn&apos;t configured yet. Add your Supabase URL and
          anon key to the environment variables to enable live sessions.
        </p>
      </Centered>
    );
  }
  if (mediaError) {
    return (
      <Centered>
        <p className="mt-4 max-w-sm text-cocoa/80">{mediaError}</p>
      </Centered>
    );
  }
  if (status === "full") {
    return (
      <Centered>
        <p className="mt-4 text-cocoa/80">
          This room is already full. Create a new room to start a session.
        </p>
      </Centered>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <div ref={flashRef} className="flash" />

      {/* Header */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-cocoa">
          Photobooth{" "}
          <span className="text-sm font-normal text-cocoa/40">/ {roomId}</span>
        </h1>
        <button
          onClick={copyLink}
          className="rounded-full border border-rose/40 bg-white px-4 py-2 text-sm font-semibold text-rose shadow-sm transition hover:bg-blush"
        >
          {copied ? "Link copied" : "Copy invite link"}
        </button>
      </header>

      {!editing && (
        <>
          {/* Split-screen video */}
          <div className="grid grid-cols-2 gap-3">
            <VideoTile
              refEl={localVideoRef}
              label="You"
              mirror
              muted
            />
            <VideoTile
              refEl={remoteVideoRef}
              label={names.partner}
              muted={false}
              placeholder={
                status !== "ready"
                  ? "Waiting for your partner to join"
                  : undefined
              }
            />
          </div>

          {/* Status + start */}
          <div className="mt-5 flex flex-col items-center gap-3">
            <StatusPill status={status} />
            <button
              disabled={status !== "ready" || capturing}
              onClick={startBooth}
              className="rounded-full bg-rose px-8 py-3 text-base font-semibold text-white shadow-lg shadow-rose/30 transition enabled:hover:bg-[#ff7a9c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {capturing ? "Capturing…" : "Start session"}
            </button>

            {/* Thumbnails as they're captured */}
            {photos.length > 0 && (
              <div className="mt-2 flex gap-2">
                {photos.map((p, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={p}
                    alt={`shot ${i + 1}`}
                    className="h-16 w-24 rounded-md object-cover shadow"
                  />
                ))}
                {Array.from({ length: 4 - photos.length }).map((_, i) => (
                  <div
                    key={`e${i}`}
                    className="h-16 w-24 rounded-md border-2 border-dashed border-rose/30"
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Editing screen */}
      {editing && (
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
          <div className="rounded-xl bg-white p-3 shadow-xl">
            <canvas
              ref={canvasRef}
              width={STRIP_W}
              height={STRIP_H}
              className="h-auto w-[260px] rounded-lg sm:w-[300px]"
            />
          </div>

          <div className="w-full max-w-xs space-y-5">
            {/* Filters carousel */}
            <div>
              <p className="mb-2 text-sm font-semibold text-cocoa/70">Filter</p>
              <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                {Object.keys(FILTERS).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                      filter === k
                        ? "bg-rose text-white shadow"
                        : "bg-white text-cocoa/70 hover:bg-blush"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* Background color */}
            <div>
              <p className="mb-2 text-sm font-semibold text-cocoa/70">
                Strip color
              </p>
              <div className="flex items-center gap-2">
                {["#ffd7e4", "#fff3c4", "#d7ecff", "#eadcff", "#ffffff", "#2b2b2b"].map(
                  (c) => (
                    <button
                      key={c}
                      onClick={() => setBgColor(c)}
                      style={{ background: c }}
                      className={`h-8 w-8 rounded-full border-2 transition ${
                        bgColor === c ? "border-rose scale-110" : "border-white"
                      }`}
                    />
                  )
                )}
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
                />
              </div>
            </div>

            {/* Names */}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm text-cocoa/70">
                You
                <input
                  value={names.me}
                  onChange={(e) => setNames((n) => ({ ...n, me: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-rose/30 px-3 py-2 text-cocoa"
                />
              </label>
              <label className="text-sm text-cocoa/70">
                Partner
                <input
                  value={names.partner}
                  onChange={(e) =>
                    setNames((n) => ({ ...n, partner: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-rose/30 px-3 py-2 text-cocoa"
                />
              </label>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-1">
              <button
                onClick={savePng}
                disabled={saveState === "saving"}
                className="w-full rounded-full bg-rose px-6 py-3 font-semibold text-white shadow-lg shadow-rose/40 transition hover:scale-[1.02] disabled:opacity-50"
              >
                {saveState === "saving" ? "Saving…" : "Save PNG"}
              </button>
              <button
                onClick={retake}
                className="w-full rounded-full border border-rose/40 bg-white px-6 py-3 font-semibold text-rose transition hover:bg-blush"
              >
                Retake
              </button>

              {saveState === "cloud" && cloudUrl && (
                <p className="text-center text-xs text-green-600">
                  Saved and uploaded.{" "}
                  <a href={cloudUrl} target="_blank" className="underline">
                    View
                  </a>
                </p>
              )}
              {saveState === "local" && (
                <p className="text-center text-xs text-cocoa/50">
                  Downloaded locally (cloud storage not configured).
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {countdown !== null && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="flex h-40 w-40 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
            <span className="font-display text-9xl font-bold text-white drop-shadow-lg">
              {countdown}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Small presentational helpers (kept in-file to minimise file count).
 * ------------------------------------------------------------------ */
function VideoTile({
  refEl,
  label,
  mirror,
  muted,
  placeholder,
}: {
  refEl: React.RefObject<HTMLVideoElement>;
  label: string;
  mirror?: boolean;
  muted: boolean;
  placeholder?: string;
}) {
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-cocoa/90 shadow-lg">
      <video
        ref={refEl}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${mirror ? "-scale-x-100" : ""}`}
      />
      {placeholder && (
        <div className="absolute inset-0 flex items-center justify-center bg-cocoa/70 px-4 text-center text-sm text-blush">
          <span className="animate-pulse">{placeholder}</span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white">
        {label}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { t: string; c: string }> = {
    connecting: { t: "Connecting", c: "bg-yellow-100 text-yellow-700" },
    waiting: { t: "Waiting for your partner", c: "bg-blush text-rose" },
    ready: { t: "Connected", c: "bg-green-100 text-green-700" },
    full: { t: "Room full", c: "bg-red-100 text-red-700" },
  };
  const s = map[status];
  return (
    <span className={`rounded-full px-4 py-1.5 text-sm font-medium ${s.c}`}>
      {s.t}
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  );
}
