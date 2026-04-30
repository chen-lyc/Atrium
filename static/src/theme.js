const STORAGE_KEY = "theme-mode";
const root = document.documentElement;
const mediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let transitionFrameRef = null;

function getMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "system";
  } catch (error) {
    return "system";
  }
}

function getResolvedMode(mode = getMode()) {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return mediaQuery && mediaQuery.matches ? "dark" : "light";
}

function syncTransitionClass() {
  root.classList.remove("theme-ready");
  window.cancelAnimationFrame(transitionFrameRef);
  transitionFrameRef = window.requestAnimationFrame(() => {
    transitionFrameRef = window.requestAnimationFrame(() => {
      root.classList.add("theme-ready");
    });
  });
}

function applyMode(mode = getMode(), { suppressTransition = false } = {}) {
  const resolvedMode = getResolvedMode(mode);
  root.setAttribute("data-theme", mode);
  root.setAttribute("data-color-scheme", resolvedMode);
  root.style.colorScheme = resolvedMode;
  if (suppressTransition) {
    root.classList.remove("theme-ready");
  } else {
    syncTransitionClass();
  }
  window.dispatchEvent(
    new window.CustomEvent("themechange", {
      detail: { mode, resolvedMode }
    })
  );
  return resolvedMode;
}

function setMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (error) {
    // Ignore storage errors.
  }
  return applyMode(mode);
}

function cycle() {
  const currentMode = getMode();
  const order = ["light", "dark", "system"];
  const currentIndex = order.indexOf(currentMode);
  const nextMode = order[(currentIndex + 1) % order.length];
  setMode(nextMode);
  return nextMode;
}

function handleSystemThemeChange() {
  if (getMode() === "system") {
    applyMode("system");
  }
}

if (mediaQuery) {
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", handleSystemThemeChange);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(handleSystemThemeChange);
  }
}

applyMode(getMode(), { suppressTransition: true });
transitionFrameRef = window.requestAnimationFrame(() => {
  root.classList.add("theme-ready");
});

export const ThemeManager = {
  getMode,
  getResolvedMode,
  setMode,
  cycle
};
