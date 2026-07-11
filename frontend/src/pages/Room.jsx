import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, playSources } from "../api.js";
import Lyrics from "../components/Lyrics.jsx";
import MembersList from "../components/MembersList.jsx";
import MusicLibrary from "../components/MusicLibrary.jsx";
import NowPlaying from "../components/NowPlaying.jsx";
import Queue from "../components/Queue.jsx";
import SpatialAudioToggle from "../components/SpatialAudioToggle.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAudioEngine } from "../hooks/useAudioEngine.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import {
  cachedIds,
  getPlayableUrl,
  prefetchSong,
  requestPersistentStorage,
  revokePlayableUrl,
} from "../lib/audioCache.js";

// How far the local clock may drift from server before we hard-seek.
const SYNC_TOLERANCE = 0.6;

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const name = localStorage.getItem("jamsync_name");

  const [tracks, setTracks] = useState([]);
  const [room, setRoom] = useState(null);
  const [position, setPosition] = useState(0); // local display position
  const [volume, setVolumeState] = useState(1);

  const engine = useAudioEngine();
  const { audioRef, spatial, toggleSpatial, resume, setVolume } = engine;

  const currentTrackId = room?.current_track?.id || null;
  const isPlaying = !!room?.is_playing;
  const needsGestureRef = useRef(false);

  // Cache bookkeeping: which track id is currently loaded into <audio>, the
  // Blob URL backing it (so we can revoke it on swap), and the set of song ids
  // available offline (drives the "downloaded" badge).
  const loadedTrackIdRef = useRef(null);
  const currentBlobUrlRef = useRef(null);
  const [cachedSet, setCachedSet] = useState(() => new Set());

  const refreshCached = useCallback(() => {
    cachedIds().then(setCachedSet);
  }, []);

  // ---- load library once + ask the browser to keep our cache ------------
  useEffect(() => {
    api
      .library()
      .then((d) => setTracks(d.tracks))
      .catch(() => toast("Couldn't load library", "error"));
    requestPersistentStorage();
    refreshCached();
  }, [toast, refreshCached]);

  // ---- apply authoritative state to the <audio> element -----------------
  const applyPlayback = useCallback(
    async (track, serverPosition, serverTime, playing) => {
      const audio = audioRef.current;
      if (!audio) return;

      if (!track) {
        audio.pause();
        audio.removeAttribute("src");
        revokePlayableUrl(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
        loadedTrackIdRef.current = null;
        return;
      }

      const adjusted = serverPosition + (Date.now() / 1000 - serverTime);

      // Same track already loaded: just correct drift / play-pause. No reload,
      // no cache lookup.
      if (loadedTrackIdRef.current === track.id) {
        if (Math.abs(audio.currentTime - adjusted) > SYNC_TOLERANCE) {
          audio.currentTime = Math.max(0, adjusted);
        }
        if (playing && audio.paused) safePlay(audio);
        if (!playing && !audio.paused) audio.pause();
        return;
      }

      // New track: claim it immediately so overlapping calls don't double-load.
      loadedTrackIdRef.current = track.id;

      // Serve from IndexedDB if cached, else fetch+store. Sources are tried in
      // order: R2 CDN first, backend local stream as fallback.
      const url = await getPlayableUrl(track.id, playSources(track));

      // A newer track may have been requested while we awaited — bail if so.
      if (loadedTrackIdRef.current !== track.id) {
        revokePlayableUrl(url);
        return;
      }

      // Revoke the previous Blob URL before swapping (memory-leak guard).
      const previous = currentBlobUrlRef.current;
      currentBlobUrlRef.current = url;
      audio.src = url;
      audio.load();
      revokePlayableUrl(previous);
      refreshCached();

      const onReady = () => {
        // recompute drift — the fetch may have taken a moment
        const now = serverPosition + (Date.now() / 1000 - serverTime);
        audio.currentTime = Math.max(0, now);
        if (playing) safePlay(audio);
        audio.removeEventListener("canplay", onReady);
      };
      audio.addEventListener("canplay", onReady);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audioRef, refreshCached]
  );

  // Attempt playback; if Chrome blocks it (no fresh user gesture), flag it so
  // the play button can retry inside a real click, and tell the user.
  const safePlay = useCallback(
    (audio) =>
      audio.play().catch((err) => {
        if (err && err.name === "NotAllowedError") {
          needsGestureRef.current = true;
          toast("Press ▶ to start playback", "info");
        } else {
          toast(`Audio error: ${err?.message || err}`, "error");
        }
      }),
    [toast]
  );

  // ---- websocket handler ------------------------------------------------
  const handleMessage = useCallback(
    (msg) => {
      switch (msg.event) {
        case "room_state":
          setRoom(msg);
          applyPlayback(
            msg.current_track,
            msg.position,
            msg.server_time,
            msg.is_playing
          );
          break;
        case "playback_sync":
          setRoom((r) =>
            r
              ? {
                  ...r,
                  current_track: msg.current_track,
                  is_playing: msg.is_playing,
                  position: msg.position,
                }
              : r
          );
          applyPlayback(
            msg.current_track,
            msg.position,
            msg.server_time,
            msg.is_playing
          );
          break;
        case "member_joined":
          toast(`${msg.name} joined 🎧`);
          break;
        case "member_left":
          toast(`${msg.name} left`);
          break;
        case "jam_ended":
          toast("The jam has ended");
          navigate("/lobby");
          break;
        case "error":
          toast(msg.message || "Room error", "error");
          navigate("/lobby");
          break;
        default:
          break;
      }
    },
    [applyPlayback, navigate, toast]
  );

  const { connected, send } = useWebSocket(roomId, name, handleMessage);

  // ---- prefetch the next queued song -----------------------------------
  // Kick off as soon as the current song starts (not at its end) so there's a
  // full song's duration to download it in the background. Only one ahead by
  // default — speculative multi-song prefetch wastes mobile data on items that
  // may get skipped or reordered.
  const nextTrack = room?.queue?.[0] || null;
  const nextTrackId = nextTrack?.id || null;
  useEffect(() => {
    if (!currentTrackId || !nextTrack) return;
    prefetchSong(nextTrackId, playSources(nextTrack)).then(refreshCached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId, nextTrackId, refreshCached]);

  // ---- revoke the live Blob URL on unmount (memory-leak guard) ----------
  useEffect(() => {
    return () => {
      revokePlayableUrl(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    };
  }, []);

  // ---- local progress ticker + track-end detection ---------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPosition(audio.currentTime);
    const onEnded = () => send({ event: "track_ended" });
    const MEDIA_ERR = {
      1: "ABORTED",
      2: "NETWORK",
      3: "DECODE",
      4: "SRC_NOT_SUPPORTED",
    };
    const onError = () => {
      const code = audio.error?.code;
      const label = MEDIA_ERR[code] || `code ${code}`;
      if (currentTrackId) {
        toast(`Audio load failed (${label})`, "error");
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [audioRef, send, currentTrackId, toast]);

  // ---- controls ---------------------------------------------------------
  const onPlay = async () => {
    await resume(); // unlock AudioContext on user gesture
    // Start the element directly inside the click so Chrome allows it.
    const audio = audioRef.current;
    if (audio && audio.src) {
      try {
        await audio.play();
        needsGestureRef.current = false;
      } catch (err) {
        toast(`Audio error: ${err?.message || err}`, "error");
      }
    }
    send({ event: "play", position: audio?.currentTime || 0 });
  };
  const onPause = () =>
    send({ event: "pause", position: audioRef.current?.currentTime || 0 });
  const onSkip = () => send({ event: "skip" });
  const onSeek = (secs) => {
    if (audioRef.current) audioRef.current.currentTime = secs;
    send({ event: "seek", position: secs });
  };
  const onAdd = async (trackId) => {
    await resume();
    send({ event: "add_to_queue", track_id: trackId });
  };
  const onRemove = (index) => send({ event: "remove_from_queue", index });
  const onReorder = (oldIndex, newIndex) =>
    send({ event: "reorder_queue", old_index: oldIndex, new_index: newIndex });
  const onEndJam = () => send({ event: "end_jam" });

  const onVolume = (v) => {
    setVolumeState(v);
    setVolume(v);
  };

  const rescan = async () => {
    try {
      const d = await api.rescan();
      setTracks(d.tracks);
      toast("Library rescanned");
    } catch {
      toast("Rescan failed", "error");
    }
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(
      `${window.location.origin}/room/${roomId}`
    );
    toast("Room link copied 🔗");
  };

  const members = room?.members || [];
  const isOwner = members.find((m) => m.name === name)?.is_owner;
  const duration = room?.current_track?.duration || 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6"
    >
      {/* hidden audio element drives the Web Audio graph */}
      <audio ref={audioRef} crossOrigin="anonymous" preload="auto" />

      {/* Header */}
      <header className="glass mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 sm:mb-5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={() => navigate("/lobby")}
            className="shrink-0 text-white/40 hover:text-white"
            title="Back to lobby"
          >
            ←
          </button>
          <div className="min-w-0">
            <div className="truncate font-bold">{room?.name || "Loading…"}</div>
            <div className="truncate text-xs text-white/40">
              {roomId} · {members.length} listening ·{" "}
              <span className={connected ? "text-accent" : "text-red-400"}>
                {connected ? "synced" : "reconnecting…"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SpatialAudioToggle enabled={spatial} onChange={toggleSpatial} />
          <button
            onClick={copyLink}
            className="glass rounded-full px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm hover:ring-1 hover:ring-accent/50"
          >
            Copy Link 🔗
          </button>
          {isOwner && (
            <button
              onClick={onEndJam}
              className="rounded-full bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/30 sm:px-4 sm:py-2 sm:text-sm"
            >
              End Jam
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-5">
        {/* Left: library */}
        <div className="order-2 lg:order-1">
          <MusicLibrary
            tracks={tracks}
            onAdd={onAdd}
            onRescan={rescan}
            cached={cachedSet}
          />
        </div>

        {/* Center: now playing + lyrics */}
        <div className="order-1 space-y-4 sm:space-y-5 lg:order-2">
          <NowPlaying
            track={room?.current_track}
            cached={!!currentTrackId && cachedSet.has(currentTrackId)}
            isPlaying={isPlaying}
            position={position}
            duration={duration}
            volume={volume}
            onVolume={onVolume}
            onPlay={onPlay}
            onPause={onPause}
            onSkip={onSkip}
            onSeek={onSeek}
          />

          <div className="glass rounded-2xl p-4 sm:p-5">
            <div className="mb-2 text-xs font-medium text-white/60 sm:text-sm">
              Lyrics
            </div>
            <Lyrics track={room?.current_track} position={position} />
          </div>
        </div>

        {/* Right: queue, then members below */}
        <div className="order-3 space-y-4 sm:space-y-5">
          <Queue
            queue={room?.queue || []}
            onRemove={onRemove}
            onReorder={onReorder}
            cached={cachedSet}
          />
          <MembersList members={members} selfName={name} />
        </div>
      </div>
    </motion.div>
  );
}
