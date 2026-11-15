// A puff of smoke: soft sprites that burst, rise, swell and fade. Triggered imperatively.
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { softSpriteTexture } from './textures';

export interface SmokeHandle { burst(now: number): void }

export const Smoke = forwardRef<SmokeHandle, { origin: [number, number, number]; count: number; color: string; life?: number }>(
  function Smoke({ origin, count, color, life = 3.2 }, ref) {
    const group = useRef<THREE.Group>(null);
    const parts = useMemo(() => Array.from({ length: count }, (_, i) => {
      const m = new THREE.SpriteMaterial({ map: softSpriteTexture(), color, transparent: true, depthWrite: false, opacity: 0 });
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      return {
        mat: m,
        vel: new THREE.Vector3(Math.cos(a) * (0.03 + Math.random() * 0.05), 0.05 + Math.random() * 0.09, Math.sin(a) * (0.03 + Math.random() * 0.05) + 0.02),
        spin: (Math.random() - 0.5) * 1.5,
        delay: Math.random() * 0.25,
        size: 0.025 + Math.random() * 0.03,
      };
    }), [count, color]);
    const start = useRef(-1e9);
    useImperativeHandle(ref, () => ({ burst(now: number) { start.current = now; } }), []);
    useFrame((st) => {
      const g = group.current; if (!g) return;
      const t0 = st.clock.elapsedTime - start.current;
      g.visible = t0 < life + 0.5;
      if (!g.visible) return;
      g.children.forEach((c, i) => {
        const p = parts[i]; const t = Math.max(0, t0 - p.delay);
        const drag = (1 - Math.exp(-t * 2.2)) / 2.2; // decelerating travel
        c.position.set(origin[0] + p.vel.x * drag * 2.5, origin[1] + p.vel.y * drag * 2.2 + t * 0.025, origin[2] + p.vel.z * drag * 2.5);
        const s = p.size * (1 + t * 2.2);
        c.scale.set(s, s, s);
        const fadeIn = Math.min(1, t * 12);
        p.mat.opacity = t0 < p.delay ? 0 : fadeIn * Math.max(0, 1 - t / life) * 0.55;
        p.mat.rotation += p.spin * 0.01;
      });
    });
    return (
      <group ref={group} visible={false}>
        {parts.map((p, i) => <sprite key={i} material={p.mat} />)}
      </group>
    );
  },
);
