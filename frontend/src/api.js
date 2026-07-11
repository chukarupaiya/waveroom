// Tiny REST helper. Paths are relative so the Vite proxy (dev) or same-origin
// (prod) routes them to the FastAPI backend.

async function json(res) {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export const api = {
  library: () => fetch("/api/library").then(json),
  rescan: () => fetch("/api/library/rescan", { method: "POST" }).then(json),
  rooms: () => fetch("/api/rooms").then(json),
  createRoom: (name) =>
    fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json),
  room: (id) => fetch(`/api/rooms/${id}`).then(json),
  lyrics: (trackId) => fetch(`/api/lyrics/${trackId}`).then(json),
};

export function streamUrl(filename) {
  return `/stream/${encodeURIComponent(filename)}`;
}

// Ordered playback sources for a track: R2 CDN first (zero-egress primary),
// backend local stream second (fallback). Consumed by the IndexedDB cache
// layer, which fetches the first that responds OK. Handles older library
// payloads that only carry `filename`.
export function playSources(track) {
  const sources = [track.r2_url, track.stream_url].filter(Boolean);
  if (sources.length === 0 && track.filename) {
    sources.push(streamUrl(track.filename));
  }
  return sources;
}

export function formatTime(secs) {
  if (!secs || Number.isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
