// Renders a single chat message row and its delivery state.
(() => {
    const { motion } = window;
    const { EASE } = window.AppConstants;
    const ANIMATION_PRESETS = {
        standard: {
            initial: { opacity: 0, y: 16 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -8 },
            transition: {
                opacity: { duration: 0.35, ease: EASE },
                y: { duration: 0.35, ease: EASE },
                layout: { duration: 0.42, ease: EASE }
            },
            layout: "position"
        },
        soft: {
            initial: { opacity: 0, y: 8, scale: 0.985 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: -4 },
            transition: {
                opacity: { duration: 0.24, ease: EASE },
                y: { duration: 0.24, ease: EASE },
                scale: { duration: 0.24, ease: EASE }
            },
            layout: false
        },
        calm: {
            initial: { opacity: 0, y: 3 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0 },
            transition: {
                opacity: { duration: 0.18, ease: EASE },
                y: { duration: 0.18, ease: EASE }
            },
            layout: false
        },
        welcome: {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: {
                opacity: { duration: 0.22, ease: EASE }
            },
            layout: false
        },
        settled: {
            initial: false,
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0 },
            transition: {
                opacity: { duration: 0.12, ease: EASE }
            },
            layout: false
        }
    };

    function MessageItem({ message, hiddenMessageId, itemAnimationMode = "standard" }) {
        const isHiddenForFlight = message.id === hiddenMessageId;
        const resolvedAnimationMode = message.source === "local-welcome" ? "welcome" : itemAnimationMode;
        const animationPreset = ANIMATION_PRESETS[resolvedAnimationMode] || ANIMATION_PRESETS.standard;
        const shouldShowDivider = message.showDivider && message.source !== "local-welcome";

        if (message.nickname === "__system__") {
            return (
                <motion.li
                    initial={animationPreset.initial}
                    animate={animationPreset.animate}
                    exit={animationPreset.exit}
                    transition={animationPreset.transition}
                    layout={animationPreset.layout}
                    className="message-entry is-system"
                    data-message-id={message.id}
                >
                    {shouldShowDivider ? (
                        <div className="time-divider">{message.dividerLabel}</div>
                    ) : null}
                    <div className="system-message">{message.text}</div>
                </motion.li>
            );
        }

        return (
            <motion.li
                initial={animationPreset.initial}
                animate={animationPreset.animate}
                exit={animationPreset.exit}
                transition={animationPreset.transition}
                layout={animationPreset.layout}
                className={`message-entry ${
                    message.groupedWithPrev ? "is-grouped" : message.showDivider ? "is-first" : "is-fresh"
                }`}
                data-message-id={message.id}
            >
                {shouldShowDivider ? (
                    <div className="time-divider">{message.dividerLabel}</div>
                ) : null}

                <motion.article
                    className="message-block"
                    style={{ opacity: isHiddenForFlight ? 0 : 1 }}
                    animate={{ backgroundColor: "rgba(47, 128, 237, 0)" }}
                    transition={{ duration: 0.15, ease: EASE }}
                >
                    {message.showAuthor ? (
                        <div className="message-meta">
                            <span className="message-author-button">
                                <span className="message-author">{message.nickname}</span>
                            </span>
                            {message.isSelf ? <span className="message-you">• 你</span> : null}
                            <span className="message-time">{message.timeLabel}</span>
                        </div>
                    ) : null}

                    <div className="message-text-shell">
                        <p className="message-text">{message.text}</p>
                    </div>

                    {message.isSelf && message.status !== "sent" ? (
                        <div className={`message-state ${message.status === "failed" ? "is-failed" : ""}`}>
                            {message.status === "failed" ? "发送失败" : "发送中"}
                        </div>
                    ) : null}
                </motion.article>
            </motion.li>
        );
    }

    window.MessageItem = MessageItem;
})();
