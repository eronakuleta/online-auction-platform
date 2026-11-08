import { useEffect, useState } from 'react';

/**
 * The current time in milliseconds, updated every `intervalMs`. Components read the clock through
 * this hook instead of calling Date.now() while rendering, which would make a render give a
 * different answer each time.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
