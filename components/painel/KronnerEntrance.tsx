'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

type KronnerEntranceProps = {
  /** Whether the underlying panel data is still loading */
  loading?: boolean;
  /** Called right as the radial wave starts so the panel ripples out from the logo */
  onComplete: () => void;
  /** Dismiss immediately if a loading error occurs */
  hasError?: boolean;
};

let entranceCompletedInSession = false;

const CENTER_LETTERS = ['K', 'R', 'O', 'N', 'N', 'E', 'R'];
const TAIL_LETTERS = ['R', 'O', 'N', 'N', 'E', 'R'];

/**
 * Precision 6-stage Kronner entrance (~2.8s):
 * 1. Full-screen Kronner primary brand canvas (#0D6E52 Deep Botanical Emerald)
 * 2. Center progressive write: K R O N N E R
 * 3. Retract tail -> ONLY K remains centered with refined 360° precision sweep
 * 4. K glides to the EXACT measured pixel coordinates of .sidebar .brand
 * 5. Docked in the corner, K finishes writing R O N N E R beside itself
 * 6. Radial wave bursts outward from the Kronner logo revealing every nav icon & card in sequence
 */
export function KronnerEntrance({ loading = false, onComplete, hasError }: KronnerEntranceProps) {
  const [phase, setPhase] = useState<
    'idle' | 'write-center' | 'isolate-k' | 'fly-corner' | 'write-corner' | 'wave-open' | 'reduced' | 'done'
  >(() => (entranceCompletedInSession ? 'done' : 'idle'));
  const [readyToWave, setReadyToWave] = useState(false);
  const [dock, setDock] = useState({ dx: -520, dy: -320, scale: 0.62, x: 42, y: 36 });
  const stageRef = useRef<HTMLDivElement | null>(null);

  const measureDockTarget = () => {
    if (typeof window === 'undefined') return;
    const brandEl =
      document.querySelector<HTMLElement>('.sidebar .brand') ||
      document.querySelector<HTMLElement>('.topbar');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = vw / 2;
    const cy = vh / 2;

    if (brandEl) {
      const rect = brandEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.left >= 0) {
        const targetX = rect.left + 18;
        const targetY = rect.top + rect.height / 2;
        setDock({
          dx: Math.round(targetX - cx),
          dy: Math.round(targetY - cy),
          scale: 0.62,
          x: Math.round(targetX),
          y: Math.round(targetY),
        });
        return;
      }
    }

    // Fallback aligned with desktop sidebar (.sidebar width 250px, padding 22px) or mobile topbar
    const isMobile = vw <= 960;
    const targetX = isMobile ? 64 : 44;
    const targetY = isMobile ? 32 : 38;
    setDock({
      dx: Math.round(targetX - cx),
      dy: Math.round(targetY - cy),
      scale: 0.62,
      x: targetX,
      y: targetY,
    });
  };

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
      const r2 = window.setTimeout(() => setReadyToWave(true), 550);
      return () => {
        window.clearTimeout(r1);
        window.clearTimeout(r2);
      };
    }

    measureDockTarget();

    let raf1 = 0;
    let raf2 = 0;
    let tIsolate = 0;
    let tFly = 0;
    let tWriteCorner = 0;
    let tWave = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setPhase('write-center');
        tIsolate = window.setTimeout(() => {
          measureDockTarget();
          setPhase('isolate-k');
        }, 900);
        tFly = window.setTimeout(() => {
          measureDockTarget();
          setPhase('fly-corner');
        }, 1480);
        tWriteCorner = window.setTimeout(() => {
          setPhase('write-corner');
        }, 1980);
        tWave = window.setTimeout(() => {
          setReadyToWave(true);
        }, 2520);
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(tIsolate);
      window.clearTimeout(tFly);
      window.clearTimeout(tWriteCorner);
      window.clearTimeout(tWave);
    };
  }, [onComplete]);

  // Trigger the radial wave reveal once both timeline and data load are ready
  useEffect(() => {
    if (!readyToWave || loading || phase === 'done' || phase === 'wave-open') return;
    setPhase('wave-open');
    onComplete();
    const finishTimer = window.setTimeout(() => {
      entranceCompletedInSession = true;
      setPhase('done');
    }, 520);
    return () => window.clearTimeout(finishTimer);
  }, [readyToWave, loading, phase, onComplete]);

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

  const isDocked = phase === 'fly-corner' || phase === 'write-corner' || phase === 'wave-open';

  return (
    <div
      className={`kr-entrance kr-entrance--${phase}`}
      role="presentation"
      aria-hidden="true"
      style={
        {
          '--dock-dx': `${dock.dx}px`,
          '--dock-dy': `${dock.dy}px`,
          '--dock-scale': String(dock.scale),
          '--logo-x': `${dock.x}px`,
          '--logo-y': `${dock.y}px`,
        } as React.CSSProperties
      }
      onClick={() => {
        if (!loading) {
          entranceCompletedInSession = true;
          setPhase('done');
          onComplete();
        }
      }}
    >
      <div className="kr-entrance-wave-ring" />
      <div
        ref={stageRef}
        className={`kr-entrance-stage ${isDocked ? 'is-docked' : ''}`}
      >
        <div className="kr-entrance-mark">
          <BrandLogo variant="light" height={52} markOnly />
        </div>

        {/* Center progressive write: K R O N N E R (retracts so ONLY K remains) */}
        <div className="kr-entrance-center-word" aria-hidden="true">
          {CENTER_LETTERS.map((ch, idx) => (
            <span
              key={idx}
              className="kr-entrance-char"
              style={{
                transitionDelay:
                  phase === 'write-center'
                    ? `${idx * 75}ms`
                    : phase === 'isolate-k'
                      ? `${(CENTER_LETTERS.length - 1 - idx) * 28}ms`
                      : '0ms',
              }}
            >
              {ch}
            </span>
          ))}
        </div>

        {/* Corner progressive write: K (mark) + R O N N E R once docked in the sidebar corner */}
        <div className="kr-entrance-corner-word" aria-hidden="true">
          <span
            className="kr-entrance-corner-char"
            style={{ transitionDelay: phase === 'write-corner' ? '0ms' : '0ms' }}
          >
            K
          </span>
          {TAIL_LETTERS.map((ch, idx) => (
            <span
              key={idx}
              className="kr-entrance-corner-char"
              style={{
                transitionDelay: phase === 'write-corner' ? `${(idx + 1) * 58}ms` : '0ms',
              }}
            >
              {ch}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
