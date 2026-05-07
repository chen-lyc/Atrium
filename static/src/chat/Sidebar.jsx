import { motion } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";
import { ThemeManager } from "../theme.js";
import { useState, useEffect } from "react";

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

const SIDEBAR_AI_MODELS = [
  { name: "DeepSeek", meta: "AI 模型" },
  { name: "Qwen", meta: "AI 模型" }
];

function SidebarWorkbenchNav({ onOpenWorkspacePanel, readOnly }) {
  return (
    <section className="sidebar-workbench-nav" aria-label="AI 模型与知识沉淀">
      <div className="sidebar-nav-group">
        <div className="section-label">AI 模型</div>
        <div className="sidebar-nav-list">
          {SIDEBAR_AI_MODELS.map((model) => (
            <button
              key={model.name}
              type="button"
              className="sidebar-nav-row focus-ring"
              onClick={onOpenWorkspacePanel}
              disabled={readOnly}
            >
              <span>{model.name}</span>
              <small>{model.meta}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-nav-group">
        <div className="section-label">知识沉淀</div>
        <div className="sidebar-nav-list">
          <button
            type="button"
            className="sidebar-nav-row is-strong focus-ring"
            onClick={onOpenWorkspacePanel}
            disabled={readOnly}
          >
            <span>笔记与摘录</span>
            <small>沉淀讨论结论</small>
          </button>
          <button
            type="button"
            className="sidebar-nav-row focus-ring"
            onClick={onOpenWorkspacePanel}
            disabled={readOnly}
          >
            <span>空间索引</span>
            <small>房间 · 对话 · 成员</small>
          </button>
        </div>
      </div>
      <button
        type="button"
        className="sidebar-workspace-link focus-ring"
        onClick={onOpenWorkspacePanel}
        disabled={readOnly}
      >
        打开侧工作区
      </button>
    </section>
  );
}

export default function Sidebar({
  nickname, onLogout,
  shouldAnimateEntry, entryDelay, entryDuration = 0.3, entryOffsetX = -20,
  transitionMode = "idle", motionTiming = null, readOnly = false,
  rooms = null, activeRoomId = "", onRoomSelect = () => {},
  roomName = "我的讨论室", onOpenWorkspacePanel = () => {}
}) {
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

      <div className="identity">
        <span className="identity-kicker">当前身份</span>
        <div className="identity-name">{nickname}</div>
      </div>

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

      <SidebarWorkbenchNav onOpenWorkspacePanel={onOpenWorkspacePanel} readOnly={readOnly} />

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
