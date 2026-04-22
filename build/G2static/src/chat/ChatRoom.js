// Composes the full chat room shell from the sidebar, header, list, and composer.
(() => {
    const { motion } = window;
    const { EASE } = window.AppConstants;

    function ChatRoom({
        username,
        connectionState,
        messages,
        isHeaderScrolled,
        onScrolled,
        messageDraft,
        onMessageDraftChange,
        onSend,
        composerFieldRef,
        hiddenMessageId,
        messageFlight,
        onMessageFlightComplete,
        onLogout,
        playEntryRitual,
        roomName = "/chat",
        readOnly = false,
        suppressConnectionPulse = false,
        isFading = false,
        fadeDuration = 600
    }) {
        const Sidebar = window.Sidebar;
        const ConnectionStatus = window.ConnectionStatus;
        const MessageList = window.MessageList;
        const MessageInput = window.MessageInput;
        const MessageFlight = window.MessageFlight;
        const composerDisabled = readOnly ? false : !messageDraft.trim() || connectionState !== "connected";
        const entryDelays = playEntryRitual
            ? { sidebar: 0.02, header: 0.12, messages: 0.22, composer: 0.32 }
            : { sidebar: 0, header: 0, messages: 0, composer: 0 };

        return (
            <div className="shell">
                <Sidebar
                    username={username}
                    onLogout={onLogout}
                    shouldAnimateEntry={playEntryRitual}
                    entryDelay={entryDelays.sidebar}
                    readOnly={readOnly}
                    roomName={roomName}
                />

                <main className="main">
                    <motion.header
                        className={`header ${isHeaderScrolled ? "is-scrolled" : ""}`}
                        initial={false}
                    >
                        <motion.div
                            className="header-inner"
                            initial={playEntryRitual ? { y: -12, opacity: 0 } : false}
                            animate={{ y: 0, opacity: 1 }}
                            transition={
                                playEntryRitual
                                    ? { delay: entryDelays.header, duration: 0.28, ease: EASE }
                                    : { duration: 0.18, ease: EASE }
                            }
                        >
                            <div className="room-name">{roomName}</div>
                            <ConnectionStatus state={connectionState} allowPulse={!suppressConnectionPulse} />
                        </motion.div>
                    </motion.header>

                    <MessageList
                        messages={messages}
                        onScrolled={onScrolled}
                        hiddenMessageId={hiddenMessageId}
                        suspendSmoothScroll={Boolean(messageFlight)}
                        shouldAnimateEntry={playEntryRitual}
                        entryDelay={entryDelays.messages}
                        isFading={isFading}
                        fadeDuration={fadeDuration}
                    />

                    <MessageInput
                        value={messageDraft}
                        onChange={onMessageDraftChange}
                        onSend={onSend}
                        disabled={composerDisabled}
                        composerFieldRef={composerFieldRef}
                        shouldAnimateEntry={playEntryRitual}
                        entryDelay={entryDelays.composer}
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
