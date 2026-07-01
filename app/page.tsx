"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 6-char alphanumeric code — no ambiguous chars (0/o/1/l), easy to read/share.
function makeRoomId() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Normalise whatever the user typed into a clean room code.
function normalize(input: string) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");

  const createRoom = () => router.push(`/room/${makeRoomId()}`);
  const joinRoom = () => {
    const c = normalize(code);
    if (c.length >= 4) router.push(`/room/${c}`);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="mb-4 rounded-full border border-rose/30 px-3 py-1 text-xs font-medium uppercase tracking-widest text-rose">
        Photobooth
      </span>
      <h1 className="font-display text-4xl font-semibold text-cocoa sm:text-5xl">
        Two people. One photo strip.
      </h1>
      <p className="mt-4 max-w-md text-cocoa/60">
        Create a room, share the code, and take four synchronized photos together —
        no matter the distance.
      </p>

      <button
        onClick={createRoom}
        className="mt-8 w-72 rounded-full bg-rose px-8 py-4 text-base font-semibold text-white shadow-lg shadow-rose/30 transition hover:bg-[#ff7a9c] active:scale-[0.99]"
      >
        Create a room
      </button>

      {/* Divider */}
      <div className="my-6 flex w-72 items-center gap-3 text-xs text-cocoa/40">
        <span className="h-px flex-1 bg-cocoa/15" />
        or join with a code
        <span className="h-px flex-1 bg-cocoa/15" />
      </div>

      {/* Join by code */}
      <div className="flex w-72 flex-col gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && joinRoom()}
          placeholder="Enter code"
          maxLength={12}
          className="w-full rounded-full border border-rose/30 bg-white px-5 py-3 text-center text-lg font-semibold uppercase tracking-widest text-cocoa placeholder:normal-case placeholder:tracking-normal placeholder:text-cocoa/40 focus:border-rose focus:outline-none"
        />
        <button
          onClick={joinRoom}
          disabled={normalize(code).length < 4}
          className="w-full rounded-full border border-rose/40 bg-white px-8 py-3 text-base font-semibold text-rose transition hover:bg-blush disabled:opacity-40"
        >
          Join room
        </button>
      </div>

      <p className="mt-6 text-xs text-cocoa/40">
        Your partner just needs the code or the link.
      </p>
    </main>
  );
}
