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
  setColor: (_: string) => {},
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
  const [color, setColor] = useState(
    /^#[a-f0-9]{6}$/i.test(saved.color) ? saved.color : DEFAULT_DARK_COLOR,
  );
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
      localStorage.setItem("gb_theme", JSON.stringify({ mode, color }));
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
    <Context.Provider value={{ mode, color, setMode, setColor }}>
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
  return (
    <details className="relative text-sm">
      <summary className="cursor-pointer font-bold">Aparência</summary>
      <div className="absolute right-0 top-8 z-50 w-64 space-y-4 rounded-xl border border-gray-200 bg-white p-4 text-gray-900 shadow-xl">
        <label className="block">
          Tema
          <select
            aria-label="Tema da loja"
            value={theme.mode}
            onChange={(e) => theme.setMode(e.target.value as ThemeMode)}
            className="mt-1 block w-full rounded border border-gray-300 p-2"
          >
            <option value="system">Seguir sistema</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          Cor do modo escuro
          <input
            aria-label="Cor do modo escuro"
            type="color"
            value={theme.color}
            onChange={(e) => theme.setColor(e.target.value)}
          />
        </label>
        <p className="text-xs text-gray-500">
          A intensidade é ajustada para manter a leitura.
        </p>
      </div>
    </details>
  );
}
