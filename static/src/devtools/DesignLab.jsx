import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "../constants.js";
import DesignLabPreview from "./DesignLabPreview.jsx";
import {
  DESIGN_LAB_SCENARIOS,
  DESIGN_LAB_THEMES,
  DESIGN_LAB_VIEWPORTS,
  getDesignLabScenario,
  getInitialDesignLabScenarioId,
  runDesignLabAction
} from "./designLabScenarios.js";
import "./designLab.css";

const STORAGE_KEY = "atrium.designLab.selection";

function readStoredSelection() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredSelection(selection) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Design Lab preferences are non-critical.
  }
}

function groupScenarios(scenarios) {
  const groups = [];
  scenarios.forEach((scenario) => {
    let group = groups.find((item) => item.name === scenario.group);
    if (!group) {
      group = { name: scenario.group, scenarios: [] };
      groups.push(group);
    }
    group.scenarios.push(scenario);
  });
  return groups;
}

export default function DesignLab({ onClose = () => {} }) {
  const storedSelection = useMemo(readStoredSelection, []);
  const [selectedId, setSelectedId] = useState(storedSelection.scenarioId || getInitialDesignLabScenarioId());
  const [viewport, setViewport] = useState(storedSelection.viewport || DESIGN_LAB_VIEWPORTS[0].key);
  const [theme, setTheme] = useState(storedSelection.theme || DESIGN_LAB_THEMES[0].key);
  const [runKey, setRunKey] = useState(0);
  const [feedback, setFeedback] = useState("");
  const scenario = getDesignLabScenario(selectedId);
  const groups = useMemo(() => groupScenarios(DESIGN_LAB_SCENARIOS), []);

  useEffect(() => {
    writeStoredSelection({ scenarioId: selectedId, viewport, theme });
  }, [selectedId, viewport, theme]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 1800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function selectScenario(id) {
    setSelectedId(id);
    setRunKey((value) => value + 1);
  }

  function replay() {
    setRunKey((value) => value + 1);
    setFeedback("已重放当前预览");
  }

  function runAction() {
    const message = runDesignLabAction(scenario?.action);
    if (message) setFeedback(message);
  }

  return (
    <motion.aside
      className="design-lab-window"
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.985 }}
      transition={{ duration: 0.18, ease: EASE }}
      aria-label="前端设计验收舱"
    >
      <div className="design-lab-sidebar">
        <header className="design-lab-title">
          <div>
            <span>DESIGN LAB</span>
            <h2>开发者验收</h2>
          </div>
          <button type="button" className="design-lab-close focus-ring" onClick={onClose} aria-label="关闭">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M4 4l7 7M11 4l-7 7" />
            </svg>
          </button>
        </header>

        <div className="design-lab-groups">
          {groups.map((group) => (
            <section key={group.name} className="design-lab-group">
              <h3>{group.name}</h3>
              <div className="design-lab-scenario-list">
                {group.scenarios.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`design-lab-scenario focus-ring ${item.id === scenario?.id ? "is-active" : ""}`}
                    onClick={() => selectScenario(item.id)}
                  >
                    <span>{item.title}</span>
                    <small>{item.surface}</small>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <main className="design-lab-main">
        <header className="design-lab-toolbar">
          <div className="design-lab-current">
            <span>{scenario?.group || "Design"}</span>
            <h2>{scenario?.title || "前端验收"}</h2>
            {scenario?.description ? <p>{scenario.description}</p> : null}
          </div>
          <div className="design-lab-controls" aria-label="预览控制">
            <div className="design-lab-control-group" aria-label="视口">
              {DESIGN_LAB_VIEWPORTS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`focus-ring ${viewport === item.key ? "is-active" : ""}`}
                  onClick={() => setViewport(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="design-lab-control-group" aria-label="主题">
              {DESIGN_LAB_THEMES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`focus-ring ${theme === item.key ? "is-active" : ""}`}
                  onClick={() => setTheme(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <DesignLabPreview scenario={scenario} viewport={viewport} theme={theme} runKey={runKey} />

        <footer className="design-lab-footer">
          <div className="design-lab-checks">
            {scenario?.checks?.map((check) => <span key={check}>{check}</span>)}
          </div>
          <div className="design-lab-actions">
            <button type="button" className="design-lab-action focus-ring" onClick={replay}>
              重放
            </button>
            {scenario?.action ? (
              <button type="button" className="design-lab-action is-primary focus-ring" onClick={runAction}>
                {scenario.actionLabel || "触发"}
              </button>
            ) : null}
          </div>
        </footer>

        <AnimatePresence>
          {feedback ? (
            <motion.div
              key={feedback}
              className="design-lab-feedback"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16, ease: EASE }}
              role="status"
            >
              {feedback}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </motion.aside>
  );
}
