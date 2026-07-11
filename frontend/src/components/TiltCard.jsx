import { useRef } from "react";

// Wraps children in a card that tilts toward the cursor (3D parallax) and
// shows a moving sheen. Pure pointer math, no deps.
export default function TiltCard({ children, className = "", max = 10, glow }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (0.5 - py) * max;
    const ry = (px - 0.5) * max;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.01)`;
    el.style.setProperty("--sx", `${px * 100}%`);
    el.style.setProperty("--sy", `${py * 100}%`);
  };

  const reset = () => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(900px) rotateX(0) rotateY(0) scale(1)";
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={`relative transition-transform duration-200 ease-out ${className}`}
      style={glow ? { boxShadow: `0 30px 80px -20px ${glow}` } : undefined}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 hover:opacity-100"
        style={{
          background:
            "radial-gradient(20rem 20rem at var(--sx,50%) var(--sy,50%), rgba(255,255,255,0.08), transparent 60%)",
        }}
      />
      {children}
    </div>
  );
}
