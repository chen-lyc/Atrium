// Defines the root app state machine, auth route syncing, and stage switching logic.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { motion, AnimatePresence } = window;
    const { CHAT_URL, CHAT_RUNTIME_SCRIPTS, EASE, NORMAL_SEND_FLIGHT } = window.AppConstants;
    const { createId, deleteSessionCookie, fetchCurrentUser, hasSessionCookie, loadBabelScripts } = window.AppUtils;
    const useWebSocket = window.useWebSocket;

    const NORMAL_LOGIN_RITUAL = {
        panelCloseMs: 170,
        totalMs: 1520,
        authExit: {
            card: { delay: 0.02, duration: 0.36, y: 8 },
            atmosphere: { delay: 0.16, duration: 0.32, y: 4 },
            chrome: { delay: 0.28, duration: 0.28, y: 4 },
            footer: { delay: 0.38, duration: 0.24, y: 6 }
        },
        chatEnter: {
            sidebar: { delay: 0.34, duration: 0.36, x: -18 },
            header: { delay: 0.5, duration: 0.3, y: -10 },
            composer: { delay: 0.62, duration: 0.3, y: 12 },
            messages: { delay: 0.86, duration: 0.24 }
        }
    };

    const REDUCED_LOGIN_RITUAL = {
        panelCloseMs: 16,
        totalMs: 360,
        authExit: {
            card: { delay: 0, duration: 0.12, y: 0 },
            atmosphere: { delay: 0.04, duration: 0.12, y: 0 },
            chrome: { delay: 0.08, duration: 0.12, y: 0 },
            footer: { delay: 0.12, duration: 0.1, y: 0 }
        },
        chatEnter: {
            sidebar: { delay: 0.08, duration: 0.1, x: 0 },
            header: { delay: 0.14, duration: 0.1, y: 0 },
            composer: { delay: 0.2, duration: 0.1, y: 0 },
            messages: { delay: 0.26, duration: 0.1 }
        }
    };

    const NORMAL_LOGOUT_RITUAL = {
        totalMs: 980,
        authEnter: {
            card: { delay: 0.08, duration: 0.34, y: 0 },
            atmosphere: { delay: 0.18, duration: 0.3, y: 0 },
            chrome: { delay: 0.28, duration: 0.26, y: 8 },
            footer: { delay: 0.38, duration: 0.24, y: 10 }
        },
        chatExit: {
            sidebar: { delay: 0.02, duration: 0.26, x: -12 },
            header: { delay: 0.08, duration: 0.24, y: -6 },
            composer: { delay: 0.12, duration: 0.24, y: 10 },
            messages: { delay: 0.18, duration: 0.24 }
        }
    };

    const REDUCED_LOGOUT_RITUAL = {
        totalMs: 320,
        authEnter: {
            card: { delay: 0.03, duration: 0.1, y: 0 },
            atmosphere: { delay: 0.08, duration: 0.09, y: 0 },
            chrome: { delay: 0.13, duration: 0.08, y: 0 },
            footer: { delay: 0.18, duration: 0.08, y: 0 }
        },
        chatExit: {
            sidebar: { delay: 0, duration: 0.1, x: 0 },
            header: { delay: 0.03, duration: 0.09, y: 0 },
            composer: { delay: 0.06, duration: 0.09, y: 0 },
            messages: { delay: 0.1, duration: 0.08 }
        }
    };
    const SEND_FLIGHT_COOLDOWN_MS = 260;

    function getAuthRoute(pathname = window.location.pathname) {
        const normalizedPath = pathname.replace(/\/+$/, "") || "/";

        if (normalizedPath === "/chat") {
            return { mode: "login", isPanelOpen: true, path: "/chat" };
        }

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
        const launchTimerRef = useRef(null);
        const launchFrameRef = useRef(null);
        const focusFrameRef = useRef(null);
        const authPanelCloseTimerRef = useRef(null);
        const ritualTimerRef = useRef(null);
        const chatRuntimePromiseRef = useRef(null);
        const lastSendFlightAtRef = useRef(0);
        const composerFieldRef = useRef(null);
        const chatMessagesViewportRef = useRef(null);
        const reducedMotion = window.useReducedMotion();
        const prefersReducedMotion =
            reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
        const loginRitualConfig = prefersReducedMotion ? REDUCED_LOGIN_RITUAL : NORMAL_LOGIN_RITUAL;
        const logoutRitualConfig = prefersReducedMotion ? REDUCED_LOGOUT_RITUAL : NORMAL_LOGOUT_RITUAL;

        const [appStage, setAppStage] = useState("loading");
        const [authPanelOpen, setAuthPanelOpen] = useState(false);
        const [authedNickname, setAuthedNickname] = useState("");
        const [authHandoffPending, setAuthHandoffPending] = useState(false);
        const [wsEnabled, setWsEnabled] = useState(false);
        const [localSystemMessages, setLocalSystemMessages] = useState([]);
        const [messageDraft, setMessageDraft] = useState("");
        const [isHeaderScrolled, setHeaderScrolled] = useState(false);
        const [messageFlight, setMessageFlight] = useState(null);
        const [hiddenMessageId, setHiddenMessageId] = useState(null);
        const [sceneTransition, setSceneTransition] = useState(null);
        const [isChatRuntimeReady, setChatRuntimeReady] = useState(Boolean(window.ChatRoom));
        const shouldKeepSocketEnabled =
            Boolean(authedNickname) &&
            (sceneTransition?.kind === "login" ||
                sceneTransition?.kind === "logout" ||
                (appStage === "chat" && sceneTransition?.kind !== "logout"));

        const { messages, connectionState, sendChatMessage } = useWebSocket({
            url: CHAT_URL,
            nickname: authedNickname,
            enabled: shouldKeepSocketEnabled && wsEnabled,
            onAuthFailed: () => {
                clearRitualTimers();
                setSceneTransition(null);
                deleteSessionCookie();
                setAuthedNickname("");
                setWsEnabled(false);
                setAuthHandoffPending(false);
                setLocalSystemMessages([]);
                syncAuthRoute("login", true, { replace: true });
                setMessageDraft("");
                setMessageFlight(null);
                setHiddenMessageId(null);
            }
        });

        function clearRitualTimers() {
            window.clearTimeout(authPanelCloseTimerRef.current);
            window.clearTimeout(ritualTimerRef.current);
            authPanelCloseTimerRef.current = null;
            ritualTimerRef.current = null;

            if (focusFrameRef.current != null) {
                window.cancelAnimationFrame(focusFrameRef.current);
                focusFrameRef.current = null;
            }
        }

        function focusComposerAfterRitual() {
            if (focusFrameRef.current != null) {
                window.cancelAnimationFrame(focusFrameRef.current);
            }

            focusFrameRef.current = window.requestAnimationFrame(() => {
                focusFrameRef.current = window.requestAnimationFrame(() => {
                    const textarea = composerFieldRef.current?.querySelector("textarea");
                    textarea?.focus({ preventScroll: true });
                    focusFrameRef.current = null;
                });
            });
        }

        function installWelcomeMessage(nickname) {
            const resolved = nickname.trim();
            if (!resolved) {
                return;
            }

            setLocalSystemMessages((currentMessages) => {
                if (currentMessages.some((message) => message.source === "local-welcome")) {
                    return currentMessages;
                }

                return [
                    {
                        id: createId("welcome"),
                        nickname: "__system__",
                        text: `欢迎 ${resolved}，加入对话`,
                        timestamp: Date.now(),
                        isSelf: false,
                        status: "sent",
                        source: "local-welcome"
                    }
                ];
            });
        }

        function ensureChatRuntimeLoaded() {
            if (window.ChatRoom) {
                setChatRuntimeReady(true);
                return Promise.resolve();
            }

            if (chatRuntimePromiseRef.current) {
                return chatRuntimePromiseRef.current;
            }

            chatRuntimePromiseRef.current = loadBabelScripts(CHAT_RUNTIME_SCRIPTS)
                .then(() => {
                    setChatRuntimeReady(true);
                    chatRuntimePromiseRef.current = null;
                })
                .catch((error) => {
                    chatRuntimePromiseRef.current = null;
                    throw error;
                });

            return chatRuntimePromiseRef.current;
        }

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
                    const shouldPrepareChatRuntime = hasSessionCookie();
                    const chatRuntimePromise = shouldPrepareChatRuntime
                        ? ensureChatRuntimeLoaded().then(
                            () => true,
                            (error) => {
                                console.error("Failed to preload chat runtime during bootstrap:", error);
                                return false;
                            }
                        )
                        : Promise.resolve(false);
                    const result = await fetchCurrentUser();
                    if (cancelled) {
                        return;
                    }

                    if (result.ok && typeof result.data?.nickname === "string" && result.data.nickname.trim()) {
                        const chatRuntimeReady = await chatRuntimePromise;
                        if (!chatRuntimeReady || !window.ChatRoom) {
                            throw new Error("Chat runtime was not ready after session bootstrap");
                        }
                        if (cancelled) {
                            return;
                        }

                        setAuthedNickname(result.data.nickname.trim());
                        setAuthHandoffPending(false);
                        setLocalSystemMessages([]);
                        setWsEnabled(true);
                        setAuthPanelOpen(false);
                        setAppStage("chat");

                        if (window.location.pathname !== "/chat") {
                            window.history.replaceState({ path: "/chat" }, "", "/chat");
                        }
                        return;
                    }

                    const authRoute = getAuthRoute();
                    setAuthedNickname("");
                    setWsEnabled(false);
                    setAuthHandoffPending(false);
                    setLocalSystemMessages([]);
                    setAppStage(authRoute.mode);
                    setAuthPanelOpen(authRoute.isPanelOpen);

                    if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
                        window.history.replaceState({ path: "/login" }, "", "/login");
                        setAuthPanelOpen(true);
                    }
                } catch (error) {
                    if (cancelled) {
                        return;
                    }

                    const authRoute = getAuthRoute();
                    setAuthedNickname("");
                    setWsEnabled(false);
                    setAuthHandoffPending(false);
                    setLocalSystemMessages([]);
                    setAppStage(authRoute.mode);
                    setAuthPanelOpen(authRoute.isPanelOpen);

                    if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
                        window.history.replaceState({ path: "/login" }, "", "/login");
                        setAuthPanelOpen(true);
                    }
                }
            };

            bootstrap();

            return () => {
                cancelled = true;
            };
        }, []);

        useEffect(() => {
            function handlePopState() {
                if (authedNickname && (appStage === "chat" || sceneTransition?.kind === "login")) {
                    if (window.location.pathname !== "/chat") {
                        window.history.replaceState({ path: "/chat" }, "", "/chat");
                    }
                    return;
                }

                const authRoute = getAuthRoute();
                clearRitualTimers();
                setSceneTransition(null);
                setAuthHandoffPending(false);
                setLocalSystemMessages([]);
                setWsEnabled(false);
                setAppStage(authRoute.mode);
                setAuthPanelOpen(authRoute.isPanelOpen);

                if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
                    window.history.replaceState({ path: "/login" }, "", "/login");
                    setAuthPanelOpen(true);
                }
            }

            window.addEventListener("popstate", handlePopState);
            return () => {
                window.removeEventListener("popstate", handlePopState);
            };
        }, [appStage, authedNickname, sceneTransition]);

        useEffect(() => {
            if (shouldKeepSocketEnabled) {
                setWsEnabled(true);
                return undefined;
            }

            setWsEnabled(false);
            return undefined;
        }, [shouldKeepSocketEnabled]);

        useEffect(() => {
            return () => {
                clearRitualTimers();
                window.clearTimeout(launchTimerRef.current);
                if (launchFrameRef.current != null) {
                    window.cancelAnimationFrame(launchFrameRef.current);
                }
                if (focusFrameRef.current != null) {
                    window.cancelAnimationFrame(focusFrameRef.current);
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
            if (focusFrameRef.current != null) {
                window.cancelAnimationFrame(focusFrameRef.current);
                focusFrameRef.current = null;
            }
        }, [appStage]);

        function beginLoginRitual(nickname, config) {
            const resolved = nickname.trim();
            setAuthedNickname(resolved);
            setLocalSystemMessages([]);
            setMessageDraft("");
            setMessageFlight(null);
            setHiddenMessageId(null);
            setHeaderScrolled(false);
            setWsEnabled(true);
            setAuthPanelOpen(false);
            setSceneTransition({
                kind: "login",
                config
            });

            if (window.location.pathname !== "/chat") {
                window.history.replaceState({ path: "/chat" }, "", "/chat");
            }

            ritualTimerRef.current = window.setTimeout(() => {
                installWelcomeMessage(resolved);
                setAuthHandoffPending(false);
                setSceneTransition(null);
                setAppStage("chat");
                focusComposerAfterRitual();
            }, config.totalMs);
        }

        function handleAuthSuccess(nickname) {
            const resolved = nickname.trim();
            if (!resolved) {
                return;
            }

            clearRitualTimers();
            setAuthHandoffPending(true);

            ensureChatRuntimeLoaded()
                .then(() => {
                    setAuthPanelOpen(false);

                    authPanelCloseTimerRef.current = window.setTimeout(() => {
                        beginLoginRitual(resolved, loginRitualConfig);
                    }, loginRitualConfig.panelCloseMs);
                })
                .catch((error) => {
                    console.error("Failed to load chat runtime:", error);
                    setAuthHandoffPending(false);
                });
        }

        function handleLogout() {
            // TODO: 后端添加 /logout 接口并删除服务端 session 后，改为调接口
            clearRitualTimers();
            deleteSessionCookie();
            setAuthHandoffPending(false);
            setMessageFlight(null);
            setHiddenMessageId(null);
            setAuthPanelOpen(true);
            setSceneTransition({
                kind: "logout",
                authMode: "login",
                config: logoutRitualConfig
            });

            if (window.location.pathname !== "/login") {
                window.history.replaceState({ path: "/login" }, "", "/login");
            }

            ritualTimerRef.current = window.setTimeout(() => {
                setSceneTransition(null);
                setWsEnabled(false);
                setAuthedNickname("");
                setLocalSystemMessages([]);
                setMessageDraft("");
                setMessageFlight(null);
                setHiddenMessageId(null);
                setHeaderScrolled(false);
                setAppStage("login");
                setAuthPanelOpen(true);
            }, logoutRitualConfig.totalMs);
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
                const now = window.performance?.now?.() ?? Date.now();
                const shouldAnimateFlight =
                    Boolean(composerRect) &&
                    !messageFlight &&
                    hiddenMessageId == null &&
                    now - lastSendFlightAtRef.current >= SEND_FLIGHT_COOLDOWN_MS;

                setMessageDraft("");

                if (!shouldAnimateFlight) {
                    return;
                }

                lastSendFlightAtRef.current = now;
                setMessageFlight({
                    id: sentMessage.id,
                    text: trimmedMessage,
                    transition: NORMAL_SEND_FLIGHT,
                    startRect: {
                        left: composerRect.left,
                        top: composerRect.top + 6,
                        width: Math.max(120, composerRect.width - 16)
                    },
                    targetRect: null
                });
                setHiddenMessageId(sentMessage.id);

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

        const isLoginTransition = sceneTransition?.kind === "login";
        const isLogoutTransition = sceneTransition?.kind === "logout";
        const isSceneTransitioning = Boolean(sceneTransition);
        const showAuthStage =
            appStage === "login" || appStage === "register" || isLoginTransition || isLogoutTransition;
        const showChatStage = appStage === "chat" || isLoginTransition || isLogoutTransition;
        const currentAuthMode =
            isLogoutTransition
                ? sceneTransition.authMode || "login"
                : appStage === "register"
                    ? "register"
                    : "login";
        const authTransitionMode = isLoginTransition ? "exit-to-chat" : isLogoutTransition ? "enter-from-chat" : "idle";
        const chatTransitionMode = isLoginTransition ? "enter-from-auth" : isLogoutTransition ? "exit-to-auth" : "idle";
        const displayMessages = isLoginTransition ? [] : [...localSystemMessages, ...messages];
        const ChatRoom = window.ChatRoom;

        return (
            <>
                <AnimatePresence initial={false}>
                    {appStage === "loading" ? (
                        <LoadingStage key="loading" />
                    ) : null}

                    {showAuthStage ? (
                        <AuthShell
                            key="auth"
                            mode={currentAuthMode}
                            isPanelOpen={authPanelOpen}
                            onOpenMode={(nextMode) => syncAuthRoute(nextMode, true)}
                            onClosePanel={() => syncAuthRoute("login", false)}
                            onNavigateHome={() => syncAuthRoute("login", false)}
                            onSuccess={handleAuthSuccess}
                            disabled={authHandoffPending || isSceneTransitioning}
                            isHandoffPending={authHandoffPending}
                            transitionMode={authTransitionMode}
                            transitionConfig={
                                isLoginTransition
                                    ? sceneTransition.config.authExit
                                    : isLogoutTransition
                                        ? sceneTransition.config.authEnter
                                        : null
                            }
                        />
                    ) : null}

                    {showChatStage && isChatRuntimeReady && ChatRoom ? (
                        <motion.div
                            key="chat-stage"
                            className={`chat-stage ${
                                isLoginTransition
                                    ? "is-entering-from-auth"
                                    : isLogoutTransition
                                        ? "is-exiting-to-auth"
                                        : "is-live"
                            }`}
                            initial={isSceneTransitioning ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: isSceneTransitioning ? 0.2 : 0.3, ease: EASE }}
                        >
                            <ChatRoom
                                nickname={authedNickname}
                                connectionState={connectionState}
                                messages={displayMessages}
                                isHeaderScrolled={isHeaderScrolled}
                                onScrolled={setHeaderScrolled}
                                messageDraft={messageDraft}
                                onMessageDraftChange={setMessageDraft}
                                onSend={handleSend}
                                composerFieldRef={composerFieldRef}
                                messagesViewportRef={chatMessagesViewportRef}
                                hiddenMessageId={hiddenMessageId}
                                messageFlight={messageFlight}
                                onMessageFlightComplete={completeMessageFlight}
                                onLogout={handleLogout}
                                transitionMode={chatTransitionMode}
                                transitionConfig={
                                    isLoginTransition
                                        ? sceneTransition.config.chatEnter
                                        : isLogoutTransition
                                            ? sceneTransition.config.chatExit
                                            : null
                                }
                                hideMessageContent={isLoginTransition}
                                readOnly={isSceneTransitioning}
                            />
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </>
        );
    }

    window.App = App;
})();
