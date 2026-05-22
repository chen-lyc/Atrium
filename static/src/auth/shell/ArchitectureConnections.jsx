import { useEffect, useRef, useState } from "react";
import {
  ARCH_PATHS,
  ARCH_PULSE_ARRIVAL_THRESHOLD,
  PULSE_TRAIL_STEPS,
  SVG_VIEWBOX
} from "./AuthShell.constants.js";

function getPulseFadeMultiplier(progress) {
  if (progress <= 0.1) return progress / 0.1;
  if (progress >= 0.9) return (1 - progress) / 0.1;
  return 1;
}

export default function ArchitectureConnections({ reducedMotion, enabled = true }) {
  const pathRefs = useRef({});
  const animationFrameRef = useRef(null);
  const [pulses, setPulses] = useState([]);

  useEffect(() => {
    if (animationFrameRef.current) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
    if (!enabled || reducedMotion) { setPulses([]); return undefined; }
    let isDisposed = false;
    let dispatchedDepartKeys = new Set();
    const timerIds = new Set();
    function queueTimeout(callback, delay) { const id = window.setTimeout(() => { timerIds.delete(id); if (!isDisposed) callback(); }, delay); timerIds.add(id); return id; }
    function dispatchDepart(pathConfig, departKey) {
      if (!pathConfig.sourceTagId) return;
      if (departKey && dispatchedDepartKeys.has(departKey)) return;
      if (departKey) dispatchedDepartKeys.add(departKey);
      window.dispatchEvent(new CustomEvent("arch-pulse-depart", { detail: { sourceTagId: pathConfig.sourceTagId, pathId: pathConfig.id } }));
    }
    function dispatchArrivalAsync(tagId) {
      if (!tagId) return;
      const dispatchArrival = () => { if (isDisposed) return; window.dispatchEvent(new CustomEvent("arch-pulse-arrive", { detail: { tagId } })); };
      if (typeof window.queueMicrotask === "function") { window.queueMicrotask(dispatchArrival); return; }
      window.setTimeout(dispatchArrival, 0);
    }
    function spawnPulse(pathId, duration = 1400, options = {}) {
      const pathConfig = ARCH_PATHS.find((p) => p.id === pathId);
      if (!pathConfig || isDisposed) return;
      if (options.dispatchDepart !== false) dispatchDepart(pathConfig, options.departKey);
      setPulses((prev) => [...prev, { id: `${pathConfig.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`, pathId: pathConfig.id, targetTagId: pathConfig.targetTagId, progress: 0, startTime: window.performance.now(), duration, didDispatchArrival: false }]);
    }
    function handleBroadcast(event) { spawnPulse("path-ai", 1400, { departKey: event.detail?.messageId || `${Date.now()}-${Math.random()}` }); }
    function handleSystem(event) { const departKey = event.detail?.messageId || `${Date.now()}-${Math.random()}`; spawnPulse("path-personal", 1400, { departKey }); spawnPulse("path-notes", 1400, { dispatchDepart: false }); }
    function handleScriptStart(event) { const departKey = `script-${event.detail?.scriptIndex ?? "x"}-${Date.now()}-${Math.random()}`; spawnPulse("path-personal", 1400, { departKey }); queueTimeout(() => { spawnPulse("path-notes", 1400, { dispatchDepart: false }); }, 300); }
    function scheduleAuthProbe() { const delay = 25000 + Math.random() * 10000; queueTimeout(() => { if (Math.random() < 0.25) spawnPulse("path-personal", 1400); scheduleAuthProbe(); }, delay); }
    window.addEventListener("signal-message-broadcast", handleBroadcast);
    window.addEventListener("signal-message-system", handleSystem);
    window.addEventListener("signal-script-start", handleScriptStart);
    scheduleAuthProbe();
    function tick() {
      if (isDisposed) return;
      const now = window.performance.now();
      setPulses((prev) => {
        if (!prev.length) return prev;
        return prev.map((pulse) => {
          const nextProgress = Math.min(1, (now - pulse.startTime) / pulse.duration);
          if (!pulse.didDispatchArrival && pulse.targetTagId && nextProgress >= ARCH_PULSE_ARRIVAL_THRESHOLD) dispatchArrivalAsync(pulse.targetTagId);
          return { ...pulse, progress: nextProgress, didDispatchArrival: pulse.didDispatchArrival || (Boolean(pulse.targetTagId) && nextProgress >= ARCH_PULSE_ARRIVAL_THRESHOLD) };
        }).filter((pulse) => pulse.progress < 1);
      });
      animationFrameRef.current = window.requestAnimationFrame(tick);
    }
    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      isDisposed = true; dispatchedDepartKeys = new Set();
      timerIds.forEach((id) => window.clearTimeout(id)); timerIds.clear();
      window.removeEventListener("signal-message-broadcast", handleBroadcast);
      window.removeEventListener("signal-message-system", handleSystem);
      window.removeEventListener("signal-script-start", handleScriptStart);
      if (animationFrameRef.current) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
    };
  }, [enabled, reducedMotion]);

  const pulseNodes = [];
  pulses.forEach((pulse) => {
    const pathElement = pathRefs.current[pulse.pathId];
    if (!pathElement) return;
    const totalLength = pathElement.getTotalLength();
    const fadeMultiplier = getPulseFadeMultiplier(pulse.progress);
    PULSE_TRAIL_STEPS.forEach((offset, i) => {
      const trailProgress = Math.max(0, pulse.progress - offset);
      const point = pathElement.getPointAtLength(totalLength * trailProgress);
      pulseNodes.push(<circle key={`${pulse.id}-${i}`} className="arch-pulse" cx={point.x} cy={point.y} r={Math.max(0.8, 1.7 - i * 0.2)} fill="var(--pulse-color)" opacity={Math.max(0, 1 - i * 0.24) * fadeMultiplier * 0.42} />);
    });
  });

  return (
    <svg className="arch-connections" viewBox={`${SVG_VIEWBOX.x} ${SVG_VIEWBOX.y} ${SVG_VIEWBOX.width} ${SVG_VIEWBOX.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      {ARCH_PATHS.map((path) => (
        <path key={path.id} id={path.id} ref={(node) => { if (node) pathRefs.current[path.id] = node; else delete pathRefs.current[path.id]; }} className="arch-connection-path" d={path.d} stroke="var(--line-arch)" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
      {pulseNodes}
    </svg>
  );
}
