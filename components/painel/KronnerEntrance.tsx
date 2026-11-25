'use client';

import { useEffect, useRef, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

type KronnerEntranceProps = {
  /** Whether the underlying panel data is still loading */
  loading?: boolean;
  /** Called as the entrance dissolves into the panel */
  onComplete: () => void;
  /** Dismiss immediately if a loading error occurs */
  hasError?: boolean;
};

let entranceShownInMemory = false;

const WORDMARK_LETTERS = [
  {
    key: 'k',
    d: 'M172 1556H530V709L942 1120H1358L811 606L1401 0H967L530 467V0H172Z',
    tx: '9',
  },
  {
    key: 'r1',
    d: 'M1004 815Q957 837 910.5 847.5Q864 858 817 858Q679 858 604.5 769.5Q530 681 530 516V0H172V1120H530V936Q599 1046 688.5 1096.5Q778 1147 903 1147Q921 1147 942.0 1145.5Q963 1144 1003 1139Z',
    tx: '59.802',
  },
  {
    key: 'o',
    d: 'M705 891Q586 891 523.5 805.5Q461 720 461 559Q461 398 523.5 312.5Q586 227 705 227Q822 227 884.0 312.5Q946 398 946 559Q946 720 884.0 805.5Q822 891 705 891ZM705 1147Q994 1147 1156.5 991.0Q1319 835 1319 559Q1319 283 1156.5 127.0Q994 -29 705 -29Q415 -29 251.5 127.0Q88 283 88 559Q88 835 251.5 991.0Q415 1147 705 1147Z',
    tx: '97.026',
  },
  {
    key: 'n1',
    d: 'M1298 682V0H938V111V522Q938 667 931.5 722.0Q925 777 909 803Q888 838 852.0 857.5Q816 877 770 877Q658 877 594.0 790.5Q530 704 530 551V0H172V1120H530V956Q611 1054 702.0 1100.5Q793 1147 903 1147Q1097 1147 1197.5 1028.0Q1298 909 1298 682Z',
    tx: '149.564',
  },
  {
    key: 'n2',
    d: 'M1298 682V0H938V111V522Q938 667 931.5 722.0Q925 777 909 803Q888 838 852.0 857.5Q816 877 770 877Q658 877 594.0 790.5Q530 704 530 551V0H172V1120H530V956Q611 1054 702.0 1100.5Q793 1147 903 1147Q1097 1147 1197.5 1028.0Q1298 909 1298 682Z',
    tx: '204.070',
  },
  {
    key: 'e',
    d: 'M1290 563V461H453Q466 335 544.0 272.0Q622 209 762 209Q875 209 993.5 242.5Q1112 276 1237 344V68Q1110 20 983.0 -4.5Q856 -29 729 -29Q425 -29 256.5 125.5Q88 280 88 559Q88 833 253.5 990.0Q419 1147 709 1147Q973 1147 1131.5 988.0Q1290 829 1290 563ZM922 682Q922 784 862.5 846.5Q803 909 707 909Q603 909 538.0 850.5Q473 792 457 682Z',
    tx: '258.576',
  },
  {
    key: 'r2',
    d: 'M1004 815Q957 837 910.5 847.5Q864 858 817 858Q679 858 604.5 769.5Q530 681 530 516V0H172V1120H530V936Q599 1046 688.5 1096.5Q778 1147 903 1147Q921 1147 942.0 1145.5Q963 1144 1003 1139Z',
    tx: '310.420',
  },
] as const;

/**
 * Branded Kronner entrance (~1.5s):
 * 1. Full-screen Kronner Deep Botanical Emerald (#0D6E52)
 * 2. Official K mark enters first via HTML-wrapped GPU transform + opacity
 * 3. Wordmark "kronner" writes progressively left-to-right via clip-path wipe + letter stagger
 * 4. Smoothly dissolves and triggers the panel opening choreography without ever cancelling timers
 */
export function KronnerEntrance({ loading = false, onComplete, hasError }: KronnerEntranceProps) {
  const [exiting, setExiting] = useState(false);
  const [done, setDone] = useState(() => entranceShownInMemory);
  const [minTimePassed, setMinTimePassed] = useState(false);
  const startedExitRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (entranceShownInMemory) {
      setDone(true);
      onCompleteRef.current();
      return;
    }

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const timer = window.setTimeout(() => setMinTimePassed(true), reduced ? 980 : 1480);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (done || startedExitRef.current) return;
    if ((minTimePassed && !loading) || hasError) {
      startedExitRef.current = true;
      setExiting(true);
      window.setTimeout(() => {
        onCompleteRef.current();
      }, hasError ? 0 : 180);
      window.setTimeout(() => {
        entranceShownInMemory = true;
        setDone(true);
      }, 420);
    }
  }, [minTimePassed, loading, hasError, done]);

  if (done) return null;

  return (
    <div
      className={`kr-splash ${exiting ? 'kr-splash--exit' : ''}`}
      role="presentation"
      aria-hidden="true"
    >
      <div className="kr-splash-lockup">
        <div className="kr-splash-mark-wrap">
          <BrandLogo variant="light" height={56} markOnly />
        </div>
        <div className="kr-splash-word-wrap">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 365 100"
            className="kr-splash-word-svg"
            role="img"
            aria-label="kronner"
          >
            <g fill="#F2F5F3">
              {WORDMARK_LETTERS.map((letter, idx) => (
                <path
                  key={letter.key}
                  className="kr-splash-letter"
                  style={{ animationDelay: `${360 + idx * 80}ms` }}
                  d={letter.d}
                  transform={`translate(${letter.tx} 84) scale(0.038574 -0.038574)`}
                />
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
