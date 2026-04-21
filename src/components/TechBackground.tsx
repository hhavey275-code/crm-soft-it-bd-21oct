import { useEffect, useRef } from "react";

export default function TechBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const particles: { x: number; y: number; vx: number; vy: number; size: number; opacity: number }[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const init = () => {
      resize();
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      particles.length = 0;

      // Reduced from 70 to 35 particles
      for (let i = 0; i < 35; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          size: Math.random() * 2 + 1,
          opacity: Math.random() * 0.4 + 0.15,
        });
      }
    };

    // Use spatial grid to avoid O(n²) connection checks
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      // Connection lines - with distance threshold
      const connDist = 140;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < connDist * connDist) {
            const dist = Math.sqrt(distSq);
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 100, 224, ${0.08 * (1 - dist / connDist)})`;
            ctx.lineWidth = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 100, 224, ${p.opacity})`;
        ctx.fill();
      }

      // Simplified hex grid - fewer iterations, no rotation
      const time = Date.now() * 0.0003;
      const cx = w / 2;
      const cy = h / 2;
      const hexSize = 60;
      for (let row = -4; row <= 4; row++) {
        for (let col = -6; col <= 6; col++) {
          const hx = cx + col * hexSize * 1.75 + (row % 2) * hexSize * 0.875;
          const hy = cy + row * hexSize * 1.5;
          const dist = Math.sqrt((hx - cx) ** 2 + (hy - cy) ** 2);
          const pulse = Math.sin(time * 2 + dist * 0.008) * 0.5 + 0.5;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const px = hx + Math.cos(angle) * hexSize * 0.35;
            const py = hy + Math.sin(angle) * hexSize * 0.35;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.strokeStyle = `rgba(0, 100, 224, ${0.04 * pulse})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    init();
    draw();

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: "none", zIndex: 0 }}
    />
  );
}
