// Lightweight platform detection without Capacitor dependency.
// Returns true when running inside a native shell (Capacitor/Cordova),
// false in the browser/SSR.
export const isNativePlatform = (() => {
  if (typeof window === "undefined") return false;
  const w = window as any;
  if (w.Capacitor?.isNativePlatform) {
    try { return !!w.Capacitor.isNativePlatform(); } catch { return false; }
  }
  return !!w.cordova;
})();
