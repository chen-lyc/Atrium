// Defines shared utility helpers for messages, auth, and session state.
(() => {
    const babelScriptLoads = new Map();

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

    function normalizeIncomingUserId(payload) {
        if (typeof payload.user_id === "number" && Number.isFinite(payload.user_id)) {
            return String(payload.user_id);
        }

        if (typeof payload.user_id === "string" && payload.user_id.trim()) {
            return payload.user_id.trim();
        }

        return "";
    }

    function normalizeIncomingConversationId(payload) {
        const value =
            payload.conversation_id != null
                ? payload.conversation_id
                : payload.conversationId;
        const numericValue = Number(value);

        return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
    }

    function normalizeIncomingMessage(payload, currentNickname) {
        const normalizedUsername =
            typeof payload.username === "string" && payload.username.trim()
                ? payload.username.trim()
                : "";
        const normalizedNickname =
            normalizedUsername ||
            (typeof payload.nickname === "string" && payload.nickname.trim()
                ? payload.nickname.trim()
                : "匿名用户");

        return {
            id: payload.id || createId("remote"),
            clientMessageId:
                typeof payload.clientMessageId === "string"
                    ? payload.clientMessageId
                    : typeof payload.client_message_id === "string"
                        ? payload.client_message_id
                        : "",
            userId: normalizeIncomingUserId(payload),
            username: normalizedUsername,
            nickname: normalizedNickname,
            conversationId: normalizeIncomingConversationId(payload),
            text: getIncomingText(payload),
            timestamp: payload.timestamp || Date.now(),
            isSelf: Boolean(currentNickname && normalizedNickname === currentNickname),
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
        deleteCookie("session_id");
        deleteCookie("conversation_id");
    }

    function deleteCookie(name) {
        document.cookie = `${name}=; Max-Age=0; Path=/`;
    }

    function getCookieValue(name) {
        const prefix = `${name}=`;
        const rawValue = document.cookie
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith(prefix))
            ?.slice(prefix.length);

        if (!rawValue) {
            return "";
        }

        try {
            return decodeURIComponent(rawValue);
        } catch (error) {
            return rawValue;
        }
    }

    function hasCookie(name) {
        return Boolean(getCookieValue(name));
    }

    function hasSessionCookie() {
        return hasCookie("session_id");
    }

    function getConversationIdCookie() {
        const value = getCookieValue("conversation_id");
        const numericValue = Number(value);

        if (Number.isSafeInteger(numericValue) && numericValue > 0) {
            return numericValue;
        }

        return window.AppConstants?.DEFAULT_CONVERSATION_ID || 1;
    }

    function getUtf8ByteLength(value) {
        if (typeof TextEncoder === "function") {
            return new TextEncoder().encode(value).length;
        }

        return unescape(encodeURIComponent(value)).length;
    }

    function hasInvalidControlCharacter(value) {
        return Array.from(value).some((char) => {
            const codePoint = char.codePointAt(0);
            return codePoint < 0x20 || codePoint === 0x7f;
        });
    }

    function validateAuthNickname(nickname) {
        if (!nickname) {
            return "请输入昵称";
        }

        if (hasInvalidControlCharacter(nickname)) {
            return "昵称包含无效字符";
        }

        if (getUtf8ByteLength(nickname) > 32) {
            return "昵称不能超过 32 字节";
        }

        return "";
    }

    function validateAuthPassword(password) {
        if (!password) {
            return "请输入密码";
        }

        if (hasInvalidControlCharacter(password)) {
            return "密码包含无效字符";
        }

        if (getUtf8ByteLength(password) > 64) {
            return "密码不能超过 64 字节";
        }

        return "";
    }

    async function readResponseText(response) {
        try {
            return (await response.text()).trim();
        } catch (error) {
            return "";
        }
    }

    async function resolveAuthFailure(response, mode) {
        const responseText = await readResponseText(response);

        if (response.status === 400) {
            if (responseText === "invalid_username") {
                return { field: "nickname", message: "昵称不合法", networkError: "" };
            }

            if (responseText === "invalid_password") {
                return { field: "password", message: "密码不合法", networkError: "" };
            }

            if (responseText === "invalid_encode") {
                return { field: null, message: "", networkError: "请求格式异常，请重试" };
            }

            if (responseText === "missing username or password") {
                return { field: null, message: "", networkError: "请完整填写昵称和密码" };
            }

            return { field: null, message: "", networkError: "输入格式不正确，请检查后重试" };
        }

        if (mode === "login" && response.status === 401) {
            return { field: "password", message: "昵称或密码错误", networkError: "" };
        }

        if (mode === "register" && response.status === 409) {
            return { field: "nickname", message: "昵称已被占用", networkError: "" };
        }

        if (response.status >= 500) {
            return { field: null, message: "", networkError: "服务器开小差了，请稍后再试" };
        }

        return {
            field: null,
            message: "",
            networkError: mode === "register" ? "注册失败，请稍后重试" : "登录失败，请稍后重试"
        };
    }

    async function loadBabelScript(path) {
        if (window.__signalLoadedScripts?.[path]) {
            return true;
        }

        if (babelScriptLoads.has(path)) {
            return babelScriptLoads.get(path);
        }

        const loadPromise = (async () => {
            if (!window.Babel || typeof window.Babel.transform !== "function") {
                throw new Error("Babel runtime is unavailable");
            }

            const response = await fetch(path, {
                method: "GET",
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error(`Failed to load ${path}: ${response.status}`);
            }

            const source = await response.text();
            const transformed = window.Babel.transform(source, {
                presets: ["react"],
                sourceType: "script"
            }).code;
            const resolvedUrl = new URL(path, window.location.href).href;

            window.eval(`${transformed}\n//# sourceURL=${resolvedUrl}`);

            if (!window.__signalLoadedScripts) {
                window.__signalLoadedScripts = {};
            }
            window.__signalLoadedScripts[path] = true;
            return true;
        })().catch((error) => {
            babelScriptLoads.delete(path);
            throw error;
        });

        babelScriptLoads.set(path, loadPromise);
        return loadPromise;
    }

    function loadBabelScripts(paths) {
        return paths.reduce(
            (promise, path) => promise.then(() => loadBabelScript(path)),
            Promise.resolve()
        );
    }

    function normalizeAuthNickname(data) {
        if (typeof data?.nickname === "string" && data.nickname.trim()) {
            return data.nickname.trim();
        }

        if (typeof data?.username === "string" && data.username.trim()) {
            return data.username.trim();
        }

        return "";
    }

    async function fetchCurrentUser() {
        if (!hasSessionCookie()) {
            return { ok: false, status: 0, data: null };
        }

        const res = await fetch("/me", {
            method: "GET",
            credentials: "include"
        });

        if (!res.ok) {
            return { ok: false, status: res.status, data: null };
        }

        const data = await res.json().catch(() => ({}));
        const nickname = normalizeAuthNickname(data);
        if (!nickname) {
            return { ok: false, status: res.status, data: null };
        }

        return { ok: true, status: res.status, data: { ...data, nickname } };
    }

    function buildAuthBody(nickname, password) {
        const body = new URLSearchParams();
        body.append("username", nickname);
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
        getCookieValue,
        hasCookie,
        hasSessionCookie,
        getConversationIdCookie,
        getUtf8ByteLength,
        validateAuthNickname,
        validateAuthPassword,
        resolveAuthFailure,
        loadBabelScript,
        loadBabelScripts,
        normalizeAuthNickname,
        fetchCurrentUser,
        buildAuthBody
    };
})();
