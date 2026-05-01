const EASE = [0.22, 1, 0.36, 1];

export const CHAT_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/chat`;

export const CHAT_RUNTIME_MODULES = () => Promise.all([
  import("./chat/ConnectionStatus.jsx"),
  import("./chat/MessageInput.jsx"),
  import("./chat/MessageFlight.jsx"),
  import("./chat/Sidebar.jsx"),
  import("./chat/ChatRoom.jsx")
]);

export const DEFAULT_CONVERSATION_ID = 1;
export const PERSONAL_ROOM_ID = "personal";
export const PUBLIC_ROOM_ID = "public";
export const PUBLIC_CONVERSATION_ID = 1;
export const MESSAGE_CONTENT_MAX_LENGTH = 4000;
export const MESSAGE_TYPE = Object.freeze({
  TEXT: 1,
  IMAGE: 2,
  FILE: 3,
  SYSTEM: 4
});
export { EASE };
export const TAP_TRANSITION = { duration: 0.12, ease: EASE };
export const NORMAL_SEND_FLIGHT = { duration: 0.34, ease: [0.2, 0.82, 0.2, 1] };
export const LOCAL_SEND_SETTLE_DELAY = 900;

export const STATUS_LABEL = {
  idle: "等待加入",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "已断开"
};

export const STATUS_COLOR = {
  idle: "#9B9A97",
  connecting: "#9B9A97",
  connected: "#238A52",
  reconnecting: "#B67A00",
  disconnected: "#D44C47"
};
