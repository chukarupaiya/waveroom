// ON/OFF switch for the convolver-based "concert hall" spatial mode.
export default function SpatialAudioToggle({ enabled, onChange }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="glass flex items-center gap-2 rounded-full px-3 py-1.5 transition hover:ring-1 hover:ring-primary/50 sm:gap-3 sm:px-4 sm:py-2"
      title="Concert-hall spatial reverb"
    >
      <span className="text-xs font-medium sm:text-sm">
        <span className="hidden sm:inline">Spatial Audio </span>🎧
      </span>
      <span
        className={`relative h-5 w-9 rounded-full transition ${
          enabled ? "bg-primary" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
