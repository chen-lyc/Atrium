import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./styles/home.css";
import "./styles/mobile.css";

const root = createRoot(document.getElementById("root"));
const query = new URLSearchParams(window.location.search);
const demo = query.get("demo");
const isSeatDemo = demo === "ai-seat-vitals" || demo === "ai-seat-adapters";

if (isSeatDemo) {
  import("./chat/AiSeatVitalsDemo.jsx").then(({ default: AiSeatVitalsDemo }) => {
    root.render(React.createElement(AiSeatVitalsDemo, { variant: demo === "ai-seat-adapters" ? "adapters" : "vitals" }));
  });
} else {
  root.render(React.createElement(App));
}
