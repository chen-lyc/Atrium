// Defines shared utility helpers for messages, auth, and session state.
(() => {
    function createId(prefix = "msg") {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return `${prefix}-${window.crypto.randomUUID()}`;
        }
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function getTimestampValue(timestamp) {
        const value = new Date(timestamp).getTime();
        return Number.isNaN(value) ? Date.now() : value;
    }

    function formatDividerTime(timestamp, full) {
        return new Intl.DateTimeFormat(
            "zh-CN",
            full
                ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
                : { hour: "2-digit", minute: "2-digit" }
        ).format(new Date(getTimestampValue(timestamp)));
    }

    function formatMessageTime(timestamp) {
        return new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(getTimestampValue(timestamp)));
    }

    function getIncomingText(payload) {
        if (typeof payload.text === "string") {
            return payload.text;
        }
        if (typeof payload.message === "string") {
            return payload.message;
        }
        if (typeof payload.content === "string") {
            return payload.content;
        }
        return "";
    }

    function normalizeIncomingMessage(payload, currentUsername) {
        const normalizedNickname =
            typeof payload.nickname === "string" && payload.nickname.trim()
                ? payload.nickname.trim()
                : "匿名用户";

        return {
            id: payload.id || createId("remote"),
            clientMessageId:
                typeof payload.clientMessageId === "string"
                    ? payload.clientMessageId
                    : typeof payload.client_message_id === "string"
                        ? payload.client_message_id
                        : "",
            nickname: normalizedNickname,
            text: getIncomingText(payload),
            timestamp: payload.timestamp || Date.now(),
            isSelf: Boolean(currentUsername && normalizedNickname === currentUsername),
            status: payload.status || "sent",
            source: "server"
        };
    }

    function findPendingLocalMatch(prevMessages, incomingMessage) {
        const exactIdMatch = [...prevMessages]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find(({ message }) => {
                if (!message.isSelf || message.source !== "local") {
                    return false;
                }

                if (!message.clientMessageId || !incomingMessage.clientMessageId) {
                    return false;
                }

                return message.clientMessageId === incomingMessage.clientMessageId;
            })?.index;

        if (exactIdMatch != null) {
            return exactIdMatch;
        }

        return [...prevMessages]
            .map((message, index) => ({ message, index }))
            .reverse()
            .find(({ message }) => {
                if (!message.isSelf || message.source !== "local") {
                    return false;
                }

                if (message.nickname !== incomingMessage.nickname || message.text !== incomingMessage.text) {
                    return false;
                }

                const timeGap = Math.abs(
                    getTimestampValue(incomingMessage.timestamp) - getTimestampValue(message.timestamp)
                );

                return timeGap <= 30000;
            })?.index;
    }

    function mergeIncomingMessage(prevMessages, incomingMessage) {
        if (!incomingMessage.isSelf) {
            return [...prevMessages, incomingMessage];
        }

        const matchIndex = findPendingLocalMatch(prevMessages, incomingMessage);

        if (matchIndex == null) {
            return [...prevMessages, incomingMessage];
        }

        return prevMessages.map((message, index) => {
            if (index !== matchIndex) {
                return message;
            }

            return {
                ...message,
                ...incomingMessage,
                id: message.id,
                serverId: incomingMessage.id,
                clientMessageId: incomingMessage.clientMessageId || message.clientMessageId || "",
                status: incomingMessage.status === "failed" ? "failed" : "sent",
                source: "server"
            };
        });
    }

    function decorateMessages(messages) {
        return messages.map((message, index) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const currentTime = getTimestampValue(message.timestamp);
            const previousTime = prev ? getTimestampValue(prev.timestamp) : null;
            const diffMinutes = previousTime == null ? Infinity : Math.abs(currentTime - previousTime) / 60000;
            const groupedWithPrev = Boolean(prev && prev.nickname === message.nickname && diffMinutes <= 2);
            const showAuthor = !groupedWithPrev;
            const showDivider = index === 0 || diffMinutes > 5;

            return {
                ...message,
                groupedWithPrev,
                showAuthor,
                showDivider,
                timeLabel: formatMessageTime(message.timestamp),
                dividerLabel: formatDividerTime(message.timestamp, index === 0)
            };
        });
    }

    function deleteSessionCookie() {
        document.cookie = "session_id=; Max-Age=0; Path=/";
    }

    async function fetchCurrentUser() {
        const res = await fetch("/me", {
            method: "GET",
            credentials: "include"
        });

        if (!res.ok) {
            return { ok: false, status: res.status, data: null };
        }

        const data = await res.json().catch(() => ({}));
        return { ok: true, status: res.status, data };
    }

    function buildAuthBody(username, password) {
        const body = new URLSearchParams();
        body.append("username", username);
        body.append("password", password);
        return body.toString();
    }

    window.AppUtils = {
        createId,
        getTimestampValue,
        formatDividerTime,
        formatMessageTime,
        getIncomingText,
        normalizeIncomingMessage,
        findPendingLocalMatch,
        mergeIncomingMessage,
        decorateMessages,
        deleteSessionCookie,
        fetchCurrentUser,
        buildAuthBody
    };
})();
