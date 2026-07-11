import { AnimatePresence, Reorder, motion } from "framer-motion";
import { formatTime } from "../api.js";

// Upcoming songs. Drag-to-reorder via framer-motion's Reorder; reorder &
// removal are sent up to the server which re-broadcasts the canonical queue.
export default function Queue({ queue, onRemove, onReorder, cached }) {
  const handleReorder = (newOrder) => {
    // find what moved by comparing ids
    const oldIds = queue.map((t) => t.id);
    const newIds = newOrder.map((t) => t.id);
    for (let i = 0; i < newIds.length; i++) {
      if (newIds[i] !== oldIds[i]) {
        const movedId = newIds[i];
        const oldIndex = oldIds.indexOf(movedId);
        onReorder(oldIndex, i);
        break;
      }
    }
  };

  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Up Next</h3>
        <span className="text-xs text-white/40">{queue.length} tracks</span>
      </div>

      {queue.length === 0 ? (
        <div className="py-6 text-center text-sm text-white/40">
          Queue is empty — add a song from the library
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={queue}
          onReorder={handleReorder}
          className="space-y-2"
        >
          <AnimatePresence>
            {queue.map((track, i) => (
              <Reorder.Item
                key={track.id + "-" + i}
                value={track}
                className="group flex items-center gap-2 rounded-xl bg-white/5 p-2 ring-1 ring-white/10 sm:gap-3"
              >
                <span className="w-4 shrink-0 text-center text-xs text-white/30 sm:w-5">
                  {i + 1}
                </span>
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-white/10 sm:h-10 sm:w-10">
                  {track.album_art ? (
                    <img
                      src={track.album_art}
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
                    <span className="truncate text-sm font-medium">
                      {track.title}
                    </span>
                    {cached?.has(track.id) && (
                      <span
                        title="Available offline"
                        className="shrink-0 text-[10px] text-emerald-400"
                      >
                        ⤓
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-white/40">
                    {track.artist}
                  </div>
                </div>
                <span className="hidden text-xs text-white/30 sm:inline">
                  {formatTime(track.duration)}
                </span>
                <button
                  onClick={() => onRemove(i)}
                  className="shrink-0 text-white/40 opacity-60 transition hover:text-red-400 group-hover:opacity-100 sm:opacity-0"
                  title="Remove"
                >
                  ✕
                </button>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
      )}
    </div>
  );
}
