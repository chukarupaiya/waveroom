import { useEffect, useRef } from "react";

// White plasma dot field. A grid of dots whose size and brightness ripple
// through a slow plasma wave. Ambient — animates continuously on its own,
// independent of the song. White-only, transparent background.
export default function AudioVisualizer() {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let t = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const spacing = 15;
      const cols = Math.max(16, Math.floor(w / spacing));
      const rows = Math.max(6, Math.floor(h / spacing));
      const gx = w / cols;
      const gy = h / rows;

      for (let c = 0; c < cols; c++) {
        // ambient per-column breathing — not driven by the audio
        const v = 0.32 + 0.22 * Math.sin(t * 0.018 + c * 0.3);
        for (let r = 0; r < rows; r++) {
          const px = gx * (c + 0.5);
          const py = gy * (r + 0.5);
          // slow plasma field
          const p =
            Math.sin(c * 0.5 + t * 0.02) +
            Math.cos(r * 0.5 + t * 0.025) +
            Math.sin((c + r) * 0.4 - t * 0.015);
          const n = (p + 3) / 6; // 0..1
          const wave = 0.5 + 0.5 * Math.sin(p * 3 + t * 0.03);
          const radius = wave * (1.4 + v * 5);
          if (radius < 0.4) continue;
          const alpha = 0.05 + n * (0.12 + v * 0.7);
          ctx.beginPath();
          ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      t += 1;
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="h-28 w-full rounded-xl sm:h-40" />;
}
