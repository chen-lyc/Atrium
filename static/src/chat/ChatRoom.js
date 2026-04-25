// Composes the full chat room shell from the sidebar, header, list, and composer.
(() => {
    const { motion } = window;
    const { EASE } = window.AppConstants;

    function ChatRoom({
        nickname,
        connectionState,
        messages,
        isHeaderScrolled,
        onScrolled,
        messageDraft,
        onMessageDraftChange,
        onSend,
        composerFieldRef,
        messagesViewportRef,
        hiddenMessageId,
        messageFlight,
        onMessageFlightComplete,
        onLogout,
        roomName = "/chat",
        readOnly = false,
        suppressConnectionPulse = false,
        isFading = false,
        fadeDuration = 600,
        transitionMode = "idle",
        transitionConfig = null,
        hideMessageContent = false
    }) {
        const Sidebar = window.Sidebar;
        const ConnectionStatus = window.ConnectionStatus;
        const MessageList = window.MessageList;
        const MessageInput = window.MessageInput;
        const MessageFlight = window.MessageFlight;
        const reducedMotion = window.useReducedMotion();
        const composerDisabled = readOnly ? false : !messageDraft.trim() || connectionState !== "connected";
        const resolvedTransitionMode =
            transitionMode === "enter-from-auth" ? "enter" : transitionMode === "exit-to-auth" ? "exit" : "idle";
        const visibleMessages = hideMessageContent ? [] : messages;

        function resolveSectionMotion(timing) {
            if (resolvedTransitionMode === "enter" && timing) {
                return {
                    initial: {
                        opacity: 0,
                        x: reducedMotion ? 0 : timing.x || 0,
                        y: reducedMotion ? 0 : timing.y || 0
                    },
                    animate: { opacity: 1, x: 0, y: 0 },
                    transition: { delay: timing.delay || 0, duration: timing.duration || 0.24, ease: EASE }
                };
            }

            if (resolvedTransitionMode === "exit" && timing) {
                return {
                    initial: false,
                    animate: {
                        opacity: 0,
                        x: reducedMotion ? 0 : timing.x || 0,
                        y: reducedMotion ? 0 : timing.y || 0
                    },
                    transition: { delay: timing.delay || 0, duration: timing.duration || 0.2, ease: EASE }
                };
            }

            return {
                initial: false,
                animate: { opacity: 1, x: 0, y: 0 },
                transition: { duration: 0.18, ease: EASE }
            };
        }

        const headerMotion = resolveSectionMotion(transitionConfig?.header);
        const messagesMotion = resolveSectionMotion(transitionConfig?.messages);

        return (
            <div className="shell">
                <Sidebar
                    nickname={nickname}
                    onLogout={onLogout}
                    shouldAnimateEntry={false}
                    transitionMode={resolvedTransitionMode}
                    motionTiming={transitionConfig?.sidebar}
                    readOnly={readOnly}
                    roomName={roomName}
                />

                <main className="main">
                    <motion.header
                        className={`header ${isHeaderScrolled ? "is-scrolled" : ""}`}
                        initial={headerMotion.initial}
                        animate={headerMotion.animate}
                        transition={headerMotion.transition}
                    >
                        <div className="header-inner">
                            <div className="room-name">{roomName}</div>
                            <ConnectionStatus state={connectionState} allowPulse={!suppressConnectionPulse} />
                        </div>
                    </motion.header>

                    <motion.div
                        className="messages-stage"
                        initial={messagesMotion.initial}
                        animate={messagesMotion.animate}
                        transition={messagesMotion.transition}
                    >
                        <MessageList
                            messages={visibleMessages}
                            onScrolled={onScrolled}
                            hiddenMessageId={hiddenMessageId}
                            shouldAnimateEntry={false}
                            itemAnimationMode="calm"
                            isFading={isFading}
                            fadeDuration={fadeDuration}
                            viewportRef={messagesViewportRef}
                            renderEmpty={hideMessageContent ? () => null : undefined}
                        />
                    </motion.div>

                    <MessageInput
                        value={messageDraft}
                        onChange={onMessageDraftChange}
                        onSend={onSend}
                        disabled={composerDisabled}
                        composerFieldRef={composerFieldRef}
                        shouldAnimateEntry={false}
                        transitionMode={resolvedTransitionMode}
                        motionTiming={transitionConfig?.composer}
                        readOnly={readOnly}
                    />
                </main>

                {readOnly ? null : (
                    <MessageFlight
                        flight={messageFlight}
                        onComplete={onMessageFlightComplete}
                    />
                )}
            </div>
        );
    }

    window.ChatRoom = ChatRoom;
})();
