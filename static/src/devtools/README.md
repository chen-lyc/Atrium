# Atrium Design Lab

Frontend verification surface for hard-to-reach visual states.

Rules:

- Keep the window shell, preview renderer, scenario registry, and CSS split across focused files.
- Add new cases through `designLabScenarios.js` first; only add preview rendering when a generic preview type is not enough.
- Use local mock data or custom browser events. Do not write backend state or real message history.
- Motion previews must mount the real UI component that owns the animation; do not duplicate `motion.*` variants in the lab just to imitate product surfaces.
- Open from `账户中心 -> 账户设置 -> 前端开发者窗口`; the shell owns the URL state as `/chat?devtools=design-lab` so refresh keeps this interface open.
- Keep it lazy-loaded; `App.jsx` may own the route shell, but should not import the Design Lab bundle eagerly.
