export type Theme = "light" | "dark";
export type ThemePreference = Theme | "auto";

const KEY = "framehouse.theme";

export const getStoredTheme = (): Theme => {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

/** Switches the whole site. The choice is remembered here too, so the next page load has no flash. */
export const applyTheme = (theme: string | undefined | null) => {
  const next: Theme = theme === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.setAttribute("data-theme", next);
  root.style.colorScheme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#f4f6ff" : "#070b1c");
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage can be blocked; the theme still applies for this visit.
  }
};
