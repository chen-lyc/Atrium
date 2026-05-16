import { motion, AnimatePresence } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";
import { ThemeManager } from "../theme.js";
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

function isTextEditingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
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

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.7 7.4 8 3.1l5.3 4.3" />
      <path d="M4 6.8v6h8v-6" />
      <path d="M6.5 12.8V9.6h3v3.2" />
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

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d="M3.2 7h.1M7 7h.1M10.8 7h.1" />
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

export default function Sidebar({
  nickname, username = "", avatarUrl = "", onLogout,
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
  onRenameConversation = async () => {},
  onDeleteConversation = () => {},
  onCreateRoom = () => {},
  onOpenRoomManagement = () => {},
  onOpenAccountCenter = () => {},
  accountNotificationCount = 0
}) {
  const [quicklookRoomId, setQuicklookRoomId] = useState("");
  const [quicklookAnchor, setQuicklookAnchor] = useState(null);
  const [conversationMenuId, setConversationMenuId] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState(0);
  const [renamingConversationId, setRenamingConversationId] = useState(0);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const quicklookTimerRef = useRef(null);
  const conversationMenuRef = useRef(null);
  const resolvedRooms =
    Array.isArray(rooms) && rooms.length
      ? rooms
      : [{ id: "personal", name: roomName, isAvailable: true }];
  const resolvedMode = mode === "rooms" ? "rooms" : "conversations";
  const activeRoom = room || resolvedRooms.find((item) => item.id === activeRoomId) || resolvedRooms[0];
  const homeRoom = resolvedRooms.find((item) => item.id === "personal" || item.type === 1) || resolvedRooms[0];
  const visibleRooms = resolvedRooms.filter((item) => item.id !== homeRoom?.id);
  const mainConversationId = activeRoom?.mainConversationId || activeRoom?.conversationId || 0;
  const homeMainConversationId = homeRoom?.mainConversationId || homeRoom?.conversationId || 0;
  const mainConversation = conversations.find((item) => item.id === mainConversationId) || (mainConversationId ? { id: mainConversationId, name: activeRoom?.name || "主对话" } : null);
  const normalConversations = sortNormalConversations(conversations, mainConversationId);
  const isPersonalRoom = activeRoom?.id === "personal" || activeRoom?.type === 1;
  const isHomeActive = Boolean(homeRoom && activeRoom?.id === homeRoom.id && activeConversationId === homeMainConversationId);
  const isEntering = transitionMode === "enter";
  const isExiting = transitionMode === "exit";
  const nextMode = resolvedMode === "rooms" ? "conversations" : "rooms";
  const modeActionLabel = resolvedMode === "rooms" ? "当前对话" : "返回房间";
  const modeAriaShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? "Meta+B"
    : "Control+B";

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

  useEffect(() => {
    if (!conversationMenuId) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".conversation-menu-button")) return;
      if (conversationMenuRef.current?.contains(event.target)) return;
      setConversationMenuId(0);
      setDeleteConfirmId(0);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [conversationMenuId]);

  useEffect(() => {
    function handleModeShortcut(event) {
      if (readOnly || event.defaultPrevented || event.altKey) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") return;
      if (isTextEditingTarget(event.target)) return;
      event.preventDefault();
      onModeChange(resolvedMode === "rooms" ? "conversations" : "rooms");
      setQuicklookRoomId("");
    }
    window.addEventListener("keydown", handleModeShortcut);
    return () => window.removeEventListener("keydown", handleModeShortcut);
  }, [onModeChange, readOnly, resolvedMode]);

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

  function selectHome() {
    if (readOnly || !homeRoom) return;
    if (activeRoom?.id === homeRoom.id) {
      if (homeMainConversationId && activeConversationId !== homeMainConversationId) {
        onConversationSelect(homeMainConversationId);
      }
    } else {
      onRoomSelect(homeRoom.id);
    }
    onModeChange("conversations");
    setQuicklookRoomId("");
  }

  async function createConversation() {
    if (readOnly) return;
    await onCreateConversation();
    onModeChange("conversations");
  }

  function openConversationMenu(event, conversationId) {
    event.stopPropagation();
    setConversationMenuId((current) => current === conversationId ? 0 : conversationId);
    setDeleteConfirmId(0);
    setRenameError("");
  }

  function startConversationRename(conversation, title) {
    setRenamingConversationId(conversation.id);
    setRenameDraft(title);
    setRenameError("");
    setConversationMenuId(0);
    setDeleteConfirmId(0);
  }

  function cancelConversationRename() {
    setRenamingConversationId(0);
    setRenameDraft("");
    setRenameError("");
    setRenameBusy(false);
  }

  async function submitConversationRename(event, conversation, currentTitle) {
    event.preventDefault();
    if (renameBusy || readOnly) return;
    const nextTitle = renameDraft.trim();
    if (!nextTitle) {
      setRenameError("对话名不能为空");
      return;
    }
    if (nextTitle === currentTitle) {
      cancelConversationRename();
      return;
    }
    setRenameBusy(true);
    setRenameError("");
    try {
      await onRenameConversation(conversation.id, nextTitle);
      cancelConversationRename();
    } catch (error) {
      setRenameError(error?.message || "重命名失败");
    } finally {
      setRenameBusy(false);
    }
  }

  async function confirmConversationDelete(conversationId) {
    if (readOnly) return;
    await onDeleteConversation(conversationId);
    setConversationMenuId(0);
    setDeleteConfirmId(0);
  }

  return (
    <motion.aside className="sidebar" initial={initial} animate={animate} transition={transition}>
      <header className={`sidebar-mode-head is-mode-${resolvedMode}`}>
        <button
          type="button"
          className="sidebar-mode-switch focus-ring"
          onClick={() => switchMode(nextMode)}
          disabled={readOnly}
          aria-label={resolvedMode === "rooms" ? "回到当前对话" : "返回房间视图"}
          aria-keyshortcuts={modeAriaShortcut}
        >
          <ModeIcon mode={nextMode} />
          <span className="sidebar-mode-copy">{modeActionLabel}</span>
        </button>
        <div className="sidebar-mode-title">
          <span>{resolvedMode === "rooms" ? "所有房间" : activeRoom?.name || roomName}</span>
          <small>{resolvedMode === "rooms" ? `${visibleRooms.length} 个房间` : "当前房间"}</small>
        </div>
      </header>

      <button
        type="button"
        className={`sidebar-home-entry focus-ring ${isHomeActive ? "is-active" : ""}`}
        onClick={selectHome}
        disabled={readOnly || !homeRoom}
        aria-current={isHomeActive ? "page" : undefined}
      >
        <span className="sidebar-home-icon"><HomeIcon /></span>
        <span className="sidebar-home-copy">
          <span>Home</span>
          <small>{homeRoom?.name || "个人讨论室"} · 默认入口</small>
        </span>
      </button>

      <button
        type="button"
        className={`identity focus-ring ${accountNotificationCount > 0 ? "has-notice" : ""}`}
        onClick={onOpenAccountCenter}
        disabled={readOnly}
        aria-label={accountNotificationCount > 0 ? `账户中心，${accountNotificationCount} 个待处理通知` : "账户中心"}
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

      <section className="sidebar-mode-body">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={resolvedMode}
            className="sidebar-mode-content"
            initial={{ opacity: 0, y: resolvedMode === "conversations" ? 8 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: resolvedMode === "conversations" ? -4 : 6 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <div className={`sidebar-tool-row ${resolvedMode === "conversations" ? "is-conversation-tools" : ""}`}>
              {resolvedMode === "rooms" ? (
                <button type="button" className="sidebar-tool is-primary focus-ring" onClick={onCreateRoom} disabled={readOnly}>
                  <PlusIcon />
                  <span>新建房间</span>
                </button>
              ) : (
                <>
                  <button type="button" className="sidebar-tool is-new-conversation focus-ring" onClick={createConversation} disabled={readOnly}>
                    <PlusIcon />
                    <span>新对话</span>
                  </button>
                  <button type="button" className="sidebar-tool is-search focus-ring" disabled title="搜索稍后开放">
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
                      <span>{isPersonalRoom ? "Home" : mainConversation.name || activeRoom?.name || "主对话"}</span>
                      <small>{isPersonalRoom ? "个人讨论室 · 总览" : "公共时间线"}</small>
                    </span>
                  </button>
                ) : null}
                <div className="conversation-scroll">
                  {normalConversations.length ? normalConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;
                    const title = conversation.name || `对话 ${conversation.id}`;
                    const meta = formatConversationMeta(conversation, mainConversationId);
                    const isRenaming = renamingConversationId === conversation.id;
                    const isMenuOpen = conversationMenuId === conversation.id;
                    const isConfirmingDelete = deleteConfirmId === conversation.id;
                    return (
                      <div key={conversation.id} className={`conversation-item-wrap ${isActive ? "is-active" : ""}`}>
                        {isRenaming ? (
                          <form className="conversation-rename" onSubmit={(event) => submitConversationRename(event, conversation, title)}>
                            <input
                              className="conversation-rename-input focus-ring"
                              value={renameDraft}
                              onChange={(event) => { setRenameDraft(event.target.value); setRenameError(""); }}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelConversationRename();
                                }
                              }}
                              disabled={renameBusy}
                              maxLength={32}
                              autoFocus
                            />
                            <button type="submit" className="conversation-rename-action focus-ring" disabled={renameBusy}>保存</button>
                            <button type="button" className="conversation-rename-action focus-ring" onClick={cancelConversationRename} disabled={renameBusy}>取消</button>
                            {renameError ? <span className="conversation-rename-error">{renameError}</span> : null}
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="conversation-item focus-ring"
                              onClick={() => onConversationSelect(conversation.id)}
                              disabled={readOnly}
                              aria-current={isActive ? "page" : undefined}
                              title={meta ? `${title} · ${meta}` : title}
                            >
                              <span className="conversation-copy">
                                <span>{title}</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="conversation-menu-button focus-ring"
                              onClick={(event) => openConversationMenu(event, conversation.id)}
                              disabled={readOnly}
                              aria-label={`${title}的更多操作`}
                              aria-expanded={isMenuOpen}
                            >
                              <MoreIcon />
                            </button>
                            <AnimatePresence>
                              {isMenuOpen ? (
                                <motion.div
                                  ref={conversationMenuRef}
                                  className="conversation-action-menu"
                                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={{ opacity: 0, y: -3, scale: 0.98 }}
                                  transition={{ duration: 0.14, ease: EASE }}
                                >
                                  {isConfirmingDelete ? (
                                    <div className="conversation-delete-confirm">
                                      <span>删除这个对话？</span>
                                      <div>
                                        <button type="button" className="conversation-menu-action focus-ring" onClick={() => setDeleteConfirmId(0)}>取消</button>
                                        <button type="button" className="conversation-menu-action is-danger focus-ring" onClick={() => confirmConversationDelete(conversation.id)}>删除</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <button type="button" className="conversation-menu-action focus-ring" onClick={() => startConversationRename(conversation, title)}>
                                        重命名
                                      </button>
                                      <button type="button" className="conversation-menu-action is-danger focus-ring" onClick={() => setDeleteConfirmId(conversation.id)}>
                                        删除
                                      </button>
                                    </>
                                  )}
                                </motion.div>
                              ) : null}
                            </AnimatePresence>
                          </>
                        )}
                      </div>
                    );
                  }) : (
                    <div className="sidebar-empty">当前房间还没有普通对话</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="room-list is-mode-rooms" aria-label="所有房间">
                {visibleRooms.length ? visibleRooms.map((item) => {
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
                }) : (
                  <div className="sidebar-empty">还没有其他房间</div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
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
