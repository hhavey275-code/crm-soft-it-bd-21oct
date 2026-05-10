import { useEffect, useMemo, useRef } from "react";

/**
 * Returns a stable debounced version of `fn`.
 * Calls within `delay`ms are coalesced into a single trailing call.
 * Useful for realtime subscription handlers that would otherwise fire
 * dozens of refetches per second under heavy write load.
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  fn: T,
  delay = 1000,
): (...args: Parameters<T>) => void {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);

  const debounced = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fnRef.current(...args);
      }, delay);
    };
  }, [delay]);

  useEffect(() => {
    // Cleanup is handled implicitly when component unmounts and the closure
    // is GC'd; nothing else needed here.
    return () => {};
  }, []);

  return debounced;
}
