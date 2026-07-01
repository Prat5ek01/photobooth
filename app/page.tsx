"use client";

import { useRouter } from "next/navigation";

// 6-char room code — short enough to share, random enough to be private.
function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default function Landing() {
  const router = useRouter();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 rounded-full border border-rose/30 px-3 py-1 text-xs font-medium uppercase tracking-widest text-rose">
        Photobooth
      </span>
      <h1 className="font-display text-4xl font-semibold text-cocoa sm:text-5xl">
        Two people. One photo strip.
      </h1>
      <p className="mt-4 max-w-md text-cocoa/60">
        A private room for a live, side-by-side session — take four synchronized
        photos together, no matter the distance.
      </p>

      <button
        onClick={() => router.push(`/room/${makeRoomId()}`)}
        className="mt-8 rounded-full bg-rose px-8 py-4 text-base font-semibold text-white shadow-lg shadow-rose/30 transition hover:bg-[#ff7a9c] active:scale-[0.99]"
      >
        Create a room
      </button>

      <p className="mt-6 text-xs text-cocoa/40">
        Share the link that follows to invite your partner.
      </p>
    </main>
  );
}
