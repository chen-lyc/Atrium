// Defines the shared WebSocket hook used by the chat runtime.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { LOCAL_SEND_SETTLE_DELAY } = window.AppConstants;
    const {
        createId,
        fetchCurrentUser,
        hasSessionCookie,
        normalizeIncomingMessage,
        findPendingLocalMatch,
        mergeIncomingMessage
    } = window.AppUtils;

    function useWebSocket({ url, nickname, enabled, onAuthFailed }) {
        const socketRef = useRef(null);
        const reconnectTimerRef = useRef(null);
        const reconnectAttemptRef = useRef(0);
        const pendingResolveTimersRef = useRef(new Map());
        const authFailedRef = useRef(onAuthFailed);

        const [messages, setMessages] = useState([]);
        const [connectionState, setConnectionState] = useState(enabled ? "connecting" : "idle");
        const [reconnectAttempt, setReconnectAttempt] = useState(0);
        const [lastError, setLastError] = useState("");

        useEffect(() => {
            authFailedRef.current = onAuthFailed;
        }, [onAuthFailed]);

        function clearAllPendingTimers() {
            pendingResolveTimersRef.current.forEach((timerId) => {
                window.clearTimeout(timerId);
            });
            pendingResolveTimersRef.current.clear();
        }

        function clearPendingResolveTimer(messageId) {
            const timerId = pendingResolveTimersRef.current.get(messageId);
            if (timerId == null) {
                return;
            }

            window.clearTimeout(timerId);
            pendingResolveTimersRef.current.delete(messageId);
        }

        function schedulePendingResolve(messageId) {
            clearPendingResolveTimer(messageId);

            const timerId = window.setTimeout(() => {
                pendingResolveTimersRef.current.delete(messageId);
                setMessages((prev) =>
                    prev.map((message) =>
                        message.id === messageId && message.status === "pending"
                            ? { ...message, status: "sent" }
                            : message
                    )
                );
            }, LOCAL_SEND_SETTLE_DELAY);

            pendingResolveTimersRef.current.set(messageId, timerId);
        }

        function markLocalMessageFailed(messageId) {
            clearPendingResolveTimer(messageId);
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === messageId
                        ? { ...message, status: "failed" }
                        : message
                )
            );
        }

        function cleanupSocket() {
            const current = socketRef.current;
            socketRef.current = null;
            if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
                current.close();
            }
        }

        useEffect(() => {
            clearAllPendingTimers();
            setMessages([]);
            setLastError("");
            reconnectAttemptRef.current = 0;
            setReconnectAttempt(0);
            if (!nickname) {
                setConnectionState("idle");
            }
        }, [nickname]);

        useEffect(() => {
            if (!enabled || !nickname) {
                window.clearTimeout(reconnectTimerRef.current);
                cleanupSocket();
                setConnectionState("idle");
                return undefined;
            }

            let cancelled = false;

            const scheduleReconnect = () => {
                if (cancelled) {
                    return;
                }

                const nextAttempt = reconnectAttemptRef.current + 1;
                reconnectAttemptRef.current = nextAttempt;
                setReconnectAttempt(nextAttempt);
                setConnectionState("reconnecting");

                const delay = Math.min(1200 + nextAttempt * 900, 6400);
                window.clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = window.setTimeout(() => {
                    openSocket();
                }, delay);
            };

            const openSocket = () => {
                if (cancelled) {
                    return;
                }

                let opened = false;
                setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

                try {
                    const ws = new WebSocket(url);
                    socketRef.current = ws;

                    ws.onopen = () => {
                        if (cancelled) {
                            return;
                        }
                        opened = true;
                        reconnectAttemptRef.current = 0;
                        setReconnectAttempt(0);
                        setConnectionState("connected");
                        setLastError("");
                    };

                    ws.onmessage = async (event) => {
                        if (cancelled) {
                            return;
                        }

                        try {
                            const rawData =
                                typeof event.data === "string"
                                    ? event.data
                                    : event.data instanceof Blob
                                        ? await event.data.text()
                                        : String(event.data);

                            if (cancelled) {
                                return;
                            }

                            const payload = JSON.parse(rawData);
                            const nextMessage = normalizeIncomingMessage(payload, nickname);
                            setMessages((prev) => {
                                if (nextMessage.isSelf) {
                                    const matchIndex = findPendingLocalMatch(prev, nextMessage);
                                    if (matchIndex != null) {
                                        clearPendingResolveTimer(prev[matchIndex].id);
                                    }
                                }

                                return mergeIncomingMessage(prev, nextMessage);
                            });
                        } catch (error) {
                            console.warn("Invalid message payload:", error);
                        }
                    };

                    ws.onerror = () => {
                        if (cancelled) {
                            return;
                        }
                        setLastError("连接过程中发生错误");
                    };

                    ws.onclose = (event) => {
                        if (cancelled) {
                            return;
                        }

                        socketRef.current = null;

                        if (!opened) {
                            setConnectionState("idle");
                            if (!hasSessionCookie()) {
                                authFailedRef.current?.();
                                return;
                            }

                            fetchCurrentUser()
                                .then((result) => {
                                    if (cancelled) {
                                        return;
                                    }

                                    if (result.ok) {
                                        scheduleReconnect();
                                        return;
                                    }

                                    authFailedRef.current?.();
                                })
                                .catch(() => {
                                    if (!cancelled) {
                                        scheduleReconnect();
                                    }
                                });
                            return;
                        }

                        setConnectionState("disconnected");
                        scheduleReconnect();
                    };
                } catch (error) {
                    setLastError("浏览器无法建立 WebSocket 连接");
                    scheduleReconnect();
                }
            };

            openSocket();

            return () => {
                cancelled = true;
                window.clearTimeout(reconnectTimerRef.current);
                clearAllPendingTimers();
                cleanupSocket();
            };
        }, [url, nickname, enabled]);

        function sendChatMessage(text) {
            const content = text.trim();
            const current = socketRef.current;

            if (!content || !nickname || !current || current.readyState !== WebSocket.OPEN) {
                return null;
            }

            const localMessage = {
                id: createId("local"),
                clientMessageId: createId("client"),
                nickname,
                text: content,
                timestamp: Date.now(),
                isSelf: true,
                status: "pending",
                source: "local"
            };

            setMessages((prev) => [...prev, localMessage]);

            try {
                current.send(JSON.stringify({ text: content }));
                schedulePendingResolve(localMessage.id);
                return localMessage;
            } catch (error) {
                const failedMessage = { ...localMessage, status: "failed" };
                markLocalMessageFailed(localMessage.id);
                setLastError("消息发送失败");
                return failedMessage;
            }
        }

        return {
            messages,
            connectionState,
            reconnectAttempt,
            lastError,
            sendChatMessage
        };
    }

    window.useWebSocket = useWebSocket;
})();
