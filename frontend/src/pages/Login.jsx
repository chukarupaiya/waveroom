import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [name, setName] = useState(localStorage.getItem("jamsync_name") || "");
  const navigate = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    localStorage.setItem("jamsync_name", clean);
    navigate("/lobby");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex min-h-screen items-center justify-center px-6"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="glass w-full max-w-md rounded-3xl p-10 text-center"
      >
        <div className="mb-2 text-sm uppercase tracking-[0.3em] text-white/40">
          Lossless · In Sync
        </div>
        <h1 className="mb-2 text-5xl font-bold">
          <span className="gradient-text">JamSync</span>
        </h1>
        <p className="mb-8 text-white/50">
          Hear the same song, in perfect sync, in FLAC.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full rounded-xl bg-white/5 px-4 py-3 text-center text-lg outline-none ring-1 ring-white/10 transition focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            className="btn-glow w-full rounded-xl bg-gradient-to-r from-primary to-accent py-3 text-lg font-semibold"
          >
            Start Jamming
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}
