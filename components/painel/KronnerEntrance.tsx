'use client';

import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

type KronnerEntranceProps = {
  /** Whether the underlying panel data is still loading */
  loading?: boolean;
  /** Called once the overlay finishes so the panel can trigger its staggered wave reveal */
  onComplete: () => void;
  /** If an error occurs while loading workspace data, dismiss immediately so errors are never hidden */
  hasError?: boolean;
};

let entranceCompletedInSession = false;

const LETTERS = ['K', 'R', 'O', 'N', 'N', 'E', 'R'];

/**
 * 6-stage branded Kronner entrance (~2.6s total):
 * 1. Full-screen Obsidian Carbon (#0B0E10) canvas
 * 2. Letter-by-letter progressive write of "KRONNER"
 * 3. K chronograph mark highlights with refined precision rotation
 * 4. K mark glides smoothly toward the header/sidebar anchor
 * 5. KRONNER wordmark re-reveals beside the docked K
 * 6. Clean dissolve + staggered wave reveal of the panel
 *
 * Strictly GPU-composited (transform, opacity), respects prefers-reduced-motion
 * with a gentle static crossfade (no spin/glide), runs once per authenticated load,
 * and never hides errors or blocks interaction.
 */
export function KronnerEntrance({ loading = false, onComplete, hasError }: KronnerEntranceProps) {
  const [phase, setPhase] = useState<
    'idle' | 'write' | 'spin' | 'dock' | 'reveal' | 'reduced' | 'done'
  >(() => (entranceCompletedInSession ? 'done' : 'idle'));
  const [readyToExit, setReadyToExit] = useState(false);

  useEffect(() => {
    if (entranceCompletedInSession) {
      setPhase('done');
      onComplete();
      return;
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      const r1 = window.setTimeout(() => setPhase('reduced'), 30);
      const r2 = window.setTimeout(() => setReadyToExit(true), 650);
      return () => {
        window.clearTimeout(r1);
        window.clearTimeout(r2);
      };
    }

    let raf1 = 0;
    let raf2 = 0;
    let t2 = 0;
    let t3 = 0;
    let t4 = 0;
    let t5 = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setPhase('write');
        t2 = window.setTimeout(() => setPhase('spin'), 950);
        t3 = window.setTimeout(() => setPhase('dock'), 1600);
        t4 = window.setTimeout(() => setPhase('reveal'), 2150);
        t5 = window.setTimeout(() => setReadyToExit(true), 2600);
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
    };
  }, [onComplete]);

  // Dismiss only once both animation timeline AND initial data load are ready
  useEffect(() => {
    if (readyToExit && !loading && phase !== 'done') {
      entranceCompletedInSession = true;
      setPhase('done');
      onComplete();
    }
  }, [readyToExit, loading, phase, onComplete]);

  useEffect(() => {
    if (hasError && phase !== 'done') {
      entranceCompletedInSession = true;
      setPhase('done');
      onComplete();
    }
  }, [hasError, phase, onComplete]);

  useEffect(() => {
    if (phase === 'done') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        entranceCompletedInSession = true;
        setPhase('done');
        onComplete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onComplete]);

  if (phase === 'done') return null;

  return (
    <div
      className={`kr-entrance kr-entrance--${phase}`}
      role="presentation"
      aria-hidden="true"
      onClick={() => {
        if (!loading) {
          entranceCompletedInSession = true;
          setPhase('done');
          onComplete();
        }
      }}
    >
      <div className="kr-entrance-glow" />
      <div className="kr-entrance-stage">
        <div className="kr-entrance-mark">
          <BrandLogo variant="light" height={50} markOnly />
        </div>
        <div className="kr-entrance-word" aria-label="Kronner">
          {LETTERS.map((ch, idx) => (
            <span
              key={idx}
              className="kr-entrance-char"
              style={{ transitionDelay: phase === 'write' ? `${idx * 75}ms` : '0ms' }}
            >
              {ch}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
