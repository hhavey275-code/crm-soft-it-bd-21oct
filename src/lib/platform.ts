import { Capacitor } from "@capacitor/core";

export const isNativePlatform =
  typeof window !== "undefined" && Capacitor.isNativePlatform();