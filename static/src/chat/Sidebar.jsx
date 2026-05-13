import { motion, AnimatePresence } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";
import { ThemeManager } from "../theme.js";
import {
  getApiErrorMessage,
  validateAuthUsername,
  validateProfileAvatarUrl,
  validateProfileNickname
} from "../utils.js";
import { useState, useEffect, useRef } from "react";

const THEME_LABELS = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统"
};

function ThemeIcon({ mode, resolvedMode }) {
  if (mode === "system") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 2.5a5.5 5.5 0 0 1 0 11" fill="currentColor" opacity="0.22" />
      </svg>
    );
  }
  if (resolvedMode === "dark") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M12.6 10.2A5.4 5.4 0 0 1 5.8 3.4a5.7 5.7 0 1 0 6.8 6.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.5v1.4M8 13.1v1.4M14.5 8h-1.4M2.9 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle() {
  const [mode, setMode] = useState(() => ThemeManager.getMode());
  const [resolvedMode, setResolvedMode] = useState(() => ThemeManager.getResolvedMode());

  useEffect(() => {
    function handleChange(e) {
      setMode(e.detail?.mode || ThemeManager.getMode());
      setResolvedMode(e.detail?.resolvedMode || ThemeManager.getResolvedMode());
    }
    window.addEventListener("themechange", handleChange);
    return () => window.removeEventListener("themechange", handleChange);
  }, []);

  return (
    <button
      type="button"
      className="theme-toggle-btn focus-ring"
      onClick={() => ThemeManager.cycle()}
      aria-label={`切换外观，当前为${THEME_LABELS[mode] || mode}`}
      title={`当前外观：${THEME_LABELS[mode] || mode}`}
    >
      <span className="theme-toggle-icon"><ThemeIcon mode={mode} resolvedMode={resolvedMode} /></span>
      <span className="theme-toggle-label">{THEME_LABELS[mode] || mode}</span>
    </button>
  );
}

function getIdentityInitial(nickname, username) {
  const source = String(nickname || username || "用").trim();
  return Array.from(source)[0] || "用";
}

function ModeIcon({ mode }) {
  if (mode === "rooms") {
    return (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.2 5.2h4.2v4.2H3.2zM9.6 3.4h4.2v4.2H9.6zM9.6 9.7h4.2v4.2H9.6zM5.3 9.4v2.4h4.3M7.4 7.3h2.2" />
      </svg>
    );
  }
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.4 4.2h10.2M3.4 8.5h7.8M3.4 12.8h5.4" />
      <path d="M12.4 10.8l1.2 1.2 1.2-1.2M13.6 6.1v5.8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="6.2" cy="6.2" r="3.8" />
      <path d="m9.2 9.2 2.4 2.4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z" />
      <path d="M7 1.7v1.2M7 11.1v1.2M2.5 4.1l1 .6M10.5 9.3l1 .6M2.5 9.9l1-.6M10.5 4.7l1-.6" />
    </svg>
  );
}

function formatConversationMeta(conversation, mainConversationId) {
  if (conversation.id === mainConversationId) return "主对话";
  if (conversation.createdAtMs) {
    const date = new Date(conversation.createdAtMs);
    if (!Number.isNaN(date.getTime())) return `${date.getMonth() + 1}/${date.getDate()}`;
  }
  return `#${conversation.id}`;
}

function sortNormalConversations(conversations, mainConversationId) {
  return conversations
    .filter((conversation) => conversation.id && conversation.id !== mainConversationId)
    .sort((a, b) => {
      const timeDiff = (b.createdAtMs || 0) - (a.createdAtMs || 0);
      if (timeDiff) return timeDiff;
      return b.id - a.id;
    });
}

function getRoomTypeLabel(room) {
  if (room?.placeLabel) return room.placeLabel;
  if (room?.type === 1 || room?.id === "personal") return "个人空间";
  if (room?.type === 0 || room?.id === "public") return "公共大厅";
  return "讨论室";
}

function getRoomMemberLabel(room) {
  const count = Number(room?.memberCount ?? room?.member_count ?? room?.membersCount ?? room?.members_count);
  if (Number.isSafeInteger(count) && count >= 0) return `${count} 位成员`;
  if (Array.isArray(room?.members)) return `${room.members.length} 位成员`;
  return "成员数待同步";
}

function getRoomConversationLabel(room) {
  const count = Array.isArray(room?.conversations) ? room.conversations.length : 0;
  return `${Math.max(count, 1)} 个对话`;
}

function normalizeProfileValue(value) {
  return String(value || "").trim();
}

function ProfileEditorLayer({
  isOpen,
  nickname,
  username,
  avatarUrl,
  onClose,
  onSave,
  readOnly
}) {
  const firstFieldRef = useRef(null);
  const closeTimerRef = useRef(null);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const initialRef = useRef({ nickname: "", username: "", avatarUrl: "" });
  const [draft, setDraft] = useState({ nickname: "", username: "", avatarUrl: "" });
  const [errors, setErrors] = useState({ nickname: "", username: "", avatarUrl: "", form: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const nextInitial = {
      nickname: normalizeProfileValue(nickname),
      username: normalizeProfileValue(username || nickname),
      avatarUrl: normalizeProfileValue(avatarUrl)
    };
    initialRef.current = nextInitial;
    setDraft(nextInitial);
    setErrors({ nickname: "", username: "", avatarUrl: "", form: "" });
    setNotice("");
    setBusy(false);
    const frameId = window.requestAnimationFrame(() => firstFieldRef.current?.focus({ preventScroll: true }));
    function handleKeyDown(event) {
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(closeTimerRef.current);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "", form: "" }));
    setNotice("");
  }

  const normalizedDraft = {
    nickname: normalizeProfileValue(draft.nickname),
    username: normalizeProfileValue(draft.username),
    avatarUrl: normalizeProfileValue(draft.avatarUrl)
  };
  const hasChanges =
    normalizedDraft.nickname !== initialRef.current.nickname ||
    normalizedDraft.username !== initialRef.current.username ||
    normalizedDraft.avatarUrl !== initialRef.current.avatarUrl;

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || readOnly) return;
    const nextErrors = {
      nickname: validateProfileNickname(normalizedDraft.nickname),
      username: validateAuthUsername(normalizedDraft.username),
      avatarUrl: validateProfileAvatarUrl(normalizedDraft.avatarUrl),
      form: ""
    };
    if (nextErrors.nickname || nextErrors.username || nextErrors.avatarUrl) {
      setErrors(nextErrors);
      return;
    }
    const payload = {};
    if (normalizedDraft.nickname !== initialRef.current.nickname) payload.nickname = normalizedDraft.nickname;
    if (normalizedDraft.username !== initialRef.current.username) payload.username = normalizedDraft.username;
    if (normalizedDraft.avatarUrl !== initialRef.current.avatarUrl) payload.avatar_url = normalizedDraft.avatarUrl;
    if (!Object.keys(payload).length) {
      onClose();
      return;
    }
    setBusy(true);
    setErrors({ nickname: "", username: "", avatarUrl: "", form: "" });
    try {
      await onSave(payload);
      initialRef.current = normalizedDraft;
      setNotice("已保存");
      closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), 420);
    } catch (error) {
      const next = { nickname: "", username: "", avatarUrl: "", form: "" };
      if (payload.username && error?.status === 400) {
        next.username = error?.body === "invalid_username" ? "登录名不合法" : "登录名已被占用";
      } else if (payload.nickname && error?.status === 400) {
        next.nickname = "显示名不符合规则";
      } else if (payload.avatar_url && error?.status === 400) {
        next.avatarUrl = "头像地址不符合规则";
      } else {
        next.form = getApiErrorMessage(error, "身份保存失败，请稍后重试");
      }
      setErrors(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="identity-editor-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: EASE }}
        >
          <button type="button" className="identity-editor-backdrop" aria-label="关闭身份编辑" onClick={() => { if (!busy) onClose(); }} />
          <motion.form
            className="identity-editor"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.985 }}
            transition={{ duration: 0.18, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="identity-editor-title"
          >
            <div className="identity-editor-head">
              <div className="identity-editor-avatar" aria-hidden="true">
                {normalizedDraft.avatarUrl ? <img src={normalizedDraft.avatarUrl} alt="" /> : <span>{getIdentityInitial(normalizedDraft.nickname, normalizedDraft.username)}</span>}
              </div>
              <div>
                <span className="identity-editor-kicker">当前身份</span>
                <h2 id="identity-editor-title">身份</h2>
              </div>
              <button type="button" className="identity-editor-close focus-ring" onClick={onClose} disabled={busy} aria-label="关闭身份编辑">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m4.2 4.2 7.6 7.6M11.8 4.2l-7.6 7.6" />
                </svg>
              </button>
            </div>

            <label className="identity-field">
              <span>显示名</span>
              <input
                ref={firstFieldRef}
                className={`identity-input ${errors.nickname ? "is-error" : ""}`}
                value={draft.nickname}
                onChange={(event) => updateDraft("nickname", event.target.value)}
                disabled={busy}
                autoComplete="name"
              />
              {errors.nickname ? <small>{errors.nickname}</small> : null}
            </label>

            <label className="identity-field">
              <span>登录名</span>
              <input
                className={`identity-input ${errors.username ? "is-error" : ""}`}
                value={draft.username}
                onChange={(event) => updateDraft("username", event.target.value)}
                disabled={busy}
                autoComplete="username"
              />
              {errors.username ? <small>{errors.username}</small> : null}
            </label>

            <label className="identity-field">
              <span>头像地址</span>
              <input
                className={`identity-input ${errors.avatarUrl ? "is-error" : ""}`}
                value={draft.avatarUrl}
                onChange={(event) => updateDraft("avatarUrl", event.target.value)}
                disabled={busy}
                autoComplete="url"
              />
              {errors.avatarUrl ? <small>{errors.avatarUrl}</small> : null}
            </label>

            {errors.form ? <div className="identity-editor-error">{errors.form}</div> : null}
            {notice ? <div className="identity-editor-notice">{notice}</div> : null}

            <div className="identity-editor-actions">
              <button type="button" className="identity-editor-action focus-ring" onClick={onClose} disabled={busy}>取消</button>
              <button type="submit" className="identity-editor-action is-primary focus-ring" disabled={!hasChanges || busy || readOnly}>{busy ? "保存中" : "保存"}</button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default function Sidebar({
  nickname, username = "", avatarUrl = "", onProfileUpdate = async () => {}, onLogout,
  shouldAnimateEntry, entryDelay, entryDuration = 0.3, entryOffsetX = -20,
  transitionMode = "idle", motionTiming = null, readOnly = false,
  rooms = null, activeRoomId = "", onRoomSelect = () => {},
  roomName = "我的讨论室",
  mode = "conversations", onModeChange = () => {},
  room = null,
  conversations = [],
  activeConversationId = 0,
  onConversationSelect = () => {},
  onCreateConversation = async () => null,
  onDeleteConversation = () => {},
  onCreateRoom = () => {},
  onOpenRoomManagement = () => {}
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [quicklookRoomId, setQuicklookRoomId] = useState("");
  const [quicklookAnchor, setQuicklookAnchor] = useState(null);
  const quicklookTimerRef = useRef(null);
  const resolvedRooms =
    Array.isArray(rooms) && rooms.length
      ? rooms
      : [{ id: "personal", name: roomName, isAvailable: true }];
  const resolvedMode = mode === "rooms" ? "rooms" : "conversations";
  const activeRoom = room || resolvedRooms.find((item) => item.id === activeRoomId) || resolvedRooms[0];
  const mainConversationId = activeRoom?.mainConversationId || activeRoom?.conversationId || 0;
  const mainConversation = conversations.find((item) => item.id === mainConversationId) || (mainConversationId ? { id: mainConversationId, name: activeRoom?.name || "主对话" } : null);
  const normalConversations = sortNormalConversations(conversations, mainConversationId);
  const isEntering = transitionMode === "enter";
  const isExiting = transitionMode === "exit";

  const initial = isEntering
    ? { x: motionTiming?.x ?? entryOffsetX, opacity: 0 }
    : shouldAnimateEntry ? { x: entryOffsetX, opacity: 0 } : false;
  const animate = isExiting
    ? { x: motionTiming?.x || 0, opacity: 0 }
    : { x: 0, opacity: 1 };
  const transition = isEntering || isExiting
    ? { delay: motionTiming?.delay || 0, duration: motionTiming?.duration || entryDuration, ease: EASE }
    : shouldAnimateEntry
      ? { delay: entryDelay, duration: entryDuration, ease: EASE }
      : { duration: 0.18, ease: EASE };

  useEffect(() => () => window.clearTimeout(quicklookTimerRef.current), []);

  function switchMode(nextMode) {
    if (readOnly) return;
    onModeChange(nextMode);
    setQuicklookRoomId("");
  }

  function openQuicklook(roomId, event = null) {
    window.clearTimeout(quicklookTimerRef.current);
    if (event?.currentTarget?.getBoundingClientRect) {
      const rect = event.currentTarget.getBoundingClientRect();
      const popoverWidth = Math.min(270, Math.max(0, window.innerWidth - 24));
      const popoverHeight = 190;
      setQuicklookAnchor({
        left: Math.max(12, Math.min(rect.right + 8, window.innerWidth - popoverWidth - 12)),
        top: Math.max(12, Math.min(rect.top - 2, window.innerHeight - popoverHeight))
      });
    }
    setQuicklookRoomId(roomId);
  }

  function queueCloseQuicklook() {
    window.clearTimeout(quicklookTimerRef.current);
    quicklookTimerRef.current = window.setTimeout(() => setQuicklookRoomId(""), 120);
  }

  function selectRoom(roomId) {
    if (readOnly) return;
    onRoomSelect(roomId);
    onModeChange("conversations");
    setQuicklookRoomId("");
  }

  async function createConversation() {
    if (readOnly) return;
    await onCreateConversation();
    onModeChange("conversations");
  }

  return (
    <motion.aside className="sidebar" initial={initial} animate={animate} transition={transition}>
      <header className="sidebar-mode-head">
        <button
          type="button"
          className="sidebar-mode-switch focus-ring"
          onClick={() => switchMode(resolvedMode === "rooms" ? "conversations" : "rooms")}
          disabled={readOnly}
          aria-label={resolvedMode === "rooms" ? "切换到对话视图" : "切换到房间视图"}
          title={resolvedMode === "rooms" ? "对话视图" : "房间视图"}
        >
          <ModeIcon mode={resolvedMode} />
        </button>
        <div className="sidebar-mode-title">
          <span>{resolvedMode === "rooms" ? "所有房间" : activeRoom?.name || roomName}</span>
          <small>{resolvedMode === "rooms" ? `${resolvedRooms.length} 个房间` : "当前房间"}</small>
        </div>
      </header>

      <button
        type="button"
        className="identity focus-ring"
        onClick={() => setProfileOpen(true)}
        disabled={readOnly}
        aria-label="编辑当前身份"
        aria-expanded={profileOpen}
      >
        <span className="identity-avatar" aria-hidden="true">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{getIdentityInitial(nickname, username)}</span>}
        </span>
        <span className="identity-copy">
          <span className="identity-kicker">当前身份</span>
          <span className="identity-name">{nickname}</span>
        </span>
        {username ? <span className="identity-handle">@{username}</span> : null}
      </button>

      <ProfileEditorLayer
        isOpen={profileOpen && !readOnly}
        nickname={nickname}
        username={username}
        avatarUrl={avatarUrl}
        onClose={() => setProfileOpen(false)}
        onSave={onProfileUpdate}
        readOnly={readOnly}
      />

      <section className="sidebar-mode-body">
        <div className="sidebar-tool-row">
          {resolvedMode === "rooms" ? (
            <button type="button" className="sidebar-tool is-primary focus-ring" onClick={onCreateRoom} disabled={readOnly}>
              <PlusIcon />
              <span>新建房间</span>
            </button>
          ) : (
            <>
              <button type="button" className="sidebar-tool is-primary focus-ring" onClick={createConversation} disabled={readOnly}>
                <PlusIcon />
                <span>新建讨论</span>
              </button>
              <button type="button" className="sidebar-tool focus-ring" disabled title="搜索稍后开放">
                <SearchIcon />
                <span>搜索</span>
              </button>
            </>
          )}
        </div>

        {resolvedMode === "conversations" ? (
          <div className="conversation-list" aria-label="当前房间的对话">
            {mainConversation ? (
              <button
                type="button"
                className={`conversation-item is-main focus-ring ${activeConversationId === mainConversation.id ? "is-active" : ""}`}
                onClick={() => onConversationSelect(mainConversation.id)}
                disabled={readOnly}
                aria-current={activeConversationId === mainConversation.id ? "page" : undefined}
              >
                <span className="conversation-copy">
                  <span>{mainConversation.name || activeRoom?.name || "主对话"}</span>
                  <small>主对话 · 房间仪表板预留</small>
                </span>
              </button>
            ) : null}
            <div className="conversation-scroll">
              {normalConversations.length ? normalConversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId;
                const title = conversation.name || `对话 ${conversation.id}`;
                return (
                  <div key={conversation.id} className={`conversation-item-wrap ${isActive ? "is-active" : ""}`}>
                    <button
                      type="button"
                      className="conversation-item focus-ring"
                      onClick={() => onConversationSelect(conversation.id)}
                      disabled={readOnly}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className="conversation-copy">
                        <span>{title}</span>
                        <small>{formatConversationMeta(conversation, mainConversationId)}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="conversation-delete focus-ring"
                      onClick={() => onDeleteConversation(conversation.id)}
                      disabled={readOnly}
                      aria-label={`删除${title}`}
                      title="删除对话"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 4l6 6M10 4l-6 6" />
                      </svg>
                    </button>
                  </div>
                );
              }) : (
                <div className="sidebar-empty">当前房间还没有普通对话</div>
              )}
            </div>
          </div>
        ) : (
          <div className="room-list is-mode-rooms" aria-label="所有房间">
            {resolvedRooms.map((item) => {
              const isActive = item.id === activeRoomId || (!activeRoomId && item.name === roomName);
              const isDisabled = readOnly || !item.isAvailable;
              const isQuicklookOpen = quicklookRoomId === item.id;
              return (
                <div
                  key={item.id}
                  className="room-mode-wrap"
                  onMouseLeave={queueCloseQuicklook}
                  onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) queueCloseQuicklook(); }}
                >
                  <motion.button
                    type="button"
                    className={`room-item focus-ring is-${item.tone || "personal"} ${isActive ? "is-active" : ""} ${!item.isAvailable ? "is-disabled" : ""}`}
                    onClick={() => { if (!isDisabled) selectRoom(item.id); }}
                    disabled={isDisabled}
                    whileTap={isDisabled ? undefined : { scale: 0.99 }}
                    transition={TAP_TRANSITION}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className="room-main">
                      <span className="room-label">{item.name}</span>
                      {item.note ? <span className="room-status">{item.note}</span> : null}
                    </span>
                    <span className="room-kind">{getRoomTypeLabel(item)}</span>
                  </motion.button>
                  <button
                    type="button"
                    className="room-gear focus-ring"
                    onMouseEnter={(event) => openQuicklook(item.id, event)}
                    onFocus={(event) => openQuicklook(item.id, event)}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openQuicklook(item.id, event);
                    }}
                    disabled={readOnly || !item.isAvailable}
                    aria-label={`查看${item.name}快览`}
                    aria-expanded={isQuicklookOpen}
                  >
                    <GearIcon />
                  </button>
                  <AnimatePresence>
                    {isQuicklookOpen ? (
                      <motion.div
                        className="room-quicklook"
                        style={quicklookAnchor ? { left: quicklookAnchor.left, top: quicklookAnchor.top } : undefined}
                        initial={{ opacity: 0, x: -4, scale: 0.99 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -4, scale: 0.99 }}
                        transition={{ duration: 0.14, ease: EASE }}
                        onMouseEnter={() => openQuicklook(item.id)}
                        onMouseLeave={queueCloseQuicklook}
                        onFocus={() => openQuicklook(item.id)}
                        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) queueCloseQuicklook(); }}
                      >
                        <div className="room-quicklook-title">{item.name}</div>
                        <div className="room-quicklook-meta">
                          <div><span>类型</span><strong>{getRoomTypeLabel(item)}</strong></div>
                          <div><span>成员</span><strong>{getRoomMemberLabel(item)}</strong></div>
                          <div><span>对话</span><strong>{getRoomConversationLabel(item)}</strong></div>
                        </div>
                        <button
                          type="button"
                          className="room-quicklook-action focus-ring"
                          onClick={() => {
                            onOpenRoomManagement(item.id, "room");
                            setQuicklookRoomId("");
                          }}
                        >
                          打开房间管理
                        </button>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="sidebar-footer">
        <div className="sidebar-footer-brand">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>Atrium</span>
        </div>
        <ThemeToggle />
        <button
          type="button"
          className="sidebar-footer-button focus-ring"
          onClick={onLogout}
          disabled={readOnly}
        >
          登出
        </button>
      </div>
    </motion.aside>
  );
}
