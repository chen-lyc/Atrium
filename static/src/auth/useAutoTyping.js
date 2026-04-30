import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const TYPE_A_MIN_VISIBLE_MS = 8500;
const TYPE_B_MIN_VISIBLE_MS = 6500;
const TYPE_A_MIN_SCRIPT_ADVANCE = 4;
const TYPE_B_MIN_SCRIPT_ADVANCE = 2;

function getTypingDelay(char, prevChar) {
  let delay = 45 + Math.random() * 40;
  if (/[一-龥]/.test(char || "")) delay *= 1.15;
  if (prevChar && /[,，。?!\.？！]/.test(prevChar)) delay += 100 + Math.random() * 100;
  if (Math.random() < 0.03) delay += 200 + Math.random() * 150;
  return delay;
}
function getDeleteDelay() { return 34 + Math.random() * 28; }
function pickNextTypeB(candidates, previousValue) {
  if (!Array.isArray(candidates) || !candidates.length) return "";
  if (candidates.length === 1) return candidates[0];
  const filtered = candidates.filter((c) => c !== previousValue);
  const pool = filtered.length ? filtered : candidates;
  return pool[Math.floor(Math.random() * pool.length)] || "";
}

export default function useAutoTyping({ currentScript, enabled }) {
  const [inputValue, setInputValueState] = useState("");
  const [sendState, setSendStateState] = useState("idle");
  const [currentCandidate, setCurrentCandidateState] = useState({ kind: null, text: "" });
  const autoTimersRef = useRef([]);
  const recoveryTimerRef = useRef(null);
  const typeBTimerRef = useRef(null);
  const inputValueRef = useRef("");
  const sendStateRef = useRef("idle");
  const currentCandidateRef = useRef({ kind: null, text: "" });
  const currentScriptRef = useRef(currentScript);
  const previousTypeBRef = useRef("");
  const hasTriggeredTypeARef = useRef(false);
  const enabledRef = useRef(enabled);
  const lastAutoTypedContentRef = useRef("");
  const lastSuggestionAtRef = useRef(0);
  const demoMessageCountRef = useRef(0);
  const messageCountAtSuggestionRef = useRef(0);
  const lastScriptMessageIndexRef = useRef(null);
  const scriptMessageIndexAtSuggestionRef = useRef(null);
  const reducedMotion = useReducedMotion();

  currentScriptRef.current = currentScript;
  enabledRef.current = enabled;

  function setInputValue(nextValue) { inputValueRef.current = nextValue; setInputValueState(nextValue); }
  function setSendState(nextState) { sendStateRef.current = nextState; setSendStateState(nextState); }
  function setCurrentCandidate(nextValue) { currentCandidateRef.current = nextValue; setCurrentCandidateState(nextValue); }
  function resetCandidateTracking() { setCurrentCandidate({ kind: null, text: "" }); lastAutoTypedContentRef.current = ""; }
  function clearAutoTimers() { autoTimersRef.current.forEach((id) => window.clearTimeout(id)); autoTimersRef.current = []; }
  function clearRecoveryTimer() { window.clearTimeout(recoveryTimerRef.current); recoveryTimerRef.current = null; }
  function clearTypeBTimer() { window.clearTimeout(typeBTimerRef.current); typeBTimerRef.current = null; }
  function scheduleAutoTimer(callback, delay) { const id = window.setTimeout(callback, delay); autoTimersRef.current.push(id); }
  function scheduleRecovery(callback, delay) { clearRecoveryTimer(); recoveryTimerRef.current = window.setTimeout(callback, delay); }
  function cancelAutoTimers() { clearAutoTimers(); clearRecoveryTimer(); clearTypeBTimer(); }

  function finishDelete(afterDelete) {
    if (!enabledRef.current || sendStateRef.current === "user-editing") return;
    setInputValue(""); setSendState("idle"); resetCandidateTracking();
    afterDelete?.();
  }
  function startDeleting(afterDelete) {
    if (!enabledRef.current || sendStateRef.current === "user-editing") return;
    const existingValue = inputValueRef.current;
    if (!existingValue) { finishDelete(afterDelete); return; }
    clearAutoTimers(); clearRecoveryTimer(); clearTypeBTimer();
    setSendState("deleting");
    if (reducedMotion) { finishDelete(afterDelete); return; }
    const characters = Array.from(existingValue);
    function step(nextLength) {
      if (!enabledRef.current || sendStateRef.current === "user-editing") return;
      if (nextLength < 0) { finishDelete(afterDelete); return; }
      setInputValue(characters.slice(0, nextLength).join(""));
      scheduleAutoTimer(() => { step(nextLength - 1); }, getDeleteDelay());
    }
    step(characters.length - 1);
  }
  function scheduleTypeB(delayMs = 0) {
    clearTypeBTimer();
    if (!enabledRef.current || inputValueRef.current.trim() || sendStateRef.current !== "idle") return;
    typeBTimerRef.current = window.setTimeout(() => {
      typeBTimerRef.current = null;
      if (!enabledRef.current || inputValueRef.current.trim() || sendStateRef.current !== "idle") return;
      const nextContent = pickNextTypeB(currentScriptRef.current?.typeB, previousTypeBRef.current);
      if (!nextContent) return;
      previousTypeBRef.current = nextContent;
      startTyping(nextContent, "typeB");
    }, delayMs);
  }
  function startWaiting() { if (!enabledRef.current || sendStateRef.current === "user-editing") return; setSendState("waiting"); }
  function startTyping(content, kind) {
    if (!content || !enabledRef.current || sendStateRef.current === "user-editing") return;
    clearAutoTimers(); clearRecoveryTimer(); clearTypeBTimer();
    setCurrentCandidate({ kind, text: content });
    setSendState("typing"); setInputValue("");
    lastSuggestionAtRef.current = Date.now();
    messageCountAtSuggestionRef.current = demoMessageCountRef.current;
    scriptMessageIndexAtSuggestionRef.current = lastScriptMessageIndexRef.current;
    if (reducedMotion) { setInputValue(content); lastAutoTypedContentRef.current = content; startWaiting(); return; }
    const characters = Array.from(content);
    function typeAt(index) {
      if (!enabledRef.current || sendStateRef.current === "user-editing") return;
      const nextValue = characters.slice(0, index + 1).join("");
      setInputValue(nextValue);
      if (index >= characters.length - 1) { lastAutoTypedContentRef.current = content; startWaiting(); return; }
      scheduleAutoTimer(() => { typeAt(index + 1); }, getTypingDelay(characters[index + 1], characters[index]));
    }
    typeAt(0);
  }
  function triggerTypeA() {
    if (!enabledRef.current || hasTriggeredTypeARef.current || sendStateRef.current === "user-editing" || Boolean(inputValueRef.current.trim())) return;
    const typeAContent = currentScriptRef.current?.typeA?.content || "";
    if (!typeAContent) return;
    hasTriggeredTypeARef.current = true;
    startTyping(typeAContent, "typeA");
  }
  function recoverToTypeB(delayMs = 1800) {
    clearAutoTimers(); clearRecoveryTimer(); clearTypeBTimer();
    setInputValue(""); setSendState("idle"); resetCandidateTracking();
    scheduleTypeB(reducedMotion ? 0 : delayMs);
  }
  function handleInput(event) {
    const nextValue = event.currentTarget.value;
    const inputType = event.nativeEvent?.inputType || "";
    const isInsertion = inputType === "insertText" || inputType === "insertCompositionText" || inputType === "insertFromPaste";
    const isDeletion = inputType === "deleteContentBackward" || inputType === "deleteContentForward" || inputType === "deleteByCut";
    const isUserEdit = isInsertion || isDeletion || nextValue !== inputValueRef.current;
    if (!isUserEdit) { setInputValue(nextValue); return; }
    clearRecoveryTimer();
    if (sendStateRef.current === "typing" || sendStateRef.current === "waiting" || sendStateRef.current === "deleting") {
      clearAutoTimers(); clearTypeBTimer();
    }
    setInputValue(nextValue); setSendState("user-editing");
    if (!nextValue.trim()) {
      scheduleRecovery(() => { if (!enabledRef.current || inputValueRef.current.trim()) return; setSendState("idle"); resetCandidateTracking(); }, reducedMotion ? 0 : 4000);
    }
  }

  // Effects (same logic, converted to ESM)
  useEffect(() => {
    if (enabled) return undefined;
    cancelAutoTimers(); setInputValue(""); setSendState("idle"); resetCandidateTracking();
    hasTriggeredTypeARef.current = false; previousTypeBRef.current = "";
    demoMessageCountRef.current = 0; lastScriptMessageIndexRef.current = null; scriptMessageIndexAtSuggestionRef.current = null;
    return undefined;
  }, [enabled]);

  useEffect(() => {
    hasTriggeredTypeARef.current = false; clearAutoTimers(); clearTypeBTimer();
    previousTypeBRef.current = ""; demoMessageCountRef.current = 0;
    lastScriptMessageIndexRef.current = null; scriptMessageIndexAtSuggestionRef.current = null;
    if (sendStateRef.current === "user-editing") {
      if (!inputValueRef.current.trim()) { scheduleRecovery(() => { if (!enabledRef.current || inputValueRef.current.trim()) return; setSendState("idle"); resetCandidateTracking(); }, reducedMotion ? 0 : 4000); }
      return;
    }
    clearRecoveryTimer(); setInputValue(""); setSendState("idle"); resetCandidateTracking();
  }, [currentScript, reducedMotion]);

  useEffect(() => {
    if (!enabled) return undefined;
    function handleDemoBroadcast(event) {
      const detail = event.detail || {};
      if (detail.source !== "demo" || detail.isSelf || !detail.isScriptMessage) return;
      demoMessageCountRef.current += 1;
      lastScriptMessageIndexRef.current = typeof detail.messageIndex === "number" ? detail.messageIndex : null;
      if (!enabledRef.current || sendStateRef.current === "user-editing") return;
      if (sendStateRef.current === "typing" || sendStateRef.current === "deleting") return;
      if (sendStateRef.current === "waiting" && inputValueRef.current.trim()) {
        const candidate = currentCandidateRef.current;
        const suggestionAge = Date.now() - lastSuggestionAtRef.current;
        const messagesSinceSuggestion = Math.max(0, demoMessageCountRef.current - messageCountAtSuggestionRef.current);
        const scriptAdvance = typeof lastScriptMessageIndexRef.current === "number" && typeof scriptMessageIndexAtSuggestionRef.current === "number" ? lastScriptMessageIndexRef.current - scriptMessageIndexAtSuggestionRef.current : messagesSinceSuggestion;
        const minVisible = candidate.kind === "typeA" ? TYPE_A_MIN_VISIBLE_MS : TYPE_B_MIN_VISIBLE_MS;
        const minScriptAdvance = candidate.kind === "typeA" ? TYPE_A_MIN_SCRIPT_ADVANCE : TYPE_B_MIN_SCRIPT_ADVANCE;
        if (suggestionAge < minVisible || scriptAdvance < minScriptAdvance) return;
        const shouldOfferNext = candidate.kind !== "typeA";
        startDeleting(() => { if (shouldOfferNext && demoMessageCountRef.current % 2 === 0) { scheduleTypeB(reducedMotion ? 0 : 900); } });
        return;
      }
      if (sendStateRef.current === "idle" && hasTriggeredTypeARef.current && demoMessageCountRef.current % 3 === 0) {
        scheduleTypeB(reducedMotion ? 0 : 900);
      }
    }
    window.addEventListener("signal-message-broadcast", handleDemoBroadcast);
    return () => { window.removeEventListener("signal-message-broadcast", handleDemoBroadcast); };
  }, [enabled, reducedMotion]);

  useEffect(() => { return () => { cancelAutoTimers(); }; }, []);

  return { inputValue, sendState, currentCandidate, triggerTypeA, handleInput, cancelAutoTimers, recoverToTypeB };
}
