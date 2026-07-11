import { motion } from "framer-motion";
import { formatTime } from "../api.js";
import TiltCard from "./TiltCard.jsx";

function FlacBadge() {
  return (
    <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
      FLAC Lossless
    </span>
  );
}

function OfflineBadge() {
  return (
    <span
      title="Cached on this device — plays instantly & offline"
      className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400"
    >
      ⤓ Offline
    </span>
  );
}

export default function NowPlaying({
  track,
  cached,
  isPlaying,
  position,
  duration,
  volume,
  onVolume,
  onPlay,
  onPause,
  onSkip,
  onSeek,
}) {
  if (!track) {
    return (
      <div className="glass flex flex-col items-center justify-center rounded-2xl p-8 text-center text-white/40 sm:rounded-3xl sm:p-10">
        <div className="text-4xl sm:text-5xl">🎵</div>
        <p className="mt-4 text-sm sm:text-base">
          Search for a song to get started
        </p>
      </div>
    );
  }

  const pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  const glow = "rgba(168,85,247,0.45)";

  return (
    <div className="glass flex flex-col items-center rounded-2xl p-4 sm:rounded-3xl sm:p-6 md:p-8">
      <TiltCard glow={glow} max={12} className="mb-4 animate-float rounded-2xl sm:mb-6">
        <div
          className="h-36 w-36 overflow-hidden rounded-xl ring-1 ring-white/10 sm:h-48 sm:w-48 sm:rounded-2xl md:h-56 md:w-56"
          style={{ boxShadow: `0 20px 60px -10px ${glow}` }}
        >
          {track.album_art ? (
            <img
              src={track.album_art}
              alt={track.album}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/40 to-accent/40 text-6xl">
              ♪
            </div>
          )}
        </div>
      </TiltCard>

      <div className="mb-1 flex items-center gap-2">
        <FlacBadge />
        {cached && <OfflineBadge />}
      </div>
      <h2 className="max-w-full truncate px-2 text-center text-lg font-bold sm:text-xl md:text-2xl">
        {track.title}
      </h2>
      <p className="max-w-full truncate px-2 text-center text-sm text-white sm:text-base">
        {track.artist}
      </p>

      <div className="mt-4 w-full sm:mt-6">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={position}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="w-full"
          style={{
            background: `linear-gradient(90deg, #a855f7 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
          }}
        />
        <div className="mt-1 flex justify-between text-xs text-white/40">
          <span>{formatTime(position)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 sm:mt-6 sm:gap-6">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={isPlaying ? onPause : onPlay}
          className="btn-glow flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-primary to-accent text-xl sm:h-16 sm:w-16 sm:text-2xl"
        >
          {isPlaying ? "❚❚" : "▶"}
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onSkip}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg hover:bg-white/20 sm:h-12 sm:w-12 sm:text-xl"
          title="Skip"
        >
          ⏭
        </motion.button>
      </div>

      <div className="mt-4 flex items-center gap-2 text-xs text-white/40">
        <span>🔈</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="w-28 sm:w-36"
        />
      </div>
    </div>
  );
}
