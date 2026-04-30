import { useEffect, useRef, useState } from "react";
import { createId } from "../utils.js";
import { DEMO_SCRIPTS } from "./demoScripts.js";

const MIN_MESSAGE_GAP = 1500;
const INITIAL_SCRIPT_LEAD_IN_DELAY = 800;
const SCRIPT_CLEAR_SETTLE_DELAY = 220;

function pickRandomScriptIndex(excludeIndex = null) {
  if (!DEMO_SCRIPTS.length) return 0;
  if (DEMO_SCRIPTS.length === 1) return 0;
  const candidates = DEMO_SCRIPTS.map((_, i) => i).filter((i) => i !== excludeIndex);
  const pool = candidates.length ? candidates : DEMO_SCRIPTS.map((_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)] || 0;
}
function buildMessage(message) {
  if (message.type === "system") {
    return { id: createId("demo"), nickname: "__system__", text: message.text, timestamp: Date.now(), isSelf: false, status: "sent", source: message.source || "demo" };
  }
  return { id: createId(message.isSelf ? "visitor" : "demo"), nickname: message.nickname, text: message.text, timestamp: Date.now(), isSelf: Boolean(message.isSelf), status: message.status || "sent", source: message.source || (message.isSelf ? "visitor" : "demo") };
}
function dispatchMessageSignal(message, meta = {}) {
  if (message.nickname === "__system__" || message.nickname === "system") {
    window.dispatchEvent(new CustomEvent("signal-message-system", { detail: { messageId: message.id, text: message.text, source: message.source, isSelf: message.isSelf, ...meta } }));
    return;
  }
  window.dispatchEvent(new CustomEvent("signal-message-broadcast", { detail: { messageId: message.id, nickname: message.nickname, source: message.source, isSelf: message.isSelf, ...meta } }));
}
function dispatchScriptStart(scriptIndex) {
  window.setTimeout(() => { window.dispatchEvent(new CustomEvent("signal-script-start", { detail: { scriptIndex } })); }, 0);
}

export default function useDemoMessages({ enabled, fadeDuration = 600, onTypeATrigger, reducedMotion = false, preserveMessagesOnDisable = false }) {
  const [messages, setMessages] = useState([]);
  const [isFading, setFading] = useState(false);
  const [activeScriptIndex, setActiveScriptIndex] = useState(() => pickRandomScriptIndex());
  const coreTimerRef = useRef(null);
  const pauseTimerRef = useRef(null);
  const queueTimerRef = useRef(null);
  const miscTimersRef = useRef([]);
  const fadeDurationRef = useRef(fadeDuration);
  const enabledRef = useRef(enabled);
  const reducedMotionRef = useRef(reducedMotion);
  const onTypeATriggerRef = useRef(onTypeATrigger);
  const messageQueueRef = useRef([]);
  const lastMessageTimeRef = useRef(Date.now() - MIN_MESSAGE_GAP);
  const processingRef = useRef(false);
  const controllerRef = useRef({ scriptIndex: 0, messageIndex: 0, phase: "idle", dueAt: 0, remaining: 0, paused: false });

  fadeDurationRef.current = fadeDuration; enabledRef.current = enabled; reducedMotionRef.current = reducedMotion; onTypeATriggerRef.current = onTypeATrigger;

  function clearCoreTimer() { window.clearTimeout(coreTimerRef.current); coreTimerRef.current = null; }
  function clearPauseTimer() { window.clearTimeout(pauseTimerRef.current); pauseTimerRef.current = null; }
  function clearQueueTimer() { window.clearTimeout(queueTimerRef.current); queueTimerRef.current = null; }
  function clearMiscTimers() { miscTimersRef.current.forEach((id) => window.clearTimeout(id)); miscTimersRef.current = []; }
  function resetMessageQueue() { clearQueueTimer(); messageQueueRef.current = []; processingRef.current = false; }
  function clearAllTimers() { clearCoreTimer(); clearPauseTimer(); clearQueueTimer(); clearMiscTimers(); }
  function scheduleMisc(callback, delay) { const id = window.setTimeout(callback, delay); miscTimersRef.current.push(id); }
  function scheduleCore(delay, callback) { clearCoreTimer(); controllerRef.current.dueAt = Date.now() + delay; controllerRef.current.remaining = delay; coreTimerRef.current = window.setTimeout(callback, delay); }

  function commitMessage(message, afterCommit, meta) {
    const nextMessage = buildMessage(message);
    setMessages((prev) => [...prev, nextMessage]);
    lastMessageTimeRef.current = Date.now();
    afterCommit?.();
    dispatchMessageSignal(nextMessage, meta);
  }
  function processQueue() {
    if (processingRef.current || !messageQueueRef.current.length) return;
    const sinceLastMessage = Date.now() - lastMessageTimeRef.current;
    if (sinceLastMessage < MIN_MESSAGE_GAP) { clearQueueTimer(); queueTimerRef.current = window.setTimeout(() => { queueTimerRef.current = null; processQueue(); }, MIN_MESSAGE_GAP - sinceLastMessage); return; }
    processingRef.current = true;
    const nextEntry = messageQueueRef.current.shift();
    commitMessage(nextEntry.message, nextEntry.afterCommit, nextEntry.meta);
    processingRef.current = false;
    if (messageQueueRef.current.length) { clearQueueTimer(); queueTimerRef.current = window.setTimeout(() => { queueTimerRef.current = null; processQueue(); }, MIN_MESSAGE_GAP); }
  }
  function enqueueMessage(message, afterCommit, meta) { messageQueueRef.current.push({ message, afterCommit, meta }); processQueue(); }
  function queueTypeATrigger(scriptIndex, messageIndex) {
    const script = DEMO_SCRIPTS[scriptIndex];
    if (!script?.typeA || script.typeA.afterMessageIndex !== messageIndex) return;
    const triggerDelay = reducedMotionRef.current ? 0 : 1000;
    scheduleMisc(() => { if (!enabledRef.current || controllerRef.current.scriptIndex !== scriptIndex) return; onTypeATriggerRef.current?.(); }, triggerDelay);
  }
  function schedulePendingMessage(scriptIndex, messageIndex, delayOverride) {
    const script = DEMO_SCRIPTS[scriptIndex];
    const message = script?.messages?.[messageIndex];
    if (!script || !message) { startTail(scriptIndex); return; }
    const previousDelay = messageIndex === 0 ? 0 : script.messages[messageIndex - 1].delay;
    const baseDelay = Math.max(0, message.delay - previousDelay);
    const delay = delayOverride != null ? delayOverride : messageIndex === 0 ? Math.max(INITIAL_SCRIPT_LEAD_IN_DELAY, baseDelay) : baseDelay;
    controllerRef.current.scriptIndex = scriptIndex; controllerRef.current.messageIndex = messageIndex; controllerRef.current.phase = "message";
    scheduleCore(delay, () => {
      appendInternalMessage(message, () => { queueTypeATrigger(scriptIndex, messageIndex); }, { isScriptMessage: true, scriptIndex, messageIndex });
      const nextIndex = messageIndex + 1; controllerRef.current.messageIndex = nextIndex;
      if (nextIndex >= script.messages.length) startTail(scriptIndex);
      else schedulePendingMessage(scriptIndex, nextIndex);
    });
  }
  function startTail(scriptIndex, delayOverride) {
    const script = DEMO_SCRIPTS[scriptIndex];
    if (!script) return;
    const delay = delayOverride != null ? delayOverride : script.tailSilence;
    controllerRef.current.scriptIndex = scriptIndex; controllerRef.current.phase = "tail";
    scheduleCore(delay, () => { setFading(true); startFade(scriptIndex); });
  }
  function startFade(scriptIndex, delayOverride) {
    const delay = delayOverride != null ? delayOverride : reducedMotionRef.current ? 0 : fadeDurationRef.current;
    controllerRef.current.scriptIndex = scriptIndex; controllerRef.current.phase = "fade";
    scheduleCore(delay, () => {
      resetMessageQueue(); lastMessageTimeRef.current = Date.now() - MIN_MESSAGE_GAP; setMessages([]);
      const nextIndex = pickRandomScriptIndex(scriptIndex);
      controllerRef.current.scriptIndex = nextIndex; controllerRef.current.messageIndex = 0;
      setActiveScriptIndex(nextIndex); dispatchScriptStart(nextIndex); startSwitchClear(nextIndex);
    });
  }
  function startSwitchClear(scriptIndex, delayOverride) {
    const delay = delayOverride != null ? delayOverride : reducedMotionRef.current ? 0 : SCRIPT_CLEAR_SETTLE_DELAY;
    controllerRef.current.scriptIndex = scriptIndex; controllerRef.current.messageIndex = 0; controllerRef.current.phase = "clear";
    scheduleCore(delay, () => { setFading(false); schedulePendingMessage(scriptIndex, 0); });
  }
  function resumeCore() {
    if (!enabledRef.current) return;
    const ctrl = controllerRef.current; ctrl.paused = false;
    if (ctrl.phase === "message") { schedulePendingMessage(ctrl.scriptIndex, ctrl.messageIndex, ctrl.remaining); return; }
    if (ctrl.phase === "tail") { startTail(ctrl.scriptIndex, ctrl.remaining); return; }
    if (ctrl.phase === "fade") { startFade(ctrl.scriptIndex, ctrl.remaining); return; }
    if (ctrl.phase === "clear") { startSwitchClear(ctrl.scriptIndex, ctrl.remaining); }
  }
  function pauseCore(pauseMs) {
    if (!pauseMs || pauseMs <= 0) return;
    const ctrl = controllerRef.current;
    if (!ctrl.phase || ctrl.phase === "idle") return;
    if (!ctrl.paused) { ctrl.remaining = Math.max(0, ctrl.dueAt - Date.now()); ctrl.paused = true; clearCoreTimer(); }
    clearPauseTimer();
    pauseTimerRef.current = window.setTimeout(() => { resumeCore(); }, pauseMs);
  }
  function appendInternalMessage(message, afterCommit, meta) { enqueueMessage(message, afterCommit, meta); }
  function appendMessage(message) { commitMessage(message); }
  function injectMessages(incomingMessages, pauseScriptMs = 0) {
    if (pauseScriptMs > 0) pauseCore(pauseScriptMs);
    (incomingMessages || []).forEach((message) => { const delay = reducedMotionRef.current ? 0 : Math.max(0, message.delay || 0); scheduleMisc(() => { appendInternalMessage(message); }, delay); });
  }
  function holdScript(pauseScriptMs = 0) { if (pauseScriptMs > 0) pauseCore(pauseScriptMs); }

  useEffect(() => {
    if (!enabled || !DEMO_SCRIPTS.length) {
      clearAllTimers(); resetMessageQueue(); lastMessageTimeRef.current = Date.now() - MIN_MESSAGE_GAP;
      if (preserveMessagesOnDisable && DEMO_SCRIPTS.length) {
        setFading(false);
        controllerRef.current = { scriptIndex: activeScriptIndex, messageIndex: 0, phase: "idle", dueAt: 0, remaining: 0, paused: false };
        return undefined;
      }
      setMessages([]); setFading(false); setActiveScriptIndex(0);
      controllerRef.current = { scriptIndex: 0, messageIndex: 0, phase: "idle", dueAt: 0, remaining: 0, paused: false };
      return undefined;
    }
    clearAllTimers(); resetMessageQueue(); lastMessageTimeRef.current = Date.now() - MIN_MESSAGE_GAP;
    setMessages([]); setFading(false);
    const startIndex = pickRandomScriptIndex();
    setActiveScriptIndex(startIndex);
    controllerRef.current = { scriptIndex: startIndex, messageIndex: 0, phase: "idle", dueAt: 0, remaining: 0, paused: false };
    dispatchScriptStart(startIndex);
    schedulePendingMessage(startIndex, 0);
    return () => { clearAllTimers(); };
  }, [enabled, reducedMotion, preserveMessagesOnDisable]);

  return { messages, isFading, activeScript: DEMO_SCRIPTS[activeScriptIndex] || null, appendMessage, injectMessages, holdScript };
}
