// Drives the auth-page visitor composer with script-triggered auto typing.
(() => {
    const { useEffect, useRef, useState } = window.React;

    function randomBetween(min, max) {
        return Math.round(min + Math.random() * (max - min));
    }

    function pickNextTypeB(candidates, previousValue) {
        if (!Array.isArray(candidates) || !candidates.length) {
            return "";
        }

        if (candidates.length === 1) {
            return candidates[0];
        }

        const filtered = candidates.filter((candidate) => candidate !== previousValue);
        const pool = filtered.length ? filtered : candidates;
        return pool[Math.floor(Math.random() * pool.length)] || "";
    }

    function getTypingDelay(char, prevChar) {
        let delay = 45 + Math.random() * 40;

        if (/[\u4e00-\u9fa5]/.test(char || "")) {
            delay *= 1.15;
        }

        if (prevChar && /[,，。?!\.？！]/.test(prevChar)) {
            delay += 100 + Math.random() * 100;
        }

        if (Math.random() < 0.03) {
            delay += 200 + Math.random() * 150;
        }

        return delay;
    }

    function getDeleteDelay() {
        return 20 + Math.random() * 20;
    }

    function useAutoTyping({ currentScript, enabled }) {
        const [inputValue, setInputValueState] = useState("");
        const [sendState, setSendStateState] = useState("idle");
        const [currentCandidate, setCurrentCandidateState] = useState({ kind: null, text: "" });

        const autoTimersRef = useRef([]);
        const recoveryTimerRef = useRef(null);
        const inputValueRef = useRef("");
        const sendStateRef = useRef("idle");
        const currentScriptRef = useRef(currentScript);
        const previousTypeBRef = useRef("");
        const hasTriggeredTypeARef = useRef(false);
        const enabledRef = useRef(enabled);
        const lastAutoTypedContentRef = useRef("");
        const reducedMotion = window.useReducedMotion();

        currentScriptRef.current = currentScript;
        enabledRef.current = enabled;

        function setInputValue(nextValue) {
            inputValueRef.current = nextValue;
            setInputValueState(nextValue);
        }

        function setSendState(nextState) {
            sendStateRef.current = nextState;
            setSendStateState(nextState);
        }

        function setCurrentCandidate(nextValue) {
            setCurrentCandidateState(nextValue);
        }

        function resetCandidateTracking() {
            setCurrentCandidate({ kind: null, text: "" });
            lastAutoTypedContentRef.current = "";
        }

        function clearAutoTimers() {
            autoTimersRef.current.forEach((timerId) => {
                window.clearTimeout(timerId);
            });
            autoTimersRef.current = [];
        }

        function clearRecoveryTimer() {
            window.clearTimeout(recoveryTimerRef.current);
            recoveryTimerRef.current = null;
        }

        function scheduleAutoTimer(callback, delay) {
            const timerId = window.setTimeout(callback, delay);
            autoTimersRef.current.push(timerId);
        }

        function scheduleRecovery(callback, delay) {
            clearRecoveryTimer();
            recoveryTimerRef.current = window.setTimeout(callback, delay);
        }

        function cancelAutoTimers() {
            clearAutoTimers();
            clearRecoveryTimer();
        }

        function startTypeBLoop(delayOverride) {
            if (!enabledRef.current || inputValueRef.current.trim() || sendStateRef.current === "user-editing") {
                return;
            }

            const delay = delayOverride != null ? delayOverride : reducedMotion ? 0 : randomBetween(3000, 4000);

            scheduleAutoTimer(() => {
                if (!enabledRef.current || inputValueRef.current.trim() || sendStateRef.current === "user-editing") {
                    return;
                }

                const nextContent = pickNextTypeB(currentScriptRef.current?.typeB, previousTypeBRef.current);
                if (!nextContent) {
                    return;
                }

                previousTypeBRef.current = nextContent;
                startTyping(nextContent, "typeB");
            }, delay);
        }

        function finishDelete() {
            if (!enabledRef.current || sendStateRef.current === "user-editing") {
                return;
            }

            setInputValue("");
            setSendState("idle");
            startTypeBLoop();
        }

        function startDeleting() {
            if (!enabledRef.current || sendStateRef.current === "user-editing") {
                return;
            }

            const existingValue = inputValueRef.current;
            if (!existingValue) {
                finishDelete();
                return;
            }

            setSendState("deleting");

            if (reducedMotion) {
                finishDelete();
                return;
            }

            const characters = Array.from(existingValue);

            function step(nextLength) {
                if (!enabledRef.current || sendStateRef.current === "user-editing") {
                    return;
                }

                if (nextLength < 0) {
                    finishDelete();
                    return;
                }

                setInputValue(characters.slice(0, nextLength).join(""));
                scheduleAutoTimer(() => {
                    step(nextLength - 1);
                }, getDeleteDelay());
            }

            step(characters.length - 1);
        }

        function startWaiting() {
            if (!enabledRef.current || sendStateRef.current === "user-editing") {
                return;
            }

            setSendState("waiting");
            scheduleAutoTimer(() => {
                if (!enabledRef.current || sendStateRef.current === "user-editing") {
                    return;
                }

                startDeleting();
            }, 6000);
        }

        function startTyping(content, kind) {
            if (!content || !enabledRef.current || sendStateRef.current === "user-editing") {
                return;
            }

            clearAutoTimers();
            clearRecoveryTimer();
            setCurrentCandidate({ kind, text: content });
            setSendState("typing");
            setInputValue("");

            if (reducedMotion) {
                setInputValue(content);
                lastAutoTypedContentRef.current = content;
                startWaiting();
                return;
            }

            const characters = Array.from(content);

            function typeAt(index) {
                if (!enabledRef.current || sendStateRef.current === "user-editing") {
                    return;
                }

                const nextValue = characters.slice(0, index + 1).join("");
                setInputValue(nextValue);

                if (index >= characters.length - 1) {
                    lastAutoTypedContentRef.current = content;
                    startWaiting();
                    return;
                }

                scheduleAutoTimer(() => {
                    typeAt(index + 1);
                }, getTypingDelay(characters[index + 1], characters[index]));
            }

            typeAt(0);
        }

        function triggerTypeA() {
            if (
                !enabledRef.current ||
                hasTriggeredTypeARef.current ||
                sendStateRef.current === "user-editing" ||
                Boolean(inputValueRef.current.trim())
            ) {
                return;
            }

            const typeAContent = currentScriptRef.current?.typeA?.content || "";
            if (!typeAContent) {
                return;
            }

            hasTriggeredTypeARef.current = true;
            startTyping(typeAContent, "typeA");
        }

        function recoverToTypeB(delayMs = 4000) {
            clearAutoTimers();
            clearRecoveryTimer();
            setInputValue("");
            setSendState("idle");
            resetCandidateTracking();

            scheduleRecovery(() => {
                if (!enabledRef.current || inputValueRef.current.trim()) {
                    return;
                }

                setSendState("idle");
                startTypeBLoop(0);
            }, reducedMotion ? 0 : delayMs);
        }

        function handleInput(event) {
            const nextValue = event.currentTarget.value;
            const inputType = event.nativeEvent?.inputType || "";
            const isInsertion =
                inputType === "insertText" ||
                inputType === "insertCompositionText" ||
                inputType === "insertFromPaste";
            const isDeletion =
                inputType === "deleteContentBackward" ||
                inputType === "deleteContentForward" ||
                inputType === "deleteByCut";
            const isUserEdit = isInsertion || isDeletion || nextValue !== inputValueRef.current;

            if (!isUserEdit) {
                setInputValue(nextValue);
                return;
            }

            clearRecoveryTimer();

            if (
                sendStateRef.current === "typing" ||
                sendStateRef.current === "waiting" ||
                sendStateRef.current === "deleting"
            ) {
                clearAutoTimers();
            }

            setInputValue(nextValue);
            setSendState("user-editing");

            if (!nextValue.trim()) {
                scheduleRecovery(() => {
                    if (!enabledRef.current || inputValueRef.current.trim()) {
                        return;
                    }

                    setSendState("idle");
                    resetCandidateTracking();
                    startTypeBLoop(0);
                }, reducedMotion ? 0 : 4000);
            }
        }

        useEffect(() => {
            if (enabled) {
                return undefined;
            }

            cancelAutoTimers();
            setInputValue("");
            setSendState("idle");
            resetCandidateTracking();
            previousTypeBRef.current = "";
            hasTriggeredTypeARef.current = false;

            return undefined;
        }, [enabled]);

        useEffect(() => {
            hasTriggeredTypeARef.current = false;
            previousTypeBRef.current = "";
            clearAutoTimers();

            if (sendStateRef.current === "user-editing") {
                if (!inputValueRef.current.trim()) {
                    scheduleRecovery(() => {
                        if (!enabledRef.current || inputValueRef.current.trim()) {
                            return;
                        }

                        setSendState("idle");
                        resetCandidateTracking();
                        startTypeBLoop(0);
                    }, reducedMotion ? 0 : 4000);
                }
                return;
            }

            clearRecoveryTimer();
            setInputValue("");
            setSendState("idle");
            resetCandidateTracking();
        }, [currentScript, reducedMotion]);

        useEffect(() => {
            return () => {
                cancelAutoTimers();
            };
        }, []);

        return {
            inputValue,
            sendState,
            currentCandidate,
            triggerTypeA,
            handleInput,
            cancelAutoTimers,
            recoverToTypeB
        };
    }

    window.useAutoTyping = useAutoTyping;
})();
