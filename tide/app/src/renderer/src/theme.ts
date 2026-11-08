// Light / dark theme. First start follows the computer's setting; after the user picks one,
// it's remembered on this computer. Switching is instant (just a class on <html>).
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "tide.theme";

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

const system = (): Theme => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
}

/** Call once before the first render so there's no flash of the wrong theme. */
export const initialTheme = (): Theme => saved() ?? system();

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return [
    theme,
    (t: Theme) => {
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* still switches for this session */
      }
      setTheme(t);
    },
  ] as const;
}
