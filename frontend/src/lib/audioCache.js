// Client-side audio cache (IndexedDB).
//
// Once a song's FLAC bytes have been fetched once on a device, every future
// play on that device is served from a local Blob — no network round trip, no
// buffering. This is the highest-value piece of "Stream the Jam": if both
// participants already have a song cached, only tiny control messages cross
// the wire; the audio itself never does.
//
// Public API:
//   getPlayableUrl(songId, networkUrl)   -> Blob URL (cache hit or after fetch)
//   prefetchSong(songId, networkUrl)     -> warm the cache in the background
//   revokePlayableUrl(url)               -> release a Blob URL on src swap
//   cachedIds()                          -> Set<string> of stored song ids
//   requestPersistentStorage()           -> ask browser not to evict us
//
// Callers should pair getPlayableUrl()/prefetchSong() with revokePlayableUrl()
// when swapping the <audio> src, to avoid leaking Blob URLs over a long
// listening session.

const DB_NAME = "jamsync-audio";
const DB_VERSION = 1;
const STORE = "songs";
const LASTPLAYED_INDEX = "lastPlayed";

// Soft cap. ~65MB/FLAC -> ~30 songs, plenty for an active listener's rotation.
// Lowered automatically on low-quota devices in requestPersistentStorage().
let MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

let dbPromise = null;

function supported() {
  return typeof indexedDB !== "undefined";
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!supported()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "songId" });
        // Indexed so LRU eviction can walk oldest-first without a full scan.
        store.createIndex(LASTPLAYED_INDEX, "lastPlayed");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- low-level reads/writes ------------------------------------------------

async function getEntry(songId) {
  const db = await openDB();
  return promisifyRequest(tx(db, "readonly").get(songId));
}

async function totalBytes(db) {
  // Sum sizeBytes across all entries via a cursor (cheap at this scale).
  return new Promise((resolve, reject) => {
    let sum = 0;
    const cursorReq = tx(db, "readonly").openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        sum += cursor.value.sizeBytes || 0;
        cursor.continue();
      } else {
        resolve(sum);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

// Delete oldest-by-lastPlayed entries until `needBytes` of headroom exists
// under MAX_CACHE_BYTES. Runs inside putCachedBlob before a new insert.
async function evictToFit(db, needBytes) {
  let used = await totalBytes(db);
  if (used + needBytes <= MAX_CACHE_BYTES) return;

  await new Promise((resolve, reject) => {
    const store = tx(db, "readwrite");
    const cursorReq = store.index(LASTPLAYED_INDEX).openCursor(); // ascending
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (used + needBytes <= MAX_CACHE_BYTES) {
        resolve();
        return;
      }
      used -= cursor.value.sizeBytes || 0;
      cursor.delete();
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

async function putCachedBlob(songId, blob) {
  const db = await openDB();
  const sizeBytes = blob.size;
  // If a single song is larger than the whole cap, don't bother caching it.
  if (sizeBytes > MAX_CACHE_BYTES) return;
  await evictToFit(db, sizeBytes);
  const entry = { songId, blob, sizeBytes, lastPlayed: Date.now() };
  await promisifyRequest(tx(db, "readwrite").put(entry));
}

// Bump lastPlayed so frequently replayed songs survive eviction longer.
async function touchLastPlayed(songId) {
  try {
    const db = await openDB();
    const store = tx(db, "readwrite");
    const entry = await promisifyRequest(store.get(songId));
    if (entry) {
      entry.lastPlayed = Date.now();
      store.put(entry);
    }
  } catch {
    // touch failures are non-fatal — eviction ordering just degrades slightly
  }
}

// ---- public API ------------------------------------------------------------

// Normalize a source arg to an ordered, non-empty list of URLs. Callers pass
// either a single URL string or an array like [r2_url, stream_url] where the
// first entry is preferred (R2 CDN) and later entries are fallbacks (local
// backend stream).
function toSources(sources) {
  return (Array.isArray(sources) ? sources : [sources]).filter(Boolean);
}

// Fetch the first source that responds OK, in order. Returns a Blob or null.
// A failed/unreachable source (R2 down, network error) transparently falls
// through to the next, so the local backend stream backs up the R2 CDN.
async function fetchFirstOk(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.blob();
    } catch {
      // try the next source
    }
  }
  return null;
}

// Returns a Blob URL for the song, fetching+storing on a cache miss. Sources
// may be a single URL or an ordered [primary, ...fallbacks] list. On any
// IndexedDB failure (private mode, quota, etc.) or if every source fails, it
// falls back to a plain network URL so playback still works — caching and R2
// are optimizations, never hard dependencies.
export async function getPlayableUrl(songId, sources) {
  const urls = toSources(sources);
  const fallbackUrl = urls[urls.length - 1];
  if (!supported()) return fallbackUrl;
  try {
    const existing = await getEntry(songId);
    if (existing && existing.blob) {
      touchLastPlayed(songId); // fire-and-forget
      return URL.createObjectURL(existing.blob);
    }
    const blob = await fetchFirstOk(urls);
    if (!blob) return fallbackUrl;
    await putCachedBlob(songId, blob);
    return URL.createObjectURL(blob);
  } catch {
    return fallbackUrl;
  }
}

// Warm the cache for a song we expect to play soon (e.g. the next queue item).
// Accepts the same [primary, ...fallbacks] sources as getPlayableUrl. No-op if
// already cached. Never throws; never returns a URL to assign.
export async function prefetchSong(songId, sources) {
  const urls = toSources(sources);
  if (!supported() || !songId || urls.length === 0) return;
  try {
    const existing = await getEntry(songId);
    if (existing) return;
    const blob = await fetchFirstOk(urls);
    if (!blob) return;
    await putCachedBlob(songId, blob);
  } catch {
    // best-effort
  }
}

// Revoke a Blob URL previously returned by getPlayableUrl. Safe to call with a
// network URL (it just no-ops on non-blob: URLs).
export function revokePlayableUrl(url) {
  if (url && typeof url === "string" && url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

// Set of all cached song ids — for rendering "downloaded" badges in one pass
// instead of a lookup per row.
export async function cachedIds() {
  if (!supported()) return new Set();
  try {
    const db = await openDB();
    const keys = await promisifyRequest(tx(db, "readonly").getAllKeys());
    return new Set(keys);
  } catch {
    return new Set();
  }
}

// Ask the browser not to silently evict our cache under disk pressure, and
// lower the cap on low-quota devices. Advisory — treat the result as a hint,
// not a guarantee (Safari/iOS in particular often ignore persist()).
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.estimate) {
      const { quota } = await navigator.storage.estimate();
      // If the device only offers <3GB total, don't try to claim 2GB of it.
      if (quota && quota < 3 * 1024 * 1024 * 1024) {
        MAX_CACHE_BYTES = Math.min(MAX_CACHE_BYTES, 1 * 1024 * 1024 * 1024);
      }
    }
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  return false;
}
