import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

// Compact 3-line synced lyrics: the previous, current, and next line, where
// the current line is driven by the shared playback `position`. Because that
// position comes from the server clock, the highlight stays in sync for
// everyone in the room.
export default function Lyrics({ track, position }) {
  const trackId = track?.id || null;
  const [data, setData] = useState(null); // { synced, plain, source }
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trackId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    api
      .lyrics(trackId)
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ synced: [], plain: null }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  const synced = data?.synced || [];
  const hasSynced = synced.length > 0;

  // Latest line whose timestamp is <= current position.
  const activeIndex = useMemo(() => {
    if (!hasSynced) return -1;
    let idx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (synced[i].t <= position + 0.15) idx = i;
      else break;
    }
    return idx;
  }, [synced, hasSynced, position]);

  const lineAt = (i) =>
    i >= 0 && i < synced.length ? synced[i].text || "♪" : "";

  // Fixed-height frame so the box never jumps as lines change. Relative so the
  // animated line stack can be absolutely centered for a clean crossfade.
  const Frame = ({ children }) => (
    <div className="relative flex h-24 items-center justify-center overflow-hidden px-2 text-center sm:h-28">
      {children}
    </div>
  );

  if (!track) {
    return (
      <Frame>
        <span className="text-sm text-white/30">Lyrics will appear here</span>
      </Frame>
    );
  }
  if (loading) {
    return (
      <Frame>
        <span className="text-sm text-white/30">Finding lyrics…</span>
      </Frame>
    );
  }
  if (!hasSynced) {
    return (
      <Frame>
        <span className="text-lg">🎤</span>
        <span className="text-sm text-white/30">
          {data?.plain
            ? "Synced lyrics not available for this track"
            : "No lyrics found for this track"}
        </span>
      </Frame>
    );
  }

  // Before the first timestamp, preview the opening line as "next".
  const current = activeIndex;
  return (
    <Frame>
      <AnimatePresence initial={false}>
        <motion.div
          key={current}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1"
        >
          <p className="w-full truncate text-sm text-white/25">
            {lineAt(current - 1)}
          </p>
          <p className="w-full truncate text-lg font-semibold text-white sm:text-xl">
            {current >= 0 ? lineAt(current) : "♪"}
          </p>
          <p className="w-full truncate text-sm text-white/40">
            {lineAt(current + 1)}
          </p>
        </motion.div>
      </AnimatePresence>
    </Frame>
  );
}
