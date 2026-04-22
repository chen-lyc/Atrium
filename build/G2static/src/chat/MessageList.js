// Renders the message viewport, empty state, and auto-scroll behavior.
(() => {
    const { useLayoutEffect, useRef } = window.React;
    const { motion, AnimatePresence } = window;
    const { EASE } = window.AppConstants;
    const { decorateMessages } = window.AppUtils;

    function EmptyState() {
        return (
            <div className="empty-state">
                <div>
                    <div className="empty-title">等待第一条消息</div>
                    <div className="empty-hint">Enter 发送 · Shift+Enter 换行</div>
                </div>
            </div>
        );
    }

    function resolveEmpty(renderEmpty) {
        if (typeof renderEmpty === "function") {
            return renderEmpty();
        }

        if (renderEmpty != null) {
            return renderEmpty;
        }

        return <EmptyState />;
    }

    function MessageList({
        messages,
        onScrolled = () => {},
        hiddenMessageId,
        suspendSmoothScroll,
        shouldAnimateEntry,
        entryDelay,
        isFading = false,
        fadeDuration = 600,
        itemAnimationMode = "standard",
        className = "",
        innerClassName = "",
        viewportRef,
        renderEmpty
    }) {
        const MessageItem = window.MessageItem;
        const localViewportRef = useRef(null);
        const stickToBottomRef = useRef(true);
        const decoratedMessages = decorateMessages(messages);
        const resolvedViewportRef = viewportRef || localViewportRef;

        useLayoutEffect(() => {
            const viewport = resolvedViewportRef.current;
            if (!viewport || !stickToBottomRef.current) {
                return;
            }

            viewport.scrollTop = viewport.scrollHeight;
        }, [messages.length, resolvedViewportRef, suspendSmoothScroll]);

        function handleScroll() {
            const viewport = resolvedViewportRef.current;
            if (!viewport) {
                return;
            }

            const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
            stickToBottomRef.current = distanceFromBottom < 80;
            onScrolled(viewport.scrollTop > 4);
        }

        const initialProps = shouldAnimateEntry ? { opacity: 0 } : false;
        const transition = shouldAnimateEntry
            ? { delay: entryDelay, duration: 0.26, ease: EASE }
            : { duration: 0.18, ease: EASE };
        const viewportClassName = `messages ${className}`.trim();
        const contentClassName = `messages-inner ${innerClassName}`.trim();
        const hasMessages = decoratedMessages.length > 0;

        return (
            <motion.div
                className={viewportClassName}
                ref={resolvedViewportRef}
                onScroll={handleScroll}
            >
                <motion.div
                    className={contentClassName}
                    initial={initialProps}
                    animate={{ opacity: isFading ? 0 : 1 }}
                    transition={{
                        duration: isFading ? fadeDuration / 1000 : transition.duration,
                        delay: isFading ? 0 : transition.delay || 0,
                        ease: EASE
                    }}
                >
                    <AnimatePresence initial={false}>
                        {!hasMessages ? (
                            <motion.div
                                key="empty-state"
                                className="empty-state-layer"
                                initial={{ opacity: 1 }}
                                animate={{ opacity: isFading ? 0 : 1 }}
                                exit={{ opacity: 0 }}
                                transition={{
                                    duration: isFading ? fadeDuration / 1000 : 0.16,
                                    ease: EASE
                                }}
                            >
                                {resolveEmpty(renderEmpty)}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>

                    <ol className="message-list" role="list">
                        <AnimatePresence initial={false}>
                            {decoratedMessages.map((message) => (
                                <MessageItem
                                    key={message.id}
                                    message={message}
                                    hiddenMessageId={hiddenMessageId}
                                    itemAnimationMode={itemAnimationMode}
                                />
                            ))}
                        </AnimatePresence>
                    </ol>
                </motion.div>
            </motion.div>
        );
    }

    window.MessageList = MessageList;
})();
