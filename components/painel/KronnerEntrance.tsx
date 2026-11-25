'use client';

import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

type KronnerEntranceProps = {
  /** Whether the underlying panel data is still loading */
  loading?: boolean;
  /** Called right as the radial wave opens so icons & cards cascade outward from the logo */
  onComplete: () => void;
  /** Dismiss immediately if a loading error occurs */
  hasError?: boolean;
};

let entrancePlayedInMemory = false;

const LETTERS = ['K', 'R', 'O', 'N', 'N', 'E', 'R'];

/**
 * Pure CSS @keyframes 6-stage Kronner entrance (~2.7s):
 * - Renders immediately on frame 0 with #0D6E52 (eliminates any white flash before the green screen)
 * - Runs on pure GPU @keyframes (immune to React StrictMode timer cancellation)
 * - 0.0s–0.85s: Center progressive write of K R O N N E R
 * - 0.85s–1.40s: Tail retracts so ONLY the K stays centered + 360° precision sweep
 * - 1.40s–1.95s: K glides smoothly into the top-left floating pill logo slot
 * - 1.95s–2.45s: Docked in the corner, finishes writing K R O N N E R
 * - 2.45s–2.85s: Radial wave opens outward from the logo, revealing every nav icon & card
 */
export function KronnerEntrance({ loading = false, onComplete, hasError }: KronnerEntranceProps) {
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(() => entrancePlayedInMemory);
  const [timelineDone, setTimelineDone] = useState(false);

  useEffect(() => {
    if (entrancePlayedInMemory) {
      setDone(true);
      onComplete();
      return;
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ms = reduced ? 480 : 2450;
    const timer = window.setTimeout(() => setTimelineDone(true), ms);
    return () => window.clearTimeout(timer);
  }, [onComplete]);

  useEffect(() => {
    if (done || exiting) return;
    if ((timelineDone && !loading) || hasError) {
      setExiting(true);
      onComplete();
      const finish = window.setTimeout(() => {
        entrancePlayedInMemory = true;
        setDone(true);
      }, 480);
      return () => window.clearTimeout(finish);
    }
  }, [timelineDone, loading, hasError, done, exiting, onComplete]);

  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        entrancePlayedInMemory = true;
        setDone(true);
        onComplete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, onComplete]);

  if (done) return null;

  return (
    <div
      className={`kr-intro ${exiting ? 'kr-intro--exit' : ''}`}
      role="presentation"
      aria-hidden="true"
      onClick={() => {
        if (!loading) {
          entrancePlayedInMemory = true;
          setDone(true);
          onComplete();
        }
      }}
    >
      <div className="kr-intro-ring" />
      <div className="kr-intro-actor">
        <div className="kr-intro-mark">
          <BrandLogo variant="light" height={46} markOnly />
        </div>
        <div className="kr-intro-word-center">
          {LETTERS.map((ch, idx) => (
            <span
              key={idx}
              className="kr-intro-c"
              style={{ animationDelay: `${120 + idx * 65}ms` }}
            >
              {ch}
            </span>
          ))}
        </div>
        <div className="kr-intro-word-corner">
          {LETTERS.map((ch, idx) => (
            <span
              key={idx}
              className="kr-intro-d"
              style={{ animationDelay: `${1920 + idx * 55}ms` }}
            >
              {ch}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
