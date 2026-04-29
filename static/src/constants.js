// Defines shared app constants for the zero-build runtime.
(() => {
    const EASE = [0.22, 1, 0.36, 1];

    window.AppConstants = {
        CHAT_URL: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/chat`,
        CHAT_RUNTIME_SCRIPTS: [
            "./src/chat/ConnectionStatus.js",
            "./src/chat/MessageInput.js",
            "./src/chat/MessageFlight.js",
            "./src/chat/Sidebar.js",
            "./src/chat/ChatRoom.js"
        ],
        DEFAULT_CONVERSATION_ID: 1,
        EASE,
        TAP_TRANSITION: { duration: 0.12, ease: EASE },
        NORMAL_SEND_FLIGHT: { duration: 0.34, ease: [0.2, 0.82, 0.2, 1] },
        LOCAL_SEND_SETTLE_DELAY: 900,
        STATUS_LABEL: {
            idle: "等待加入",
            connecting: "连接中",
            connected: "已连接",
            reconnecting: "重连中",
            disconnected: "已断开"
        },
        STATUS_COLOR: {
            idle: "#9B9A97",
            connecting: "#9B9A97",
            connected: "#238A52",
            reconnecting: "#B67A00",
            disconnected: "#D44C47"
        }
    };
})();
