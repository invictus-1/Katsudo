import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Live } from './api';

export interface LiveState {
  live: Live | null;
  /** Keys per second, one sample per 100 ms, last 60 seconds (oldest first). */
  history: number[];
}

const Ctx = createContext<LiveState>({ live: null, history: [] });
const HISTORY = 600;
const EVERY_MS = 100;

/** Polls the exact live counters ten times a second while the window is visible. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>({ live: null, history: [] });
  const busy = useRef(false);
  useEffect(() => {
    const tick = () => {
      if (document.hidden || busy.current) return;
      busy.current = true;
      api.live().then(
        (live) => {
          busy.current = false;
          setState((s) => {
            const history = s.history.length >= HISTORY ? s.history.slice(1) : s.history.slice();
            history.push(live.kps);
            return { live, history };
          });
        },
        () => { busy.current = false; },
      );
    };
    tick();
    const t = setInterval(tick, EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);

/** Downsample to one value per `every` samples (max), for a readable sparkline. */
export function bucketMax(values: number[], every: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += every) out.push(Math.max(...values.slice(i, i + every)));
  return out;
}
