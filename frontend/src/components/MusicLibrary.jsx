import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { formatTime } from "../api.js";

// Small "available offline" indicator for cached tracks.
function DownloadedDot() {
  return (
    <span
      title="Available offline"
      className="shrink-0 text-[10px] text-emerald-400"
    >
      ⤓
    </span>
  );
}

// Browse + search the admin FLAC library. Click a track to add to the queue.
export default function MusicLibrary({ tracks, onAdd, onRescan, cached }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(s) ||
        t.artist.toLowerCase().includes(s) ||
        (t.album || "").toLowerCase().includes(s)
    );
  }, [tracks, q]);

  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or artist…"
          className="w-full min-w-0 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent sm:flex-1"
        />
        <div className="flex items-center justify-between gap-2 sm:contents">
          <h3 className="shrink-0 font-semibold">Library</h3>
          <button
            onClick={onRescan}
            className="shrink-0 text-xs text-white/40 hover:text-accent"
            title="Re-scan the music folder"
          >
            ⟳ Rescan
          </button>
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-white/40">
          No tracks yet. Drop FLAC files into the backend's{" "}
          <code className="mx-1 rounded bg-white/10 px-1">music/</code> folder.
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-white/40">
          No matches for "{q}"
        </div>
      ) : (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {filtered.map((t) => (
            <motion.button
              key={t.id}
              whileHover={{ x: 3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onAdd(t.id)}
              className="group flex w-full items-center gap-2 rounded-xl bg-white/5 p-2 text-left ring-1 ring-white/10 transition hover:ring-primary/50 sm:gap-3"
            >
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white/10 sm:h-10 sm:w-10">
                {t.album_art ? (
                  <img
                    src={t.album_art}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/30">
                    ♪
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{t.title}</span>
                  {cached?.has(t.id) && <DownloadedDot />}
                </div>
                <div className="truncate text-xs text-white">{t.artist}</div>
              </div>
              <span className="hidden text-xs text-white/30 sm:inline">
                {formatTime(t.duration)}
              </span>
              <span className="shrink-0 text-primary opacity-60 transition group-hover:opacity-100 sm:opacity-0">
                ＋
              </span>
            </motion.button>
          ))}
        </div>
      )}
    </div>
  );
}
