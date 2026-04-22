// Drives the rotating auth-page scripts and supports injected replies.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { createId } = window.AppUtils;
    const DEMO_SCRIPTS = window.DEMO_SCRIPTS || [];
    const MIN_MESSAGE_GAP = 1200;
    const SCRIPT_LEAD_IN_DELAY = 1200;

    function pickRandomScriptIndex(excludeIndex = null) {
        if (!DEMO_SCRIPTS.length) {
            return 0;
        }

        if (DEMO_SCRIPTS.length === 1) {
            return 0;
        }

        const candidates = DEMO_SCRIPTS
            .map((_, index) => index)
            .filter((index) => index !== excludeIndex);
        const pool = candidates.length ? candidates : DEMO_SCRIPTS.map((_, index) => index);
        return pool[Math.floor(Math.random() * pool.length)] || 0;
    }

    function buildMessage(message) {
        if (message.type === "system") {
            return {
                id: createId("demo"),
                nickname: "__system__",
                text: message.text,
                timestamp: Date.now(),
                isSelf: false,
                status: "sent",
                source: message.source || "demo"
            };
        }

        return {
            id: createId(message.isSelf ? "visitor" : "demo"),
            nickname: message.nickname,
            text: message.text,
            timestamp: Date.now(),
            isSelf: Boolean(message.isSelf),
            status: message.status || "sent",
            source: message.source || (message.isSelf ? "visitor" : "demo")
        };
    }

    function useDemoMessages({ enabled, fadeDuration = 600, onTypeATrigger, reducedMotion = false }) {
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
        const controllerRef = useRef({
            scriptIndex: 0,
            messageIndex: 0,
            phase: "idle",
            dueAt: 0,
            remaining: 0,
            paused: false
        });

        fadeDurationRef.current = fadeDuration;
        enabledRef.current = enabled;
        reducedMotionRef.current = reducedMotion;
        onTypeATriggerRef.current = onTypeATrigger;

        function clearCoreTimer() {
            window.clearTimeout(coreTimerRef.current);
            coreTimerRef.current = null;
        }

        function clearPauseTimer() {
            window.clearTimeout(pauseTimerRef.current);
            pauseTimerRef.current = null;
        }

        function clearQueueTimer() {
            window.clearTimeout(queueTimerRef.current);
            queueTimerRef.current = null;
        }

        function clearMiscTimers() {
            miscTimersRef.current.forEach((timerId) => {
                window.clearTimeout(timerId);
            });
            miscTimersRef.current = [];
        }

        function resetMessageQueue() {
            clearQueueTimer();
            messageQueueRef.current = [];
            processingRef.current = false;
        }

        function clearAllTimers() {
            clearCoreTimer();
            clearPauseTimer();
            clearQueueTimer();
            clearMiscTimers();
        }

        function scheduleMisc(callback, delay) {
            const timerId = window.setTimeout(callback, delay);
            miscTimersRef.current.push(timerId);
        }

        function scheduleCore(delay, callback) {
            clearCoreTimer();
            controllerRef.current.dueAt = Date.now() + delay;
            controllerRef.current.remaining = delay;
            coreTimerRef.current = window.setTimeout(callback, delay);
        }

        function commitMessage(message, afterCommit) {
            setMessages((prevMessages) => [...prevMessages, buildMessage(message)]);
            lastMessageTimeRef.current = Date.now();
            afterCommit?.();
        }

        function processQueue() {
            if (processingRef.current || !messageQueueRef.current.length) {
                return;
            }

            const sinceLastMessage = Date.now() - lastMessageTimeRef.current;
            if (sinceLastMessage < MIN_MESSAGE_GAP) {
                clearQueueTimer();
                queueTimerRef.current = window.setTimeout(() => {
                    queueTimerRef.current = null;
                    processQueue();
                }, MIN_MESSAGE_GAP - sinceLastMessage);
                return;
            }

            processingRef.current = true;
            const nextEntry = messageQueueRef.current.shift();
            commitMessage(nextEntry.message, nextEntry.afterCommit);
            processingRef.current = false;

            if (messageQueueRef.current.length) {
                clearQueueTimer();
                queueTimerRef.current = window.setTimeout(() => {
                    queueTimerRef.current = null;
                    processQueue();
                }, MIN_MESSAGE_GAP);
            }
        }

        function enqueueMessage(message, afterCommit) {
            messageQueueRef.current.push({ message, afterCommit });
            processQueue();
        }

        function queueTypeATrigger(scriptIndex, messageIndex) {
            const script = DEMO_SCRIPTS[scriptIndex];
            if (!script?.typeA || script.typeA.afterMessageIndex !== messageIndex) {
                return;
            }

            const triggerDelay = reducedMotionRef.current ? 0 : 1000;
            scheduleMisc(() => {
                if (!enabledRef.current || controllerRef.current.scriptIndex !== scriptIndex) {
                    return;
                }

                onTypeATriggerRef.current?.();
            }, triggerDelay);
        }

        function schedulePendingMessage(scriptIndex, messageIndex, delayOverride) {
            const script = DEMO_SCRIPTS[scriptIndex];
            const message = script?.messages?.[messageIndex];
            if (!script || !message) {
                startTail(scriptIndex);
                return;
            }

            const previousDelay = messageIndex === 0 ? 0 : script.messages[messageIndex - 1].delay;
            const baseDelay = Math.max(0, message.delay - previousDelay);
            const delay =
                delayOverride != null
                    ? delayOverride
                    : messageIndex === 0
                        ? Math.max(SCRIPT_LEAD_IN_DELAY, baseDelay)
                        : baseDelay;

            controllerRef.current.scriptIndex = scriptIndex;
            controllerRef.current.messageIndex = messageIndex;
            controllerRef.current.phase = "message";

            scheduleCore(delay, () => {
                appendInternalMessage(message, () => {
                    queueTypeATrigger(scriptIndex, messageIndex);
                });

                const nextIndex = messageIndex + 1;
                controllerRef.current.messageIndex = nextIndex;

                if (nextIndex >= script.messages.length) {
                    startTail(scriptIndex);
                } else {
                    schedulePendingMessage(scriptIndex, nextIndex);
                }
            });
        }

        function startTail(scriptIndex, delayOverride) {
            const script = DEMO_SCRIPTS[scriptIndex];
            if (!script) {
                return;
            }

            const delay = delayOverride != null ? delayOverride : script.tailSilence;

            controllerRef.current.scriptIndex = scriptIndex;
            controllerRef.current.phase = "tail";

            scheduleCore(delay, () => {
                setFading(true);
                startFade(scriptIndex);
            });
        }

        function startFade(scriptIndex, delayOverride) {
            const delay =
                delayOverride != null ? delayOverride : reducedMotionRef.current ? 0 : fadeDurationRef.current;

            controllerRef.current.scriptIndex = scriptIndex;
            controllerRef.current.phase = "fade";

            scheduleCore(delay, () => {
                resetMessageQueue();
                lastMessageTimeRef.current = Date.now() - MIN_MESSAGE_GAP;
                setMessages([]);
                setFading(false);

                const nextIndex = pickRandomScriptIndex(scriptIndex);
                controllerRef.current.scriptIndex = nextIndex;
                controllerRef.current.messageIndex = 0;
                controllerRef.current.phase = "idle";
                setActiveScriptIndex(nextIndex);
                schedulePendingMessage(nextIndex, 0);
            });
        }

        function resumeCore() {
            if (!enabledRef.current) {
                return;
            }

            const controller = controllerRef.current;
            controller.paused = false;

            if (controller.phase === "message") {
                schedulePendingMessage(controller.scriptIndex, controller.messageIndex, controller.remaining);
                return;
            }

            if (controller.phase === "tail") {
                startTail(controller.scriptIndex, controller.remaining);
                return;
            }

            if (controller.phase === "fade") {
                startFade(controller.scriptIndex, controller.remaining);
            }
        }

        function pauseCore(pauseMs) {
            if (!pauseMs || pauseMs <= 0) {
                return;
            }

            const controller = controllerRef.current;
            if (!controller.phase || controller.phase === "idle") {
                return;
            }

            if (!controller.paused) {
                controller.remaining = Math.max(0, controller.dueAt - Date.now());
                controller.paused = true;
                clearCoreTimer();
            }

            clearPauseTimer();
            pauseTimerRef.current = window.setTimeout(() => {
                resumeCore();
            }, pauseMs);
        }

        function appendInternalMessage(message, afterCommit) {
            enqueueMessage(message, afterCommit);
        }

        function appendMessage(message) {
            commitMessage(message);
        }

        function injectMessages(incomingMessages, pauseScriptMs = 0) {
            if (pauseScriptMs > 0) {
                pauseCore(pauseScriptMs);
            }

            (incomingMessages || []).forEach((message) => {
                const delay = reducedMotionRef.current ? 0 : Math.max(0, message.delay || 0);
                scheduleMisc(() => {
                    appendInternalMessage(message);
                }, delay);
            });
        }

        useEffect(() => {
            if (!enabled || !DEMO_SCRIPTS.length) {
                clearAllTimers();
                resetMessageQueue();
                lastMessageTimeRef.current = Date.now() - MIN_MESSAGE_GAP;
                setMessages([]);
                setFading(false);
                setActiveScriptIndex(0);
                controllerRef.current = {
                    scriptIndex: 0,
                    messageIndex: 0,
                    phase: "idle",
                    dueAt: 0,
                    remaining: 0,
                    paused: false
                };
                return undefined;
            }

            clearAllTimers();
            resetMessageQueue();
            lastMessageTimeRef.current = Date.now() - MIN_MESSAGE_GAP;
            setMessages([]);
            setFading(false);
            const startIndex = pickRandomScriptIndex();
            setActiveScriptIndex(startIndex);
            controllerRef.current = {
                scriptIndex: startIndex,
                messageIndex: 0,
                phase: "idle",
                dueAt: 0,
                remaining: 0,
                paused: false
            };
            schedulePendingMessage(startIndex, 0);

            return () => {
                clearAllTimers();
            };
        }, [enabled, reducedMotion]);

        return {
            messages,
            isFading,
            activeScript: DEMO_SCRIPTS[activeScriptIndex] || null,
            appendMessage,
            injectMessages
        };
    }

    window.useDemoMessages = useDemoMessages;
})();
