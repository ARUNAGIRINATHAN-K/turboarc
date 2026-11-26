import { useEffect, useRef } from 'react';
import { installBenchGlobal, mountRacingGame } from './game/entry';

installBenchGlobal();

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const dispose = mountRacingGame(el);
    return () => {
      dispose();
    };
  }, []);

  return <div ref={hostRef} className="w-full h-full" />;
}
