import { Moon, Sun } from 'lucide-react';
import React, { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  darkPalette,
  DEFAULT_DARK_COLOR,
  type ThemeMode,
} from "../lib/storeTheme";
const Context = createContext({
  mode: "system" as ThemeMode,
  color: DEFAULT_DARK_COLOR,
  setMode: (_: ThemeMode) => {},
  dark: false,
});
export function StoreThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [saved] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("gb_theme") || "{}");
    } catch {
      return {};
    }
  });
  const [mode, setMode] = useState<ThemeMode>(
    ["system", "light", "dark"].includes(saved.mode) ? saved.mode : "system",
  );
  const color = DEFAULT_DARK_COLOR;
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const location = useLocation();
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("gb_theme", JSON.stringify({ mode }));
    } catch {}
  }, [mode, color]);
  const dark = mode === "dark" || (mode === "system" && systemDark);
  const palette = darkPalette(color);
  useEffect(() => {
    const root = document.documentElement;
    if (location.pathname.startsWith("/admin")) delete root.dataset.storeTheme;
    else root.dataset.storeTheme = dark ? "dark" : "light";
    for (const [key, value] of Object.entries(palette))
      root.style.setProperty(`--store-${key}`, value);
    return () => {
      delete root.dataset.storeTheme;
    };
  }, [location.pathname, dark, color]);
  const style = Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [`--store-${key}`, value]),
  ) as React.CSSProperties;
  return (
    <Context.Provider value={{ mode, color, setMode, dark }}>
      <div
        data-store-theme={
          location.pathname.startsWith("/admin")
            ? undefined
            : dark
              ? "dark"
              : "light"
        }
        style={style}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function StoreThemeControl() {
  const theme = useContext(Context);
  return <button type="button" aria-label={theme.dark ? 'Ativar tema claro' : 'Ativar tema escuro'} aria-pressed={theme.dark} onClick={() => theme.setMode(theme.dark ? 'light' : 'dark')} className="inline-flex items-center gap-2 rounded-lg px-3 py-1 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
    {theme.dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}<span>{theme.dark ? 'Tema claro' : 'Tema escuro'}</span>
  </button>;
}
