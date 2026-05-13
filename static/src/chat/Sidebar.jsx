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
  roomName = "我的讨论室"
}) {
  const [profileOpen, setProfileOpen] = useState(false);
  const resolvedRooms =
    Array.isArray(rooms) && rooms.length
      ? rooms
      : [{ id: "personal", name: roomName, isAvailable: true }];
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

  return (
    <motion.aside className="sidebar" initial={initial} animate={animate} transition={transition}>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span className="brand-copy">
          <span>Atrium</span>
          <small>AI 思辨工作台</small>
        </span>
      </div>

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

      <section>
        <div className="section-label">讨论空间</div>
        <div className="room-list">
          {resolvedRooms.map((room) => {
            const isActive = room.id === activeRoomId || (!activeRoomId && room.name === roomName);
            const isDisabled = readOnly || !room.isAvailable;
            return (
              <motion.button
                key={room.id}
                type="button"
                className={`room-item focus-ring is-${room.tone || "personal"} ${isActive ? "is-active" : ""} ${!room.isAvailable ? "is-disabled" : ""}`}
                onClick={() => { if (!isDisabled) onRoomSelect(room.id); }}
                disabled={isDisabled}
                whileTap={isDisabled ? undefined : { scale: 0.99 }}
                transition={TAP_TRANSITION}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="room-main">
                  <span className="room-label">{room.name}</span>
                  {room.note ? <span className="room-status">{room.note}</span> : null}
                </span>
                <span className="room-kind">{room.placeLabel || "讨论室"}</span>
              </motion.button>
            );
          })}
        </div>
      </section>

      <div className="sidebar-footer">
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
