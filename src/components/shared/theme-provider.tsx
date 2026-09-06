"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "auto";

const STORAGE_KEY = "lead-crm:theme";
const DARK_START_HOUR = 19; // 7 PM
const DARK_END_HOUR = 7; // 7 AM

function isNightNow(): boolean {
  const h = new Date().getHours();
  return h >= DARK_START_HOUR || h < DARK_END_HOUR;
}

function isDarkFor(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return isNightNow();
}

function applyTheme(root: HTMLElement, dark: boolean): void {
  root.classList.toggle("dark", dark);
}

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "auto",
  setMode: () => {},
  isDark: isNightNow(),
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    // localStorage unavailable — fall back to auto.
  }
  return "auto";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [isDark, setIsDark] = useState<boolean>(() => isDarkFor(readStoredMode()));

  // Apply the class as soon as the provider mounts (covers hydration before
  // any interaction, complementing the <head> script that pre-sets it).
  useEffect(() => {
    applyTheme(document.documentElement, isDarkFor(mode));
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore persistence failures.
    }
    const dark = isDarkFor(next);
    setIsDark(dark);
    applyTheme(document.documentElement, dark);
  }, []);

  // Keep the auto mode honest across dusk/dawn without a page reload.
  useEffect(() => {
    if (mode !== "auto") return;
    const check = () => {
      const dark = isNightNow();
      setIsDark(dark);
      applyTheme(document.documentElement, dark);
    };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}