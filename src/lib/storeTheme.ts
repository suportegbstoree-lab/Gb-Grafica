export type ThemeMode = "system" | "light" | "dark";
export const DEFAULT_DARK_COLOR = "#111111";
function rgb(hex: string): number[] {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}
export function darkPalette(color: string) {
  const raw = /^#[a-f0-9]{6}$/i.test(color)
    ? rgb(color)
    : rgb(DEFAULT_DARK_COLOR);
  const max = Math.max(...raw);
  const base =
    max > 64 ? raw.map((value) => Math.round((value * 64) / max)) : raw;
  const blend = (amount: number) =>
    "#" +
    base
      .map((value) =>
        Math.round(value + (255 - value) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return {
    base: blend(0),
    surface: blend(0.035),
    raised: blend(0.075),
    border: blend(0.2),
    text: "#f5f5f7",
    muted: "#c4c5ce",
  };
}
