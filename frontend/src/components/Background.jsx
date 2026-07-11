import { useEffect } from "react";

// Cursor-reactive ambient background. Updates CSS variables --mx/--my on the
// aurora layer so the gradient glow follows the mouse. Also renders a soft
// grid overlay for the futuristic feel.
export default function Background() {
  useEffect(() => {
    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      document.documentElement.style.setProperty("--mx", `${x}%`);
      document.documentElement.style.setProperty("--my", `${y}%`);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <>
      <div className="aurora" />
      <div className="grid-overlay" />
    </>
  );
}
