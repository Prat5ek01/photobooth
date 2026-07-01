import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// If Supabase isn't configured yet, the app still works locally (download only).
export const supabase = url && anon ? createClient(url, anon) : null;
export const supabaseReady = Boolean(supabase);

const BUCKET = "photobooth_strips";

/** Convert a canvas PNG dataURL into a Blob for upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)?.[1] || "image/png";
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * Uploads a strip to Storage and records a row in `strips`.
 * Returns the public URL, or null if Supabase isn't configured / it failed.
 */
export async function uploadStrip(
  roomId: string,
  dataUrl: string
): Promise<{ url: string } | null> {
  if (!supabase) return null;

  const blob = dataUrlToBlob(dataUrl);
  const path = `${roomId}/${Date.now()}.png`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (upErr) {
    console.error("Upload failed:", upErr.message);
    return null;
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  // Save a record linking room, date, and image URL. Non-fatal if it fails.
  const { error: dbErr } = await supabase
    .from("strips")
    .insert({ room_id: roomId, image_url: url });
  if (dbErr) console.error("DB insert failed:", dbErr.message);

  return { url };
}
