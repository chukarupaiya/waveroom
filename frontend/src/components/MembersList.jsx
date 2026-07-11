import { AnimatePresence, motion } from "framer-motion";

// Everyone in the room. Owner gets a crown.
export default function MembersList({ members, selfName }) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">In the Room</h3>
        <span className="text-xs text-white/40">{members.length}</span>
      </div>
      <ul className="flex flex-wrap gap-2 sm:flex-col sm:gap-0 sm:space-y-2">
        <AnimatePresence>
          {members.map((m) => (
            <motion.li
              key={m.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-1.5 sm:gap-3 sm:px-3 sm:py-2"
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-8 sm:w-8 sm:text-sm"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(168,85,247,0.5), rgba(6,182,212,0.5))",
                }}
              >
                {m.name.charAt(0).toUpperCase()}
              </span>
              <span className="max-w-[8rem] truncate text-sm sm:max-w-none sm:flex-1">
                {m.name}
                {m.name === selfName && (
                  <span className="ml-1 text-xs text-white/30">(you)</span>
                )}
              </span>
              {m.is_owner && (
                <span className="shrink-0" title="Owner">
                  👑
                </span>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
