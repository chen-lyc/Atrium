// Renders the composer and preserves textarea resize and send behavior.
(() => {
    const { useEffect, useRef } = window.React;
    const { motion } = window;
    const { EASE, TAP_TRANSITION } = window.AppConstants;

    function MessageInput({
        value,
        onChange,
        onSend,
        disabled,
        composerFieldRef,
        shouldAnimateEntry,
        entryDelay,
        entryDuration = 0.3,
        entryOffsetY = 20,
        transitionMode = "idle",
        motionTiming = null,
        readOnly = false
    }) {
        const textareaRef = useRef(null);
        const reducedMotion = window.useReducedMotion();
        const isActive = Boolean(value.trim()) && !disabled && !readOnly;
        const isEntering = transitionMode === "enter";
        const isExiting = transitionMode === "exit";
        const initial = isEntering
            ? { y: reducedMotion ? 0 : motionTiming?.y ?? entryOffsetY, opacity: 0 }
            : shouldAnimateEntry
                ? { y: reducedMotion ? 0 : entryOffsetY, opacity: 0 }
                : false;
        const animate = isExiting
            ? { y: reducedMotion ? 0 : motionTiming?.y || 0, opacity: 0 }
            : { y: 0, opacity: 1 };
        const transition = isEntering || isExiting
            ? {
                delay: motionTiming?.delay || 0,
                duration: motionTiming?.duration || entryDuration,
                ease: EASE
            }
            : shouldAnimateEntry
                ? { delay: entryDelay, duration: entryDuration, ease: EASE }
                : { duration: 0.18, ease: EASE };

        useEffect(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
                return;
            }

            textarea.style.height = "0px";
            textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
        }, [value]);

        function handleKeyDown(event) {
            if (readOnly) {
                return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
            }

            if (event.key === "Escape") {
                event.currentTarget.blur();
            }
        }

        return (
            <motion.section
                className="composer"
                initial={initial}
                animate={animate}
                transition={transition}
            >
                <div className="composer-inner">
                    <div className="composer-row">
                        <div className="composer-field" ref={composerFieldRef}>
                            <textarea
                                id="chat-message-composer"
                                name="message"
                                ref={textareaRef}
                                className="composer-input"
                                value={value}
                                onChange={(event) => onChange(event.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="输入消息，按 Enter 发送"
                                aria-label="消息输入框"
                                disabled={false}
                                readOnly={readOnly}
                                tabIndex={readOnly ? -1 : undefined}
                                style={readOnly ? { pointerEvents: "none" } : undefined}
                            />

                            <div className="composer-send-wrap">
                                <motion.button
                                    type="button"
                                    className={`send-button focus-ring ${isActive ? "is-active" : ""}`}
                                    onClick={readOnly ? undefined : onSend}
                                    disabled={disabled}
                                    whileTap={{ scale: 0.97 }}
                                    transition={TAP_TRANSITION}
                                    aria-label="发送消息"
                                    tabIndex={readOnly ? -1 : undefined}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                        <path d="M8 12V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                        <path d="M4.75 7.25L8 4L11.25 7.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </motion.button>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.section>
        );
    }

    window.MessageInput = MessageInput;
})();
