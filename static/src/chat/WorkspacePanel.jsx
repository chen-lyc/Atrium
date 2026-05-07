import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";
import {
  cancelFriendRequest,
  cancelRoomInvitation,
  createFriendRequest,
  createRoom,
  createConversation,
  createRoomInvitation,
  deleteFriend,
  deleteRoom,
  fetchFriendRequests,
  fetchFriends,
  fetchMyRoomInvitations,
  fetchRoomInvitations,
  fetchRoomMembers,
  getApiErrorMessage,
  removeRoomMember,
  renameRoom,
  respondFriendRequest,
  respondRoomInvitation,
  searchUsers,
  updateRoomMemberRole
} from "../utils.js";

const ROLE_LABELS = {
  0: "房主",
  1: "协管",
  2: "成员"
};
const MANAGER_ROLES = new Set([0, 1]);
const PANEL_AI_MODELS = ["DeepSeek", "Qwen"];

function getRoleLabel(role) {
  return ROLE_LABELS[Number(role)] || "成员";
}

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

function WorkspaceRoomBrief({ room, members, conversations }) {
  const discussionCount = conversations.length || 1;
  return (
    <section className={`workspace-room-brief is-${room?.tone || "personal"}`} aria-label="房间概览">
      <div className="workspace-brief-copy">
        <div className="workspace-brief-title">{room?.placeLabel || "讨论室"}</div>
        <p>{room?.atmosphere || "把讨论放在同一个空间里继续。"}</p>
      </div>
      <div className="workspace-brief-rail" aria-label="空间工作结构">
        <div>
          <span>讨论线</span>
          <strong>{discussionCount} 个对话</strong>
          <small>{members.length || 0} 位成员</small>
        </div>
        <div>
          <span>AI 模型</span>
          <strong>{PANEL_AI_MODELS.join(" · ")}</strong>
          <small>作为讨论能力保留在空间内</small>
        </div>
        <div>
          <span>知识沉淀</span>
          <strong>摘录 · 结论 · 索引</strong>
          <small>把聊天内容整理成可回看的材料</small>
        </div>
      </div>
    </section>
  );
}

export default function WorkspacePanel({
  isOpen,
  onClose,
  currentUserId = "",
  room = null,
  rooms = [],
  readOnly = false,
  onRoomsChanged = async () => {},
  onConversationSelect = () => {},
  onRoomSelect = () => {}
}) {
  const [tab, setTab] = useState("room");
  const [newRoomName, setNewRoomName] = useState("");
  const [newConversationTitle, setNewConversationTitle] = useState("");
  const [newConversationModel, setNewConversationModel] = useState("deepseek-v4-flash");
  const [renameValue, setRenameValue] = useState(room?.name || "");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [receivedFriendRequests, setReceivedFriendRequests] = useState([]);
  const [sentFriendRequests, setSentFriendRequests] = useState([]);
  const [receivedRoomInvitations, setReceivedRoomInvitations] = useState([]);
  const [roomInvitations, setRoomInvitations] = useState([]);
  const [panelState, setPanelState] = useState("idle");
  const [searchState, setSearchState] = useState("idle");
  const [actionKey, setActionKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const roomId = room?.roomId || 0;
  const normalizedCurrentUserId = String(currentUserId || "");
  const myMember = useMemo(
    () => members.find((member) => String(member.userId) === normalizedCurrentUserId) || null,
    [members, normalizedCurrentUserId]
  );
  const myRole = myMember ? Number(myMember.role) : null;
  const canManageRoom = myRole === 0;
  const canManageMembers = MANAGER_ROLES.has(myRole);
  const isBaseRoom = room?.id === "personal" || room?.id === "public" || room?.roomId === 1;
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.userId)), [friends]);
  const roomMemberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);

  useEffect(() => {
    setRenameValue(room?.name || "");
    setNotice("");
    setError("");
  }, [room?.roomId, room?.name]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    refreshPanel(controller.signal);
    return () => controller.abort();
  }, [isOpen, roomId]);

  async function refreshPanel(signal) {
    if (!roomId) return;
    setPanelState("loading");
    setError("");
    try {
      const [
        nextMembers,
        nextFriends,
        nextReceivedFriendRequests,
        nextSentFriendRequests,
        nextReceivedRoomInvitations,
        nextRoomInvitations
      ] = await Promise.all([
        fetchRoomMembers(roomId, signal),
        fetchFriends(signal),
        fetchFriendRequests("received", signal),
        fetchFriendRequests("sent", signal),
        fetchMyRoomInvitations("received", signal),
        fetchRoomInvitations(roomId, signal)
      ]);
      setMembers(nextMembers);
      setFriends(nextFriends);
      setReceivedFriendRequests(nextReceivedFriendRequests);
      setSentFriendRequests(nextSentFriendRequests);
      setReceivedRoomInvitations(nextReceivedRoomInvitations);
      setRoomInvitations(nextRoomInvitations);
      setPanelState("ready");
    } catch (err) {
      if (err?.name === "AbortError") return;
      setPanelState("error");
      setError(getApiErrorMessage(err, "空间信息加载失败"));
    }
  }

  async function runAction(key, action, successMessage = "", { refresh = true } = {}) {
    if (readOnly || actionKey) return;
    setActionKey(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (successMessage) setNotice(successMessage);
      if (refresh) await refreshPanel();
      return result;
    } catch (err) {
      setError(getApiErrorMessage(err));
      return null;
    } finally {
      setActionKey("");
    }
  }

  async function handleCreateRoom() {
    const name = newRoomName.trim();
    if (!name) {
      setError("请先给讨论室起名");
      return;
    }
    const created = await runAction("create-room", async () => createRoom(name), "讨论室已创建");
    if (created?.roomId) {
      setNewRoomName("");
      const nextRoom = await onRoomsChanged(created.roomId);
      if (nextRoom?.id) onRoomSelect(nextRoom.id);
    }
  }

  async function handleCreateConversation() {
    const title = newConversationTitle.trim();
    if (!title) {
      setError("请先给对话起名");
      return;
    }
    if (!roomId) return;
    const created = await runAction("create-conversation", async () => createConversation(roomId, title, newConversationModel), "新对话已创建");
    if (created?.conversationId) {
      setNewConversationTitle("");
      await onRoomsChanged(roomId);
      onConversationSelect(created.conversationId);
    }
  }

  async function handleRenameRoom() {
    const name = renameValue.trim();
    if (!roomId || !name || name === room?.name) return;
    await runAction("rename-room", async () => {
      await renameRoom(roomId, name);
      await onRoomsChanged(roomId);
    }, "房间名已更新");
  }

  async function handleDeleteRoom() {
    if (!roomId || isBaseRoom || !window.confirm("删除这个讨论室？")) return;
    await runAction("delete-room", async () => {
      await deleteRoom(roomId);
      await onRoomsChanged();
    }, "讨论室已删除", { refresh: false });
  }

  async function handleLeaveRoom() {
    if (!roomId || !currentUserId || isBaseRoom || !window.confirm("退出这个讨论室？")) return;
    await runAction("leave-room", async () => {
      await removeRoomMember(roomId, currentUserId);
      await onRoomsChanged();
    }, "已退出讨论室", { refresh: false });
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

  async function handleInviteFriend(userId) {
    await runAction(`invite-${userId}`, async () => {
      await createRoomInvitation(roomId, userId);
    }, "房间邀请已送出");
  }

  async function handleRespondRoomInvitation(invitationId, status) {
    await runAction(`room-invitation-${invitationId}-${status}`, async () => {
      await respondRoomInvitation(invitationId, status);
      if (status === "accepted") await onRoomsChanged();
    }, status === "accepted" ? "已加入讨论室" : "已忽略邀请");
  }

  async function handleCancelRoomInvitation(invitationId) {
    await runAction(`room-invitation-cancel-${invitationId}`, async () => {
      await cancelRoomInvitation(invitationId);
    }, "邀请已撤回");
  }

  async function handleMemberRole(member, role) {
    await runAction(`role-${member.userId}-${role}`, async () => {
      await updateRoomMemberRole(roomId, member.userId, role);
    }, "成员身份已更新");
  }

  async function handleRemoveMember(member) {
    await runAction(`remove-${member.userId}`, async () => {
      await removeRoomMember(roomId, member.userId);
    }, "成员已移出");
  }

  const inviteableFriends = friends.filter((friend) => !roomMemberIds.has(friend.userId));

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            className="workspace-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE }}
            onClick={onClose}
          />
          <motion.aside
            className="workspace-panel"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.22, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label="侧工作区"
            aria-labelledby="workspace-panel-title"
          >
            <header className="workspace-panel-header">
              <div>
                <div className="workspace-panel-kicker">侧工作区</div>
                <h2 id="workspace-panel-title">{room?.name || "空间"}</h2>
                <p className="workspace-panel-subtitle">{room?.placeLabel || "讨论室"} · 模型与沉淀入口</p>
              </div>
              <button type="button" className="workspace-close focus-ring" onClick={onClose} aria-label="关闭侧工作区">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <div className="workspace-tabs" role="tablist" aria-label="侧工作区分类">
              {[
                ["room", "空间"],
                ["members", "成员"],
                ["contacts", "联系人"]
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`workspace-tab ${tab === id ? "is-active" : ""}`}
                  onClick={() => setTab(id)}
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`workspace-panel-${id}`}
                  id={`workspace-tab-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {notice ? <div className="workspace-notice">{notice}</div> : null}
            {error ? <div className="workspace-error">{error}</div> : null}
            {panelState === "loading" ? <div className="workspace-loading">正在同步空间</div> : null}

            <div
              className="workspace-panel-body"
              role="tabpanel"
              id={`workspace-panel-${tab}`}
              aria-labelledby={`workspace-tab-${tab}`}
            >
              {tab === "room" ? (
                <div className="workspace-stack">
                  <WorkspaceRoomBrief
                    room={room}
                    members={members}
                    conversations={room?.conversations || []}
                  />

                  <section className="workspace-section">
                    <div className="workspace-section-title">新讨论室</div>
                    <div className="workspace-inline-form">
                      <input
                        className="workspace-input"
                        value={newRoomName}
                        onChange={(event) => setNewRoomName(event.target.value)}
                        placeholder="例如：项目复盘"
                        maxLength={32}
                        disabled={readOnly}
                      />
                      <RowAction kind="primary" busy={actionKey === "create-room"} disabled={readOnly} onClick={handleCreateRoom}>创建</RowAction>
                    </div>
                  </section>

                  {roomId && room?.type !== 0 ? (
                    <section className="workspace-section">
                      <div className="workspace-section-title">新对话</div>
                      <div className="workspace-inline-form">
                        <input
                          className="workspace-input"
                          value={newConversationTitle}
                          onChange={(event) => setNewConversationTitle(event.target.value)}
                          placeholder="例如：周报讨论"
                          maxLength={32}
                          disabled={readOnly}
                        />
                        <select
                          className="workspace-input"
                          value={newConversationModel}
                          onChange={(event) => setNewConversationModel(event.target.value)}
                          disabled={readOnly}
                        >
                          <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                          <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
                        </select>
                        <RowAction kind="primary" busy={actionKey === "create-conversation"} disabled={readOnly} onClick={handleCreateConversation}>创建</RowAction>
                      </div>
                    </section>
                  ) : null}

                  <section className="workspace-section">
                    <div className="workspace-section-title">当前房间</div>
                    <div className="workspace-inline-form">
                      <input
                        className="workspace-input"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        maxLength={32}
                        disabled={readOnly || !canManageRoom}
                      />
                      <RowAction busy={actionKey === "rename-room"} disabled={readOnly || !canManageRoom || renameValue.trim() === room?.name} onClick={handleRenameRoom}>保存</RowAction>
                    </div>
                    <div className="workspace-room-meta">
                      <span>{members.length || 0} 位成员</span>
                      <span>{roomInvitations.length || 0} 个待回应邀请</span>
                    </div>
                    {isBaseRoom ? null : (
                      <div className="workspace-danger-row">
                        {canManageRoom ? <RowAction kind="danger" busy={actionKey === "delete-room"} onClick={handleDeleteRoom}>删除房间</RowAction> : null}
                        {myRole !== 0 ? <RowAction kind="danger" busy={actionKey === "leave-room"} onClick={handleLeaveRoom}>退出房间</RowAction> : null}
                      </div>
                    )}
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">我的房间</div>
                    <div className="workspace-mini-list">
                      {rooms.map((item) => (
                        <button key={item.id} type="button" className={`workspace-mini-room ${item.id === room?.id ? "is-active" : ""}`} onClick={() => onRoomSelect(item.id)}>
                          <span>{item.name}</span>
                          <small>{item.note || "讨论室"}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "members" ? (
                <div className="workspace-stack">
                  <section className="workspace-section">
                    <div className="workspace-section-title">成员</div>
                    <div className="workspace-list">
                      {members.length ? members.map((member) => {
                        const isSelf = String(member.userId) === normalizedCurrentUserId;
                        const isOwner = Number(member.role) === 0;
                        return (
                          <div key={member.userId} className="workspace-row">
                            <div className="workspace-row-main">
                              <span>{member.nickname}</span>
                              <small>{getRoleLabel(member.role)} · #{member.userId}</small>
                            </div>
                            {canManageMembers && !isSelf && !isOwner ? (
                              <div className="workspace-row-actions">
                                {canManageRoom ? (
                                  <RowAction busy={actionKey === `role-${member.userId}-${Number(member.role) === 1 ? 2 : 1}`} onClick={() => handleMemberRole(member, Number(member.role) === 1 ? 2 : 1)}>
                                    {Number(member.role) === 1 ? "设为成员" : "设为协管"}
                                  </RowAction>
                                ) : null}
                                <RowAction kind="danger" busy={actionKey === `remove-${member.userId}`} onClick={() => handleRemoveMember(member)}>移出</RowAction>
                              </div>
                            ) : null}
                          </div>
                        );
                      }) : <EmptyLine>暂无成员数据</EmptyLine>}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">邀请好友</div>
                    <div className="workspace-list">
                      {inviteableFriends.length ? inviteableFriends.map((friend) => (
                        <div key={friend.userId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{friend.nickname}</span>
                            <small>#{friend.userId}</small>
                          </div>
                          <RowAction busy={actionKey === `invite-${friend.userId}`} disabled={!roomId} onClick={() => handleInviteFriend(friend.userId)}>邀请</RowAction>
                        </div>
                      )) : <EmptyLine>没有可邀请的好友</EmptyLine>}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">已发房间邀请</div>
                    <div className="workspace-list">
                      {roomInvitations.length ? roomInvitations.map((invitation) => (
                        <div key={invitation.invitationId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{invitation.inviteeNickname || `用户 ${invitation.inviteeId}`}</span>
                            <small>等待回应</small>
                          </div>
                          <RowAction busy={actionKey === `room-invitation-cancel-${invitation.invitationId}`} onClick={() => handleCancelRoomInvitation(invitation.invitationId)}>撤回</RowAction>
                        </div>
                      )) : <EmptyLine>没有待回应的房间邀请</EmptyLine>}
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "contacts" ? (
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

                  <section className="workspace-section">
                    <div className="workspace-section-title">好友请求</div>
                    <div className="workspace-list">
                      {receivedFriendRequests.map((request) => (
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
                      ))}
                      {sentFriendRequests.map((request) => (
                        <div key={request.requestId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{request.peerNickname}</span>
                            <small>等待对方回应</small>
                          </div>
                          <RowAction busy={actionKey === `friend-cancel-${request.requestId}`} onClick={() => handleCancelFriendRequest(request.requestId)}>撤回</RowAction>
                        </div>
                      ))}
                      {!receivedFriendRequests.length && !sentFriendRequests.length ? <EmptyLine>没有待处理好友请求</EmptyLine> : null}
                    </div>
                  </section>

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
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
