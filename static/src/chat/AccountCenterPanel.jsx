import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";
import { ThemeManager } from "../theme.js";
import {
  cancelFriendRequest,
  createFriendRequest,
  deleteFriend,
  fetchFriendRequests,
  fetchFriends,
  fetchMyRoomInvitations,
  getApiErrorMessage,
  respondFriendRequest,
  respondRoomInvitation,
  searchUsers,
  validateAuthUsername,
  validateProfileAvatarUrl,
  validateProfileNickname
} from "../utils.js";

const ACCOUNT_TABS = [
  ["friends", "好友"],
  ["requests", "好友申请"],
  ["invitations", "房间邀请"],
  ["settings", "账户设置"]
];

const THEME_LABELS = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统"
};

function RowAction({ children, kind = "secondary", busy = false, disabled = false, onClick }) {
  return (
    <motion.button
      type="button"
      className={`workspace-action is-${kind}`}
      onClick={onClick}
      disabled={disabled || busy}
      whileTap={disabled || busy ? undefined : { scale: 0.98 }}
      transition={TAP_TRANSITION}
    >
      {busy ? "处理中" : children}
    </motion.button>
  );
}

function EmptyLine({ children }) {
  return <div className="workspace-empty">{children}</div>;
}

function getIdentityInitial(nickname, username) {
  const source = String(nickname || username || "用").trim();
  return Array.from(source)[0] || "用";
}

function normalizeProfileValue(value) {
  return String(value || "").trim();
}

function AccountThemeControl({ readOnly = false }) {
  const [mode, setMode] = useState(() => ThemeManager.getMode());
  const [resolvedMode, setResolvedMode] = useState(() => ThemeManager.getResolvedMode());

  useEffect(() => {
    function handleChange(event) {
      setMode(event.detail?.mode || ThemeManager.getMode());
      setResolvedMode(event.detail?.resolvedMode || ThemeManager.getResolvedMode());
    }
    window.addEventListener("themechange", handleChange);
    return () => window.removeEventListener("themechange", handleChange);
  }, []);

  return (
    <button
      type="button"
      className="account-setting-row focus-ring"
      onClick={() => ThemeManager.cycle()}
      disabled={readOnly}
    >
      <span className="account-setting-copy">
        <span>外观</span>
        <small>{THEME_LABELS[mode] || mode} · 当前渲染为 {THEME_LABELS[resolvedMode] || resolvedMode}</small>
      </span>
      <span className="account-setting-value">{THEME_LABELS[mode] || mode}</span>
    </button>
  );
}

function AccountDesignLabEntry({
  loading = false,
  error = "",
  readOnly = false,
  onOpen = () => {}
}) {
  return (
    <section className="workspace-section account-devtools-section">
      <div className="workspace-section-title">验收</div>
      <button
        type="button"
        className="account-devtools-entry focus-ring"
        onClick={onOpen}
        disabled={loading || readOnly}
      >
        <span className="account-devtools-copy">
          <span>前端开发者窗口</span>
          <small>{error || "打开后再加载渲染场景、动效和边缘状态"}</small>
        </span>
        <span className="account-devtools-state">{loading ? "加载中" : "打开"}</span>
      </button>
    </section>
  );
}

function AccountSettings({
  isOpen,
  nickname = "",
  username = "",
  avatarUrl = "",
  onProfileUpdate = async () => {},
  readOnly = false,
  onOpenDesignLab = () => {},
  designLabLoading = false,
  designLabError = ""
}) {
  const initialRef = useRef({ nickname: "", username: "", avatarUrl: "" });
  const [draft, setDraft] = useState({ nickname: "", username: "", avatarUrl: "" });
  const [errors, setErrors] = useState({ nickname: "", username: "", avatarUrl: "", form: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, nickname, username, avatarUrl]);

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
    if (!Object.keys(payload).length) return;
    setBusy(true);
    setErrors({ nickname: "", username: "", avatarUrl: "", form: "" });
    try {
      await onProfileUpdate(payload);
      initialRef.current = normalizedDraft;
      setNotice("账户资料已保存");
    } catch (error) {
      const next = { nickname: "", username: "", avatarUrl: "", form: "" };
      if (payload.username && error?.status === 400) {
        next.username = error?.body === "invalid_username" ? "登录名不合法" : "登录名已被占用";
      } else if (payload.nickname && error?.status === 400) {
        next.nickname = "显示名不符合规则";
      } else if (payload.avatar_url && error?.status === 400) {
        next.avatarUrl = "头像地址不符合规则";
      } else {
        next.form = getApiErrorMessage(error, "账户资料保存失败");
      }
      setErrors(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-stack">
      <section className="workspace-section account-settings-card">
        <div className="workspace-section-title">身份</div>
        <form className="account-profile-form" onSubmit={handleSubmit}>
          <div className="account-profile-preview">
            <span className="account-profile-avatar" aria-hidden="true">
              {normalizedDraft.avatarUrl ? <img src={normalizedDraft.avatarUrl} alt="" /> : <span>{getIdentityInitial(normalizedDraft.nickname, normalizedDraft.username)}</span>}
            </span>
            <div>
              <span>{normalizedDraft.nickname || "未命名用户"}</span>
              <small>{normalizedDraft.username ? `@${normalizedDraft.username}` : "登录名未设置"}</small>
            </div>
          </div>

          <label className="account-profile-field">
            <span>显示名</span>
            <input
              className={`workspace-input ${errors.nickname ? "is-error" : ""}`}
              value={draft.nickname}
              onChange={(event) => updateDraft("nickname", event.target.value)}
              disabled={busy || readOnly}
              autoComplete="name"
            />
            {errors.nickname ? <small>{errors.nickname}</small> : null}
          </label>

          <label className="account-profile-field">
            <span>登录名</span>
            <input
              className={`workspace-input ${errors.username ? "is-error" : ""}`}
              value={draft.username}
              onChange={(event) => updateDraft("username", event.target.value)}
              disabled={busy || readOnly}
              autoComplete="username"
            />
            {errors.username ? <small>{errors.username}</small> : null}
          </label>

          <label className="account-profile-field">
            <span>头像地址</span>
            <input
              className={`workspace-input ${errors.avatarUrl ? "is-error" : ""}`}
              value={draft.avatarUrl}
              onChange={(event) => updateDraft("avatarUrl", event.target.value)}
              disabled={busy || readOnly}
              autoComplete="url"
            />
            {errors.avatarUrl ? <small>{errors.avatarUrl}</small> : null}
          </label>

          {errors.form ? <div className="workspace-error is-inline">{errors.form}</div> : null}
          {notice ? <div className="workspace-notice is-inline">{notice}</div> : null}

          <div className="account-profile-actions">
            <button type="submit" className="workspace-action is-primary" disabled={!hasChanges || busy || readOnly}>
              {busy ? "保存中" : "保存"}
            </button>
          </div>
        </form>
      </section>

      <section className="workspace-section">
        <div className="workspace-section-title">界面</div>
        <AccountThemeControl readOnly={readOnly} />
      </section>

      <AccountDesignLabEntry
        loading={designLabLoading}
        error={designLabError}
        readOnly={readOnly}
        onOpen={onOpenDesignLab}
      />
    </div>
  );
}

export default function AccountCenterPanel({
  isOpen,
  onClose,
  currentUserId = "",
  nickname = "",
  username = "",
  avatarUrl = "",
  onProfileUpdate = async () => {},
  readOnly = false,
  onRoomsChanged = async () => {},
  onNotificationCountChange = () => {},
  onOpenDesignLab = () => {},
  designLabLoading = false,
  designLabError = ""
}) {
  const [tab, setTab] = useState("friends");
  const [friends, setFriends] = useState([]);
  const [receivedFriendRequests, setReceivedFriendRequests] = useState([]);
  const [sentFriendRequests, setSentFriendRequests] = useState([]);
  const [receivedRoomInvitations, setReceivedRoomInvitations] = useState([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [panelState, setPanelState] = useState("idle");
  const [searchState, setSearchState] = useState("idle");
  const [actionKey, setActionKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const normalizedCurrentUserId = String(currentUserId || "");
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.userId)), [friends]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    refreshPanel(controller.signal);
    return () => controller.abort();
  }, [isOpen]);

  async function refreshPanel(signal) {
    setPanelState("loading");
    setError("");
    try {
      const [
        nextFriends,
        nextReceivedFriendRequests,
        nextSentFriendRequests,
        nextReceivedRoomInvitations
      ] = await Promise.all([
        fetchFriends(signal),
        fetchFriendRequests("received", signal),
        fetchFriendRequests("sent", signal),
        fetchMyRoomInvitations("received", signal)
      ]);
      setFriends(nextFriends);
      setReceivedFriendRequests(nextReceivedFriendRequests);
      setSentFriendRequests(nextSentFriendRequests);
      setReceivedRoomInvitations(nextReceivedRoomInvitations);
      onNotificationCountChange(nextReceivedFriendRequests.length + nextReceivedRoomInvitations.length);
      setPanelState("ready");
    } catch (err) {
      if (err?.name === "AbortError") return;
      setPanelState("error");
      setError(getApiErrorMessage(err, "账户信息加载失败"));
    }
  }

  async function runAction(key, action, successMessage = "") {
    if (readOnly || actionKey) return;
    setActionKey(key);
    setError("");
    setNotice("");
    try {
      await action();
      if (successMessage) setNotice(successMessage);
      await refreshPanel();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setActionKey("");
    }
  }

  async function handleSearch() {
    const value = query.trim();
    if (!value) {
      setSearchResults([]);
      setSearchState("idle");
      return;
    }
    setSearchState("loading");
    setError("");
    try {
      setSearchResults(await searchUsers(value));
      setSearchState("ready");
    } catch (err) {
      setSearchState("error");
      setError(getApiErrorMessage(err, "没有搜索到用户"));
    }
  }

  function handleQueryKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  }

  async function handleFriendRequest(userId) {
    await runAction(`friend-${userId}`, async () => {
      await createFriendRequest(userId);
    }, "好友请求已送出");
  }

  async function handleRespondFriend(requestId, status) {
    await runAction(`friend-request-${requestId}-${status}`, async () => {
      await respondFriendRequest(requestId, status);
    }, status === "accepted" ? "已成为好友" : "已忽略请求");
  }

  async function handleCancelFriendRequest(requestId) {
    await runAction(`friend-cancel-${requestId}`, async () => {
      await cancelFriendRequest(requestId);
    }, "请求已撤回");
  }

  async function handleDeleteFriend(userId) {
    await runAction(`friend-delete-${userId}`, async () => {
      await deleteFriend(userId);
    }, "好友已移除");
  }

  async function handleRespondRoomInvitation(invitationId, status) {
    await runAction(`room-invitation-${invitationId}-${status}`, async () => {
      await respondRoomInvitation(invitationId, status);
      if (status === "accepted") await onRoomsChanged();
    }, status === "accepted" ? "已加入讨论室" : "已忽略邀请");
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="account-center-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: EASE }}
        >
          <motion.div
            className="account-center-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE }}
            onClick={onClose}
          />
          <motion.section
            className="account-center-page"
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.22, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label="账户中心"
            aria-labelledby="account-center-title"
          >
            <header className="account-center-header">
              <div>
                <div className="account-center-kicker">账户中心</div>
                <h2 id="account-center-title">{nickname || username || "我的账户"}</h2>
                <p>好友、邀请与个人设置</p>
              </div>
              <button type="button" className="account-center-close focus-ring" onClick={onClose} aria-label="关闭账户中心">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <div className="account-center-layout">
              <nav className="account-center-nav" role="tablist" aria-label="账户中心分类">
                {ACCOUNT_TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`account-center-nav-item focus-ring ${tab === id ? "is-active" : ""}`}
                    onClick={() => setTab(id)}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls={`account-center-${id}`}
                    id={`account-tab-${id}`}
                  >
                    <span>{label}</span>
                    {(id === "requests" && receivedFriendRequests.length) || (id === "invitations" && receivedRoomInvitations.length) ? (
                      <span className="account-tab-dot" aria-hidden="true" />
                    ) : null}
                  </button>
                ))}
              </nav>

              <div className="account-center-content">
                {notice ? <div className="workspace-notice">{notice}</div> : null}
                {error ? <div className="workspace-error">{error}</div> : null}
                {panelState === "loading" ? <div className="workspace-loading">正在同步账户</div> : null}

                <div
                  className="account-center-pane"
                  role="tabpanel"
                  id={`account-center-${tab}`}
                  aria-labelledby={`account-tab-${tab}`}
                >
                  {tab === "friends" ? (
                <div className="workspace-stack">
                  <section className="workspace-section">
                    <div className="workspace-section-title">找人</div>
                    <div className="workspace-inline-form">
                      <input
                        className="workspace-input"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleQueryKeyDown}
                        placeholder="昵称或用户 ID"
                      />
                      <RowAction kind="primary" busy={searchState === "loading"} onClick={handleSearch}>搜索</RowAction>
                    </div>
                    <div className="workspace-list is-search">
                      {searchResults.length ? searchResults.map((user) => {
                        const isSelf = String(user.userId) === normalizedCurrentUserId;
                        const isFriend = friendIds.has(user.userId);
                        return (
                          <div key={user.userId} className="workspace-row">
                            <div className="workspace-row-main">
                              <span>{user.nickname}</span>
                              <small>{user.username || `#${user.userId}`}</small>
                            </div>
                            {isSelf ? <span className="workspace-muted">你自己</span> : isFriend ? <span className="workspace-muted">已是好友</span> : (
                              <RowAction busy={actionKey === `friend-${user.userId}`} onClick={() => handleFriendRequest(user.userId)}>加好友</RowAction>
                            )}
                          </div>
                        );
                      }) : searchState === "ready" ? <EmptyLine>没有匹配用户</EmptyLine> : null}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">好友</div>
                    <div className="workspace-list">
                      {friends.length ? friends.map((friend) => (
                        <div key={friend.userId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{friend.nickname}</span>
                            <small>#{friend.userId}</small>
                          </div>
                          <RowAction kind="danger" busy={actionKey === `friend-delete-${friend.userId}`} onClick={() => handleDeleteFriend(friend.userId)}>移除</RowAction>
                        </div>
                      )) : <EmptyLine>暂无好友</EmptyLine>}
                    </div>
                  </section>
                </div>
                  ) : null}

                  {tab === "requests" ? (
                <div className="workspace-stack">
                  <section className="workspace-section">
                    <div className="workspace-section-title">收到的好友申请</div>
                    <div className="workspace-list">
                      {receivedFriendRequests.length ? receivedFriendRequests.map((request) => (
                        <div key={request.requestId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{request.peerNickname}</span>
                            <small>请求成为好友</small>
                          </div>
                          <div className="workspace-row-actions">
                            <RowAction busy={actionKey === `friend-request-${request.requestId}-accepted`} onClick={() => handleRespondFriend(request.requestId, "accepted")}>接受</RowAction>
                            <RowAction kind="danger" busy={actionKey === `friend-request-${request.requestId}-rejected`} onClick={() => handleRespondFriend(request.requestId, "rejected")}>忽略</RowAction>
                          </div>
                        </div>
                      )) : <EmptyLine>没有新的好友申请</EmptyLine>}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">已发申请</div>
                    <div className="workspace-list">
                      {sentFriendRequests.length ? sentFriendRequests.map((request) => (
                        <div key={request.requestId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{request.peerNickname}</span>
                            <small>等待对方回应</small>
                          </div>
                          <RowAction busy={actionKey === `friend-cancel-${request.requestId}`} onClick={() => handleCancelFriendRequest(request.requestId)}>撤回</RowAction>
                        </div>
                      )) : <EmptyLine>没有待回应的已发申请</EmptyLine>}
                    </div>
                  </section>
                </div>
                  ) : null}

                  {tab === "invitations" ? (
                <div className="workspace-stack">
                  <section className="workspace-section">
                    <div className="workspace-section-title">房间邀请</div>
                    <div className="workspace-list">
                      {receivedRoomInvitations.length ? receivedRoomInvitations.map((invitation) => (
                        <div key={invitation.invitationId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{invitation.roomName || `讨论室 ${invitation.roomId}`}</span>
                            <small>来自用户 #{invitation.inviterId}</small>
                          </div>
                          <div className="workspace-row-actions">
                            <RowAction busy={actionKey === `room-invitation-${invitation.invitationId}-accepted`} onClick={() => handleRespondRoomInvitation(invitation.invitationId, "accepted")}>加入</RowAction>
                            <RowAction kind="danger" busy={actionKey === `room-invitation-${invitation.invitationId}-rejected`} onClick={() => handleRespondRoomInvitation(invitation.invitationId, "rejected")}>忽略</RowAction>
                          </div>
                        </div>
                      )) : <EmptyLine>没有新的房间邀请</EmptyLine>}
                    </div>
                  </section>
                </div>
                  ) : null}

                  {tab === "settings" ? (
                <AccountSettings
                  isOpen={isOpen}
                  nickname={nickname}
                  username={username}
                  avatarUrl={avatarUrl}
                  onProfileUpdate={onProfileUpdate}
                  readOnly={readOnly}
                  onOpenDesignLab={onOpenDesignLab}
                  designLabLoading={designLabLoading}
                  designLabError={designLabError}
                />
                  ) : null}
                </div>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
