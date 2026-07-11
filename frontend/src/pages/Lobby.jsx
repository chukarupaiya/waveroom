import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import TiltCard from "../components/TiltCard.jsx";
import { useToast } from "../components/Toast.jsx";

export default function Lobby() {
  const [rooms, setRooms] = useState([]);
  const [roomName, setRoomName] = useState("");
  const [joinId, setJoinId] = useState("");
  const navigate = useNavigate();
  const toast = useToast();
  const name = localStorage.getItem("jamsync_name");

  const refresh = () =>
    api
      .rooms()
      .then((d) => setRooms(d.rooms))
      .catch(() => {});

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      const { roomId } = await api.createRoom(roomName.trim() || `${name}'s Jam`);
      navigate(`/room/${roomId}`);
    } catch {
      toast("Couldn't create room", "error");
    }
  };

  const join = (e) => {
    e.preventDefault();
    const id = joinId.trim().toUpperCase();
    if (id) navigate(`/room/${id}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="mx-auto max-w-5xl px-6 py-12"
    >
      <header className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-4xl font-bold gradient-text">JamSync Lobby</h1>
          <p className="text-white/50">Welcome back, {name} 👋</p>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem("jamsync_name");
            navigate("/");
          }}
          className="text-sm text-white/40 hover:text-white/70"
        >
          Switch user
        </button>
      </header>

      <div className="mb-10 grid gap-5 md:grid-cols-2">
        <TiltCard className="glass rounded-2xl p-6">
          <h2 className="mb-4 text-xl font-semibold">Create a Jam Room</h2>
          <form onSubmit={create} className="space-y-3">
            <input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Room name (optional)"
              className="w-full rounded-xl bg-white/5 px-4 py-3 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-primary"
            />
            <button className="btn-glow w-full rounded-xl bg-gradient-to-r from-primary to-accent py-3 font-semibold">
              Create Room
            </button>
          </form>
        </TiltCard>

        <TiltCard className="glass rounded-2xl p-6">
          <h2 className="mb-4 text-xl font-semibold">Join with a Room ID</h2>
          <form onSubmit={join} className="space-y-3">
            <input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="e.g. JAM-4829"
              className="w-full rounded-xl bg-white/5 px-4 py-3 uppercase outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
            />
            <button className="btn-glow w-full rounded-xl border border-accent/40 bg-accent/10 py-3 font-semibold text-accent">
              Join Room
            </button>
          </form>
        </TiltCard>
      </div>

      <h2 className="mb-4 text-lg font-semibold text-white/70">Active rooms</h2>
      {rooms.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-white/40">
          No active jams yet — create the first one 🎵
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <motion.button
              key={r.room_id}
              whileHover={{ y: -4 }}
              onClick={() => navigate(`/room/${r.room_id}`)}
              className="glass rounded-2xl p-5 text-left transition hover:ring-1 hover:ring-primary/50"
            >
              <div className="mb-1 font-semibold">{r.name}</div>
              <div className="text-xs text-white/40">{r.room_id}</div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-accent">
                  {r.listeners} listening
                </span>
                {r.now_playing && (
                  <span className="truncate text-white/40">
                    ♪ {r.now_playing}
                  </span>
                )}
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
