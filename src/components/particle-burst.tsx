"use client";

/**
 * Effet de particules de la révélation — canvas 2D.
 *
 * Canvas 2D plutôt que DOM ou WebGL : une quarantaine de sprites animés en
 * `requestAnimationFrame` tiennent largement le 60 fps dans une WebView
 * Android, sans contexte WebGL supplémentaire à allouer (la WebView n'en
 * autorise qu'un petit nombre, et chaque contexte perdu fait clignoter la
 * carte). Le compositing `lighter` donne l'additif « étincelles » gratuitement.
 *
 * Le nombre de particules vient de `particleCountFor(intensity)` — module pur,
 * testé — donc c'est bien la rareté et la variante de la carte qui décident de
 * l'ampleur de l'effet.
 */
import { useEffect, useRef } from "react";
import { particleCountFor } from "@/lib/pack-animation";

export type ParticleBurstProps = {
  /** Intensité 0 → 1 (issue de `effectIntensity`). */
  intensity: number;
  /** Couleur dominante, en pratique celle de la rareté. */
  color: string;
  /** Durée de vie de l'effet, en ms. */
  durationMs: number;
  running: boolean;
  className?: string;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  hue: number;
};

/** Densité de particules par rapport à la plus petite dimension du canvas. */
const GRAVITY = 0.00042;

export function ParticleBurst({
  intensity,
  color,
  durationMs,
  running,
  className = "",
}: ParticleBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!running) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = particleCountFor(intensity);
    const particles: Particle[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.06 + Math.random() * 0.3;
      const maxLife = 0.45 + Math.random() * 0.55;
      particles.push({
        x: width / 2,
        y: height / 2,
        vx: Math.cos(angle) * speed * width,
        vy: Math.sin(angle) * speed * height * 0.72 - height * 0.06,
        life: 0,
        maxLife,
        size: 1.2 + Math.random() * 2.6 + intensity * 1.6,
        spin: Math.random() * Math.PI,
        hue: -18 + Math.random() * 46,
      });
    }

    let frame = 0;
    let previous = performance.now();
    const startedAt = previous;

    const render = (now: number) => {
      const dt = Math.min(48, now - previous);
      previous = now;
      const elapsed = now - startedAt;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      for (const particle of particles) {
        particle.life += dt / 1000;
        const t = particle.life / particle.maxLife;
        if (t >= 1) continue;
        particle.vy += GRAVITY * dt * height;
        particle.vx *= 1 - 0.0016 * dt;
        particle.x += (particle.vx * dt) / 1000;
        particle.y += (particle.vy * dt) / 1000;
        particle.spin += 0.004 * dt;

        const fade = Math.pow(1 - t, 1.6);
        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.spin);
        context.globalAlpha = fade;
        context.fillStyle = particle.hue > 12 ? "#ffffff" : color;
        context.shadowBlur = 8 * fade + intensity * 10;
        context.shadowColor = color;
        const size = particle.size * (0.6 + fade * 0.7);
        // Losange : plus « éclat de cristal » qu'un rond, sans texture à charger.
        context.beginPath();
        context.moveTo(0, -size * 1.7);
        context.lineTo(size, 0);
        context.lineTo(0, size * 1.7);
        context.lineTo(-size, 0);
        context.closePath();
        context.fill();
        context.restore();
      }

      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      if (elapsed < durationMs + 400) {
        frame = requestAnimationFrame(render);
      } else {
        context.clearRect(0, 0, width, height);
      }
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      context.clearRect(0, 0, width, height);
    };
  }, [running, intensity, color, durationMs]);

  return (
    <canvas
      ref={canvasRef}
      className={`particle-burst ${className}`}
      aria-hidden="true"
      style={{ opacity: running ? 1 : 0 }}
    />
  );
}
