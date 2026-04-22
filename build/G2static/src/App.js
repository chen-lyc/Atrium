// Defines the root app state machine, auth route syncing, and stage switching logic.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { LayoutGroup, AnimatePresence } = window;
    const { CHAT_URL, NORMAL_SEND_SPRING } = window.AppConstants;
    const { deleteSessionCookie, fetchCurrentUser } = window.AppUtils;
    const useWebSocket = window.useWebSocket;

    function getAuthRoute(pathname = window.location.pathname) {
        const normalizedPath = pathname.replace(/\/+$/, "") || "/";

        if (normalizedPath === "/register") {
            return { mode: "register", isPanelOpen: true, path: "/register" };
        }

        if (normalizedPath === "/login") {
            return { mode: "login", isPanelOpen: true, path: "/login" };
        }

        return { mode: "login", isPanelOpen: false, path: "/" };
    }

    function App() {
        const LoadingStage = window.LoadingStage;
        const AuthShell = window.AuthShell;
        const ChatRoom = window.ChatRoom;
        const launchTimerRef = useRef(null);
        const launchFrameRef = useRef(null);
        const entryConnectTimerRef = useRef(null);
        const composerFieldRef = useRef(null);

        const [appStage, setAppStage] = useState("loading");
        const [authPanelOpen, setAuthPanelOpen] = useState(false);
        const [authedUsername, setAuthedUsername] = useState("");
        const [shouldPlayEntryRitual, setShouldPlayEntryRitual] = useState(false);
        const [wsEnabled, setWsEnabled] = useState(false);
        const [messageDraft, setMessageDraft] = useState("");
        const [isHeaderScrolled, setHeaderScrolled] = useState(false);
        const [messageFlight, setMessageFlight] = useState(null);
        const [hiddenMessageId, setHiddenMessageId] = useState(null);

        const { messages, connectionState, sendChatMessage } = useWebSocket({
            url: CHAT_URL,
            username: authedUsername,
            enabled: appStage === "chat" && wsEnabled && Boolean(authedUsername),
            onAuthFailed: () => {
                deleteSessionCookie();
                setAuthedUsername("");
                setWsEnabled(false);
                setShouldPlayEntryRitual(false);
                syncAuthRoute("login", true, { replace: true });
                setMessageDraft("");
                setMessageFlight(null);
                setHiddenMessageId(null);
            }
        });

        function syncAuthRoute(mode, isPanelVisible, { replace = false } = {}) {
            const resolvedMode = mode === "register" ? "register" : "login";
            const panelVisible = Boolean(isPanelVisible);
            const nextPath = panelVisible ? `/${resolvedMode}` : "/";

            setAppStage(resolvedMode);
            setAuthPanelOpen(panelVisible);

            if (window.location.pathname !== nextPath) {
                const method = replace ? "replaceState" : "pushState";
                window.history[method]({ path: nextPath }, "", nextPath);
            }
        }

        useEffect(() => {
            let cancelled = false;

            const bootstrap = async () => {
                try {
                    const result = await fetchCurrentUser();
                    if (cancelled) {
                        return;
                    }

                    if (result.ok && typeof result.data?.username === "string" && result.data.username.trim()) {
                        setAuthedUsername(result.data.username.trim());
                        setShouldPlayEntryRitual(false);
                        setWsEnabled(true);
                        setAuthPanelOpen(false);
                        setAppStage("chat");

                        if (window.location.pathname !== "/") {
                            window.history.replaceState({ path: "/" }, "", "/");
                        }
                        return;
                    }

                    const authRoute = getAuthRoute();
                    setAuthedUsername("");
                    setWsEnabled(false);
                    setShouldPlayEntryRitual(false);
                    setAppStage(authRoute.mode);
                    setAuthPanelOpen(authRoute.isPanelOpen);
                } catch (error) {
                    if (cancelled) {
                        return;
                    }

                    const authRoute = getAuthRoute();
                    setAuthedUsername("");
                    setWsEnabled(false);
                    setShouldPlayEntryRitual(false);
                    setAppStage(authRoute.mode);
                    setAuthPanelOpen(authRoute.isPanelOpen);
                }
            };

            bootstrap();

            return () => {
                cancelled = true;
            };
        }, []);

        useEffect(() => {
            function handlePopState() {
                if (authedUsername && appStage === "chat") {
                    if (window.location.pathname !== "/") {
                        window.history.replaceState({ path: "/" }, "", "/");
                    }
                    return;
                }

                const authRoute = getAuthRoute();
                setShouldPlayEntryRitual(false);
                setWsEnabled(false);
                setAppStage(authRoute.mode);
                setAuthPanelOpen(authRoute.isPanelOpen);
            }

            window.addEventListener("popstate", handlePopState);
            return () => {
                window.removeEventListener("popstate", handlePopState);
            };
        }, [appStage, authedUsername]);

        useEffect(() => {
            window.clearTimeout(entryConnectTimerRef.current);

            if (appStage !== "chat" || !authedUsername) {
                setWsEnabled(false);
                return undefined;
            }

            if (!shouldPlayEntryRitual) {
                setWsEnabled(true);
                return undefined;
            }

            setWsEnabled(false);
            entryConnectTimerRef.current = window.setTimeout(() => {
                setWsEnabled(true);
            }, 900);

            return () => {
                window.clearTimeout(entryConnectTimerRef.current);
            };
        }, [appStage, authedUsername, shouldPlayEntryRitual]);

        useEffect(() => {
            return () => {
                window.clearTimeout(launchTimerRef.current);
                window.clearTimeout(entryConnectTimerRef.current);
                if (launchFrameRef.current != null) {
                    window.cancelAnimationFrame(launchFrameRef.current);
                }
            };
        }, []);

        useEffect(() => {
            if (appStage === "chat") {
                return;
            }

            setMessageDraft("");
            setMessageFlight(null);
            setHiddenMessageId(null);
            setHeaderScrolled(false);
        }, [appStage]);

        function enterChatWith(username) {
            const resolved = username.trim();
            setAuthedUsername(resolved);
            setMessageDraft("");
            setMessageFlight(null);
            setHiddenMessageId(null);
            setHeaderScrolled(false);
            setShouldPlayEntryRitual(true);
            setWsEnabled(false);
            setAuthPanelOpen(false);
            setAppStage("chat");

            if (window.location.pathname !== "/") {
                window.history.replaceState({ path: "/" }, "", "/");
            }
        }

        function handleAuthSuccess(username) {
            const resolved = username.trim();
            if (!resolved) {
                return;
            }

            enterChatWith(resolved);
        }

        function handleLogout() {
            // TODO: 后端添加 /logout 接口并删除服务端 session 后，改为调接口
            deleteSessionCookie();
            setAuthedUsername("");
            setWsEnabled(false);
            setShouldPlayEntryRitual(false);
            syncAuthRoute("login", true, { replace: true });
            setMessageDraft("");
            setMessageFlight(null);
            setHiddenMessageId(null);
        }

        function completeMessageFlight(messageId) {
            setHiddenMessageId((currentId) => (currentId === messageId ? null : currentId));
            setMessageFlight((currentFlight) => (currentFlight && currentFlight.id === messageId ? null : currentFlight));
        }

        function handleSend() {
            const trimmedMessage = messageDraft.trim();
            if (!trimmedMessage) {
                return;
            }

            const sentMessage = sendChatMessage(trimmedMessage);
            if (sentMessage) {
                const composerField = composerFieldRef.current;
                const composerRect = composerField?.getBoundingClientRect();

                if (!composerRect) {
                    setMessageDraft("");
                    return;
                }

                setMessageFlight({
                    id: sentMessage.id,
                    text: trimmedMessage,
                    spring: NORMAL_SEND_SPRING,
                    startRect: {
                        left: composerRect.left,
                        top: composerRect.top + 6,
                        width: Math.max(120, composerRect.width - 16)
                    },
                    targetRect: null
                });
                setHiddenMessageId(sentMessage.id);
                setMessageDraft("");

                if (launchFrameRef.current != null) {
                    window.cancelAnimationFrame(launchFrameRef.current);
                }

                launchFrameRef.current = window.requestAnimationFrame(() => {
                    launchFrameRef.current = window.requestAnimationFrame(() => {
                        const targetElement = document.querySelector(
                            `[data-message-id="${sentMessage.id}"] .message-text-shell`
                        );

                        if (!targetElement) {
                            completeMessageFlight(sentMessage.id);
                            launchFrameRef.current = null;
                            return;
                        }

                        const targetRect = targetElement.getBoundingClientRect();
                        setMessageFlight((currentFlight) =>
                            currentFlight && currentFlight.id === sentMessage.id
                                ? {
                                    ...currentFlight,
                                    targetRect: {
                                        left: targetRect.left,
                                        top: targetRect.top,
                                        width: targetRect.width
                                    }
                                }
                                : currentFlight
                        );
                        launchFrameRef.current = null;
                    });
                });

                window.clearTimeout(launchTimerRef.current);
                launchTimerRef.current = window.setTimeout(() => {
                    completeMessageFlight(sentMessage.id);
                }, 1400);
            }
        }

        return (
            <LayoutGroup id="app-layout">
                <AnimatePresence mode="wait" initial={false}>
                    {appStage === "loading" ? (
                        <LoadingStage key="loading" />
                    ) : null}

                    {appStage === "login" || appStage === "register" ? (
                        <AuthShell
                            key="auth"
                            mode={appStage}
                            isPanelOpen={authPanelOpen}
                            onOpenMode={(nextMode) => syncAuthRoute(nextMode, true)}
                            onClosePanel={() => syncAuthRoute("login", false)}
                            onNavigateHome={() => syncAuthRoute("login", false)}
                            onSuccess={handleAuthSuccess}
                            disabled={false}
                        />
                    ) : null}

                    {appStage === "chat" ? (
                        <ChatRoom
                            key="chat"
                            username={authedUsername}
                            connectionState={connectionState}
                            messages={messages}
                            isHeaderScrolled={isHeaderScrolled}
                            onScrolled={setHeaderScrolled}
                            messageDraft={messageDraft}
                            onMessageDraftChange={setMessageDraft}
                            onSend={handleSend}
                            composerFieldRef={composerFieldRef}
                            hiddenMessageId={hiddenMessageId}
                            messageFlight={messageFlight}
                            onMessageFlightComplete={completeMessageFlight}
                            onLogout={handleLogout}
                            playEntryRitual={shouldPlayEntryRitual}
                        />
                    ) : null}
                </AnimatePresence>
            </LayoutGroup>
        );
    }

    window.App = App;
})();
