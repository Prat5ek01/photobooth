# Photobooth

A real-time, long-distance photobooth for two. Join a private room, see each other
split-screen over WebRTC, take a synchronized 4-photo strip, filter it, and save.

## Tech
- **Next.js 14** (App Router) + React + TypeScript + Tailwind
- **WebRTC** via `simple-peer` (peer-to-peer video)
- **Supabase Realtime** for signaling + synced capture (no custom server — deploys to Vercel)
- **HTML5 Canvas** for stitching + filters
- **Supabase Storage + Postgres** for saved strips

## Architecture
Fully serverless. The Next.js app is static + client-side; two browsers connect
directly to each other over WebRTC. Supabase Realtime is used only to exchange the
tiny connection handshake (offer/answer/ICE) and to broadcast the "Start session"
trigger. Because there is no always-on server, it runs on Vercel's free tier and the
room link works forever.

## Local setup

```bash
cd photobooth
npm install
cp .env.local.example .env.local   # fill in your Supabase URL + anon key (required)
npm run dev
```

Open http://localhost:3000. On `localhost` two tabs can connect for testing.

## Supabase setup (required)

1. Create a free project at supabase.com. Copy the **Project URL** and **anon public key**
   (Settings -> API) into `.env.local`.
2. **Storage** -> create a **public** bucket named `photobooth_strips`.
3. **SQL editor** -> run:

```sql
create table if not exists strips (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  image_url text not null,
  created_at timestamptz default now()
);
alter table strips enable row level security;

create policy "anyone can insert strips" on strips for insert with check (true);
create policy "anyone can read strips"   on strips for select using (true);
```

Realtime is enabled by default — nothing else to configure for signaling.

## Deploy to Vercel (permanent shareable link)

1. Push this folder to a GitHub repo:
   ```bash
   git init && git add -A && git commit -m "Photobooth"
   git branch -M main
   git remote add origin https://github.com/<you>/photobooth.git
   git push -u origin main
   ```
2. Go to vercel.com -> **Add New -> Project** -> import the repo. Framework auto-detects
   as Next.js; keep defaults.
3. In **Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Deploy.** You get a permanent URL like `https://photobooth-xyz.vercel.app`.
   Share `https://your-app.vercel.app/room/<code>` with your partner — it's live 24/7.

> Vercel serves everything over HTTPS, which browsers require for camera access on
> real devices. No servers to keep running.

## Notes
- Each browser holds both video streams and builds the final strip locally, so nothing
  large crosses the network.
- ICE uses public STUN plus the free Open Relay TURN servers so peers on different
  networks (including mobile data) can still connect.
