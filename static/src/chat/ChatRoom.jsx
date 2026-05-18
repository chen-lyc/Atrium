import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE, MESSAGE_TYPE, STATUS_LABEL } from "../constants.js";
import {
  createRoom,
  fetchFriendRequests,
  fetchMyRoomInvitations,
  fetchRoomMembers,
  getApiErrorMessage,
  getThinkingModeLabel,
  renameConversation,
  syncRoomAiMembers
} from "../utils.js";
import Sidebar from "./Sidebar.jsx";
import MessageList from "./MessageList.jsx";
import MessageInput from "./MessageInput.jsx";
import MessageFlight from "./MessageFlight.jsx";
import AccountCenterPanel from "./AccountCenterPanel.jsx";
import WorkspacePanel from "./WorkspacePanel.jsx";
import {
  AiModelSelector,
  AiSeatStrip,
  ModalLayer,
  getAiAvatarUrl,
  getAiMemberName,
  mergeAiMemberOptions
} from "./AiTeamEditor.jsx";

const NOTE_TOAST_MS = 2200;
const CHAT_SURFACE_STORAGE_KEY = "atrium.chat.surface";
const HOME_VISIT_STATS_STORAGE_KEY = "atrium.home.visitStats.v1";
const HOME_MEMORY_ANCHOR_PAGE_LIMIT = 36;
const HOME_MEMORY_ANCHOR_MAX_PAGES = 3;
const HOME_MEMORY_ANCHOR_LIMIT = 2;
const HOME_PATH_LIMIT = 5;
const HOME_PATH_RECENT_MS = 3 * 24 * 60 * 60 * 1000;
const HOME_SPACE_RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const HOME_RECALL_TRACE_LIMIT = 112;
const AI_NO_REPLY_TOKEN = "<NO_REPLY>";
const HOME_RECALL_HIGHLIGHT_PATTERN = /(DeepSeek|Qwen|Claude|GPT-?4o?|prompt|WebSocket|Redis|MySQL|Home|AI|bug|TODO|\/api\/[^\s，。；;]+|[A-Za-z0-9_-]+\.(?:jsx|js|cpp|h|css|md)|错误|问题|方案|实现|架构|模型|摘要)/i;
const HOME_RECALL_SPLIT_PATTERN = /(DeepSeek|Qwen|Claude|GPT-?4o?|prompt|WebSocket|Redis|MySQL|Home|AI|bug|TODO|\/api\/[^\s，。；;]+|[A-Za-z0-9_-]+\.(?:jsx|js|cpp|h|css|md)|错误|问题|方案|实现|架构|模型|摘要)/gi;
const LOW_SIGNAL_HOME_ANCHOR_TEXTS = new Set([
  "hi",
  "hello",
  "ok",
  "okay",
  "test",
  "你好",
  "您好",
  "哈喽",
  "在吗",
  "好",
  "好的",
  "可以",
  "行",
  "嗯",
  "嗯嗯",
  "啊",
  "哦",
  "收到",
  "谢谢",
  "谢了",
  "继续",
  "测试"
]);
const ROLE_LABELS = {
  0: "房主",
  1: "管理员",
  2: "成员"
};
const MAIN_SEATLINE_MEMBER_LIMIT = 5;
const MAIN_SEATLINE_AI_LIMIT = 5;
const SIDEBAR_SURFACE_HOME = "home";
const SIDEBAR_SURFACE_DEFAULT = "default";

function readStoredChatSurface() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_SURFACE_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredChatSurface(nextSurface) {
  try {
    const current = readStoredChatSurface();
    window.localStorage.setItem(CHAT_SURFACE_STORAGE_KEY, JSON.stringify({ ...current, ...nextSurface }));
  } catch {
    // UI position persistence is best-effort only.
  }
}

function getHomeVisitStorageKey(currentUserId = "") {
  const userKey = String(currentUserId || "anonymous").trim() || "anonymous";
  return `${HOME_VISIT_STATS_STORAGE_KEY}:${userKey}`;
}

function readStoredHomeVisitStats(currentUserId = "") {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getHomeVisitStorageKey(currentUserId)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredHomeVisitStats(currentUserId = "", nextStats = {}) {
  try {
    window.localStorage.setItem(getHomeVisitStorageKey(currentUserId), JSON.stringify(nextStats));
  } catch {
    // Visit tracking is a replaceable frontend-only stand-in for future backend fields.
  }
}

function getHomeObjectKey(roomId, conversationId) {
  return `${roomId || "room"}:${Number(conversationId) || 0}`;
}

function normalizeHomeVisitTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      const numericValue = Number(trimmedValue);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
      }
    }
    const parsedValue = Date.parse(trimmedValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
  }
  return 0;
}

function normalizeHomeVisitCount(value) {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function HeaderStatus({ modelLabel, connectionState }) {
  const connectionLabel = STATUS_LABEL[connectionState] || STATUS_LABEL.idle;
  const resolvedModel = modelLabel || "未绑定 AI";
  return (
    <span
      className={`room-connection-signal is-${connectionState}`}
      aria-label={`${resolvedModel} · ${connectionLabel}`}
      title={`${resolvedModel} · ${connectionLabel}`}
    >
      <span aria-hidden="true" />
    </span>
  );
}

function getRoleLabel(role) {
  return ROLE_LABELS[Number(role)] || "成员";
}

function getMemberInitial(member) {
  const source = member?.nickname || member?.username || "用";
  return String(source).trim().slice(0, 1) || "用";
}

function getVisibleMemberCount(room, members) {
  const rawCount = Number(room?.memberCount ?? room?.member_count ?? room?.membersCount ?? room?.members_count);
  const normalizedCount = Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : 0;
  return Math.max(normalizedCount, members.length);
}

function getDefaultSidebarCollapsed(sidebarSurface) {
  return sidebarSurface === SIDEBAR_SURFACE_HOME;
}

function RoomMemberAvatar({ member, currentUserId = "" }) {
  const isSelf = currentUserId && String(member?.userId) === String(currentUserId);
  const avatar = member?.avatarUrl || member?.avatar_url || "";
  return (
    <span className={`main-seatline-avatar ${isSelf ? "is-self" : ""}`}>
      {avatar ? <img src={avatar} alt="" /> : <span>{getMemberInitial(member)}</span>}
    </span>
  );
}

function MainConversationSeatline({
  room,
  members = [],
  membersState = "idle",
  currentUserId = "",
  fallbackMember,
  aiMembers = [],
  thinkingAdapters = [],
  compact = false,
  onOpenMembers = () => {},
  onOpenAi = () => {}
}) {
  const resolvedMembers = members.length ? members : fallbackMember ? [fallbackMember] : [];
  const visibleMembers = resolvedMembers.slice(0, MAIN_SEATLINE_MEMBER_LIMIT);
  const memberCount = getVisibleMemberCount(room, resolvedMembers);
  const remainingMembers = Math.max(memberCount - visibleMembers.length, 0);
  const visibleAiMembers = aiMembers.slice(0, MAIN_SEATLINE_AI_LIMIT);
  const remainingAi = Math.max(aiMembers.length - visibleAiMembers.length, 0);
  const loadLabel = membersState === "loading" && !members.length ? "同步中" : "";

  return (
    <section className={`main-seatline ${compact ? "is-compact" : "is-open"}`} aria-label="主对话成员席位">
      <div className="main-seatline-scroll">
        <div className="main-seatline-group is-members">
          {visibleMembers.map((member) => {
            const isSelf = currentUserId && String(member.userId) === String(currentUserId);
            return (
              <button
                key={member.userId || member.nickname}
                type="button"
                className={`main-seatline-member focus-ring ${isSelf ? "is-self" : ""}`}
                onClick={onOpenMembers}
                title={`${member.nickname || member.username || "成员"} · ${getRoleLabel(member.role)}`}
              >
                <RoomMemberAvatar member={member} currentUserId={currentUserId} />
                <span className="main-seatline-copy">
                  <span>{isSelf ? "我" : member.nickname || member.username || "成员"}</span>
                  <small>{getRoleLabel(member.role)}</small>
                </span>
              </button>
            );
          })}
          {remainingMembers > 0 ? (
            <button type="button" className="main-seatline-more focus-ring" onClick={onOpenMembers}>
              +{remainingMembers}
              <small>成员</small>
            </button>
          ) : loadLabel ? (
            <span className="main-seatline-loading">{loadLabel}</span>
          ) : null}
        </div>

        <div className="main-seatline-divider" aria-hidden="true" />

        <div className="main-seatline-group is-ai">
          {visibleAiMembers.length ? (
            <AiSeatStrip
              members={visibleAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={true}
              onChange={async () => visibleAiMembers}
              onSeatAction={onOpenAi}
              showHoverSummary={true}
              showLabels={true}
              emptyText=""
              className="is-main-seatline"
            />
          ) : (
            <button type="button" className="main-seatline-empty-ai focus-ring" onClick={onOpenAi}>
              <span>无 AI</span>
              <small>房间阵容</small>
            </button>
          )}
          {remainingAi > 0 ? (
            <button type="button" className="main-seatline-more is-ai focus-ring" onClick={onOpenAi}>
              +{remainingAi}
              <small>AI</small>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MainConversationCover({ roomPlaceLabel, title, topic, aiMembers = [], onOpenAi = () => {} }) {
  const aiSummary = aiMembers.length
    ? `${aiMembers.length} 位 AI 保持沉默席位`
    : "房间 AI 阵容为空";
  return (
    <div className="main-conversation-cover">
      <div className="main-cover-kicker">{roomPlaceLabel}</div>
      <h2>{title}</h2>
      <p>{topic}</p>
      <button type="button" className="main-cover-ai-summary focus-ring" onClick={onOpenAi}>
        <span>{aiSummary}</span>
      </button>
    </div>
  );
}

function getMentionQuery(value) {
  const match = String(value || "").match(/(^|\s)@([^\s@]*)$/);
  return match ? match[2].trim().toLowerCase() : null;
}

function MainConversationMentionReserve({ query = "", aiMembers = [], onPick = () => {} }) {
  const normalizedQuery = String(query || "").toLowerCase();
  const matches = aiMembers
    .filter((member) => getAiMemberName(member).toLowerCase().includes(normalizedQuery))
    .slice(0, 5);
  if (!matches.length) return null;

  return (
    <div className="main-mention-reserve" aria-label="@AI">
      {matches.map((member) => (
        <button
          key={member.aiId}
          type="button"
          className="main-mention-chip focus-ring"
          onClick={() => onPick(member)}
        >
          <img src={getAiAvatarUrl(member)} alt="" />
          <span>{getAiMemberName(member)}</span>
          <small>{getThinkingModeLabel(member)}</small>
        </button>
      ))}
    </div>
  );
}

function formatHomeTimestamp(timestamp) {
  if (!timestamp) return "刚刚";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "最近";
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= 0 && diff < minute) return "刚刚";
  if (diff >= 0 && diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff >= 0 && diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff >= 0 && diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getConversationActivityMs(conversation) {
  return Number(conversation?.lastActivityAtMs || conversation?.updatedAtMs || conversation?.createdAtMs || 0);
}

function normalizeHomeMemoryAnchorTextValue(value) {
  const text = String(value || "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "图片")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === AI_NO_REPLY_TOKEN) return "";
  return text;
}

function getCompactHomeAnchorText(text) {
  return String(text || "")
    .replace(/[。.!！?？~～,，、;；:："'“”‘’()[\]{}<>《》\s…]+/g, "")
    .toLowerCase();
}

function isLowSignalHomeMemoryAnchor(text) {
  const compactText = getCompactHomeAnchorText(text);
  if (!compactText || compactText.length <= 1) return true;
  if (LOW_SIGNAL_HOME_ANCHOR_TEXTS.has(compactText)) return true;
  return compactText.length <= 4 && /^[嗯啊哦好行是对不可以了]+$/.test(compactText);
}

function isMeaningfulHomeMemoryAnchorText(text) {
  const normalizedText = normalizeHomeMemoryAnchorTextValue(text);
  return Boolean(normalizedText && !isLowSignalHomeMemoryAnchor(normalizedText));
}

function getConversationFallbackMemoryAnchors(conversation) {
  const lastMessagePreview = normalizeHomeMemoryAnchorTextValue(conversation?.lastMessagePreview);
  return isMeaningfulHomeMemoryAnchorText(lastMessagePreview) ? [lastMessagePreview] : [];
}

function getConversationVisitStats(conversation) {
  return {
    lastVisitedAtMs: normalizeHomeVisitTimestamp(
      conversation?.lastVisitedAtMs ??
      conversation?.last_visited_at_ms ??
      conversation?.last_visited_at ??
      conversation?.lastVisitedAt
    ),
    visitCount: normalizeHomeVisitCount(conversation?.visitCount ?? conversation?.visit_count)
  };
}

function getHomeThinkingObjectEntries(rooms = [], homeRoom = null) {
  const homeRoomId = homeRoom?.id;
  const homeMainConversationId = homeRoom?.mainConversationId || homeRoom?.conversationId || 0;
  return rooms
    .flatMap((item) => {
      const mainConversationId = item?.mainConversationId || item?.conversationId || 0;
      return (item?.conversations || []).map((conversation) => {
        const isRoomTimeline = conversation.id === mainConversationId || conversation.isMain === true;
        return {
          objectKey: getHomeObjectKey(item.id, conversation.id),
          conversationId: conversation.id,
          roomId: item.id,
          backendRoomId: item.roomId,
          roomName: item.name,
          roomType: item.type,
          roomTone: item.tone,
          isRoomTimeline,
          workingLabel: isRoomTimeline
            ? item.id === homeRoomId ? "Home" : `${item.name || "房间"} · 公共时间线`
            : conversation.name || `思考对象 ${conversation.id}`,
          fallbackAnchors: getConversationFallbackMemoryAnchors(conversation),
          backendVisit: getConversationVisitStats(conversation),
          activityMs: getConversationActivityMs(conversation) || conversation.id
        };
      });
    })
    .filter((thinkingObject) => !(thinkingObject.roomId === homeRoomId && thinkingObject.conversationId === homeMainConversationId))
    .sort((a, b) => (b.activityMs || 0) - (a.activityMs || 0) || b.conversationId - a.conversationId);
}

function normalizeHomeMessageText(message) {
  const value =
    message?.content ??
    message?.text ??
    message?.message ??
    message?.body ??
    message?.payload?.content ??
    "";
  return normalizeHomeMemoryAnchorTextValue(value);
}

function normalizeHomeMessageTimestamp(message) {
  const value = message?.send_time_ms ?? message?.sendTimeMs ?? message?.timestamp ?? message?.created_at_ms ?? message?.createdAtMs ?? message?.created_at ?? message?.createdAt;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      const numericValue = Number(trimmedValue);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
      }
    }
    const parsedValue = Date.parse(trimmedValue);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
  }
  return 0;
}

function normalizeHomeMessageId(message) {
  const value = Number(message?.id ?? message?.message_id ?? message?.messageId ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizeHomeMessageUserId(message) {
  const value = message?.user_id ?? message?.userId ?? message?.send_id ?? message?.sendId ?? message?.sender_id ?? message?.senderId;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function isHomeSystemMessage(message) {
  const messageType = Number(message?.message_type ?? message?.messageType ?? message?.type ?? 0);
  const senderType = String(message?.sender_type ?? message?.senderType ?? message?.participant_type ?? message?.participantType ?? "").toLowerCase();
  const role = String(message?.role ?? message?.message_role ?? message?.messageRole ?? "").toLowerCase();
  return messageType === MESSAGE_TYPE.SYSTEM || senderType === "system" || role === "system";
}

function isHomeAiMessage(message) {
  const senderType = String(message?.sender_type ?? message?.senderType ?? message?.participant_type ?? message?.participantType ?? "").toLowerCase();
  const role = String(message?.role ?? message?.message_role ?? message?.messageRole ?? "").toLowerCase();
  return Boolean(
    senderType === "ai" ||
    senderType === "assistant" ||
    role === "ai" ||
    role === "assistant" ||
    message?.ai_id ||
    message?.aiId ||
    message?.model ||
    message?.provider
  );
}

function getHomeMemoryAnchorSignalScore(text) {
  let score = 0;
  const textLength = Array.from(text || "").length;
  score += Math.min(5, Math.floor(textLength / 18));
  if (textLength >= 10) score += 1;
  if (/[?？]/.test(text)) score += 2;
  if (/(```|`|=>|::|\/api|bug|todo|fix|错误|问题|方案|实现|架构|内存|算法|旅行|计划|对比|结论|设计|后端|前端|模型|摘要)/i.test(text)) score += 2;
  return score;
}

function toHomeMemoryAnchorCandidates(messages = [], currentUserId = "") {
  const normalizedCurrentUserId = String(currentUserId || "").trim();
  return messages
    .map((message) => {
      const text = normalizeHomeMessageText(message);
      if (!text || isHomeSystemMessage(message) || !isMeaningfulHomeMemoryAnchorText(text)) return null;
      const userId = normalizeHomeMessageUserId(message);
      const isAi = isHomeAiMessage(message);
      const isOwnUser = Boolean(normalizedCurrentUserId && userId && userId === normalizedCurrentUserId && !isAi);
      const isHuman = !isAi;
      return {
        text,
        id: normalizeHomeMessageId(message),
        timestamp: normalizeHomeMessageTimestamp(message),
        isAi,
        isOwnUser,
        isHuman,
        score: getHomeMemoryAnchorSignalScore(text) + (isOwnUser ? 4 : isHuman ? 2 : 1)
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp || b.id - a.id);
}

function selectHomeAnchorTexts(candidates = [], {
  limit = HOME_MEMORY_ANCHOR_LIMIT,
  filter = () => true,
  sort = "score"
} = {}) {
  const seen = new Set();
  return candidates
    .slice()
    .filter(filter)
    .sort((a, b) => {
      if (sort === "recent") return b.timestamp - a.timestamp || b.score - a.score || b.id - a.id;
      return b.score - a.score || b.timestamp - a.timestamp || b.id - a.id;
    })
    .filter((candidate) => {
      const compactText = getCompactHomeAnchorText(candidate.text);
      if (!compactText || seen.has(compactText)) return false;
      seen.add(compactText);
      return true;
    })
    .slice(0, limit)
    .map((candidate) => candidate.text);
}

function selectHomeMemoryAnchors(candidates = []) {
  return selectHomeAnchorTexts(candidates);
}

function buildHomeAnchorBundle(candidates = []) {
  return {
    anchors: selectHomeMemoryAnchors(candidates),
    userAnchors: selectHomeAnchorTexts(candidates, { filter: (candidate) => !candidate.isAi }),
    aiAnchors: selectHomeAnchorTexts(candidates, { filter: (candidate) => candidate.isAi }),
    recentAnchors: selectHomeAnchorTexts(candidates, { sort: "recent" })
  };
}

function getHomeMemoryAnchorCursor(messages = []) {
  const candidates = messages
    .map((message) => ({
      id: normalizeHomeMessageId(message),
      timestamp: normalizeHomeMessageTimestamp(message)
    }))
    .filter((message) => message.id && message.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  const oldest = candidates[0];
  return oldest ? { before_time: String(oldest.timestamp), before_id: String(oldest.id) } : null;
}

async function fetchHomeThinkingObjectAnchors(conversationId, currentUserId = "", signal) {
  let cursor = null;
  const collectedCandidates = [];
  for (let page = 0; page < HOME_MEMORY_ANCHOR_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("limit", String(HOME_MEMORY_ANCHOR_PAGE_LIMIT));
    if (cursor) {
      params.set("before_time", cursor.before_time);
      params.set("before_id", cursor.before_id);
    }
    const response = await fetch(`/api/conversations/${conversationId}/messages?${params.toString()}`, {
      method: "GET",
      credentials: "include",
      signal
    });
    if (!response.ok) return buildHomeAnchorBundle(collectedCandidates);
    const data = await response.json();
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    collectedCandidates.push(...toHomeMemoryAnchorCandidates(messages, currentUserId));
    const selectedAnchors = selectHomeMemoryAnchors(collectedCandidates);
    if (selectedAnchors.length >= HOME_MEMORY_ANCHOR_LIMIT) return buildHomeAnchorBundle(collectedCandidates);
    if (!data?.has_more || !messages.length) break;
    cursor = getHomeMemoryAnchorCursor(messages);
    if (!cursor) break;
  }
  return buildHomeAnchorBundle(collectedCandidates);
}

function getStableHomeHash(value) {
  const source = String(value || "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function isLikelyTestingThinkingObject(thinkingObject, memoryAnchors = []) {
  const label = getCompactHomeAnchorText(thinkingObject?.workingLabel || "");
  const roomName = getCompactHomeAnchorText(thinkingObject?.roomName || "");
  const anchorText = getCompactHomeAnchorText(memoryAnchors.join(" "));
  if (!memoryAnchors.length) return true;
  return Boolean(
    /^(test|test\d+|测试|新建对话测试\d*|createtest)$/.test(label) ||
    /test|测试/.test(label) && !/(方案|实现|算法|模型|旅行|设计|架构|内存|问题)/.test(anchorText) ||
    /test|测试/.test(roomName) && !anchorText
  );
}

function resolveHomeThinkingObjectVisit(thinkingObject, storedVisit = {}, memoryAnchors = [], index = 0) {
  const backendLastVisitedAtMs = thinkingObject.backendVisit?.lastVisitedAtMs || 0;
  const backendVisitCount = thinkingObject.backendVisit?.visitCount || 0;
  const storedLastVisitedAtMs = normalizeHomeVisitTimestamp(storedVisit?.lastVisitedAtMs);
  const storedVisitCount = normalizeHomeVisitCount(storedVisit?.visitCount);
  const hasRealVisit = Boolean(backendLastVisitedAtMs || backendVisitCount || storedLastVisitedAtMs || storedVisitCount);
  if (hasRealVisit) {
    return {
      lastVisitedAtMs: Math.max(backendLastVisitedAtMs, storedLastVisitedAtMs),
      visitCount: Math.max(backendVisitCount, storedVisitCount),
      source: storedLastVisitedAtMs || storedVisitCount ? "local" : "backend"
    };
  }

  const now = Date.now();
  const stableHash = getStableHomeHash(`${thinkingObject.objectKey}:${thinkingObject.workingLabel}:${index}`);
  if (isLikelyTestingThinkingObject(thinkingObject, memoryAnchors)) {
    return {
      lastVisitedAtMs: now - (38 + stableHash % 42) * 24 * 60 * 60 * 1000,
      visitCount: stableHash % 2,
      source: "mock"
    };
  }

  const mockDays = [1, 2, 4, 8, 14, 24];
  return {
    lastVisitedAtMs: now - mockDays[stableHash % mockDays.length] * 24 * 60 * 60 * 1000,
    visitCount: 1 + (stableHash % 4),
    source: "mock"
  };
}

function getHomeThinkingObjectScore(thinkingObject) {
  const visit = thinkingObject.visit || {};
  const now = Date.now();
  const ageMs = visit.lastVisitedAtMs ? now - visit.lastVisitedAtMs : Number.POSITIVE_INFINITY;
  const recencyScore = Number.isFinite(ageMs) ? Math.max(0, HOME_SPACE_RECENT_MS - ageMs) / HOME_SPACE_RECENT_MS : 0;
  return recencyScore * 10 + (visit.visitCount || 0) * 2 + (thinkingObject.hasMemoryAnchors ? 2 : 0);
}

function buildHomeThinkingObjectSections(thinkingObjects = []) {
  const now = Date.now();
  const rankedObjects = thinkingObjects
    .slice()
    .sort((a, b) => getHomeThinkingObjectScore(b) - getHomeThinkingObjectScore(a) || b.conversationId - a.conversationId);

  const pathCandidates = rankedObjects.filter((thinkingObject) => {
    const visit = thinkingObject.visit || {};
    const ageMs = visit.lastVisitedAtMs ? now - visit.lastVisitedAtMs : Number.POSITIVE_INFINITY;
    return thinkingObject.hasMemoryAnchors &&
      !thinkingObject.isTestingObject &&
      (ageMs <= HOME_PATH_RECENT_MS || (visit.visitCount || 0) >= 3);
  });
  const path = pathCandidates.slice(0, HOME_PATH_LIMIT);
  const pathKeys = new Set(path.map((thinkingObject) => thinkingObject.objectKey));

  const sameSpace = rankedObjects.filter((thinkingObject) => {
    if (pathKeys.has(thinkingObject.objectKey)) return false;
    if (thinkingObject.isTestingObject && (thinkingObject.visit?.visitCount || 0) <= 1) return false;
    const visit = thinkingObject.visit || {};
    const ageMs = visit.lastVisitedAtMs ? now - visit.lastVisitedAtMs : Number.POSITIVE_INFINITY;
    return Boolean((visit.visitCount || 0) > 0 || ageMs <= HOME_SPACE_RECENT_MS);
  });
  const sameSpaceKeys = new Set(sameSpace.map((thinkingObject) => thinkingObject.objectKey));

  const storage = rankedObjects.filter((thinkingObject) => !pathKeys.has(thinkingObject.objectKey) && !sameSpaceKeys.has(thinkingObject.objectKey));
  return { path, sameSpace, storage };
}

function formatHomeVisitMeta(thinkingObject) {
  const visit = thinkingObject?.visit || {};
  const lastVisited = visit.lastVisitedAtMs ? `上次打开 ${formatHomeTimestamp(visit.lastVisitedAtMs)}` : "尚未主动打开";
  const count = visit.visitCount ? `回访 ${visit.visitCount} 次` : "";
  return count ? `${lastVisited} · ${count}` : lastVisited;
}

function getHomeVisitProperties(thinkingObject) {
  const visit = thinkingObject?.visit || {};
  const properties = [];
  if (thinkingObject?.roomName) properties.push(thinkingObject.roomName);
  properties.push(visit.lastVisitedAtMs ? `${formatHomeTimestamp(visit.lastVisitedAtMs)}打开` : "未主动打开");
  if (visit.visitCount) properties.push(`${visit.visitCount} 次回访`);
  return properties;
}

function getHomeObjectStateLabel(thinkingObject, members = [], { isWarmest = false } = {}) {
  const visit = thinkingObject?.visit || {};
  const visitCount = normalizeHomeVisitCount(visit.visitCount);
  const lastVisitedAtMs = normalizeHomeVisitTimestamp(visit.lastVisitedAtMs);
  const ageMs = lastVisitedAtMs ? Date.now() - lastVisitedAtMs : Number.POSITIVE_INFINITY;
  if (!thinkingObject?.hasMemoryAnchors) return "内容还少";
  if (isWarmest && ageMs <= 24 * 60 * 60 * 1000) return "刚停在这里";
  if (isWarmest) return "最近停在这里";
  if (ageMs <= 24 * 60 * 60 * 1000) return "今天回访";
  if (visitCount >= 3) return "反复回访";
  if (members.length > 1) return "多 AI 参与";
  if (members.length === 1) return "单 AI 陪同";
  return "有痕迹";
}

function getHomeObjectCardClass(thinkingObject, members = [], { isWarmest = false } = {}) {
  const classNames = [];
  if (members.length > 1) classNames.push("is-multi-ai");
  else if (members.length === 1) classNames.push("is-single-ai");
  else classNames.push("is-no-ai");
  if (isWarmest) classNames.push("is-warmest");
  if ((thinkingObject?.visit?.visitCount || 0) >= 3) classNames.push("is-returning");
  if (!thinkingObject?.hasMemoryAnchors) classNames.push("is-quiet");
  return classNames.join(" ");
}

function truncateHomeRecallTrace(text, limit = HOME_RECALL_TRACE_LIMIT) {
  const chars = Array.from(text || "");
  if (chars.length <= limit) return text;
  return `${chars.slice(0, limit).join("").trim()}...`;
}

function normalizeHomeRecallTraceSource(value) {
  return normalizeHomeMemoryAnchorTextValue(value)
    .replace(/```[\s\S]*?```/g, "代码片段")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^\s*(?:\[\d+][,，：:\s]*)+/g, "")
    .replace(/(^|\s)>+\s?/g, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreHomeRecallTrace(text) {
  const length = Array.from(text || "").length;
  let score = 0;
  if (length >= 12 && length <= 140) score += 4;
  if (length > 220) score -= 4;
  if (/[?？]/.test(text)) score += 3;
  if (/(我|我们|需要|为什么|怎么|如何|设计|问题|修正|实现|决定)/.test(text)) score += 2;
  if (/^(原因|首先|其次|总结|结论|直接回答你|这个问题很关键)/.test(text)) score -= 3;
  if (/代码片段|错误栈|Traceback|Exception/.test(text)) score -= 2;
  return score;
}

function getHomeRecallTrace(memoryAnchors = []) {
  const candidates = memoryAnchors
    .map((anchor) => normalizeHomeRecallTraceSource(anchor))
    .filter(Boolean)
    .sort((a, b) => scoreHomeRecallTrace(b) - scoreHomeRecallTrace(a));
  const text = candidates[0] || "";
  return text ? truncateHomeRecallTrace(text) : "还没有清晰的内容痕迹";
}

function renderHomeRecallTrace(text, objectKey) {
  const parts = String(text || "").split(HOME_RECALL_SPLIT_PATTERN).filter(Boolean);
  let emphasisCount = 0;
  return parts.map((part, index) => {
    const shouldEmphasize = emphasisCount < 3 && HOME_RECALL_HIGHLIGHT_PATTERN.test(part);
    if (shouldEmphasize) emphasisCount += 1;
    return (
      <span
        className={shouldEmphasize ? "home-recall-emphasis" : undefined}
        key={`${objectKey}-recall-${index}`}
      >
        {part}
      </span>
    );
  });
}

function HomeAiStack({ members = [], quiet = false }) {
  if (quiet) {
    return members.length ? <span className="home-ai-quiet">{members.length} 位 AI</span> : null;
  }
  const visibleMembers = members.slice(0, 3);
  if (!visibleMembers.length) {
    return <span className="home-ai-empty">无 AI</span>;
  }
  return (
    <span className="home-ai-cluster" aria-label={`${members.length} 位 AI`}>
      <span className="home-ai-stack">
        {visibleMembers.map((member) => (
          <span className="home-ai-avatar" key={member.aiId || member.id} title={getAiMemberName(member)}>
            <img src={getAiAvatarUrl(member)} alt="" />
          </span>
        ))}
      </span>
      <span className="home-ai-count">{members.length} 位 AI</span>
    </span>
  );
}

function HomePathObjectCard({
  thinkingObject,
  members = [],
  index = 0,
  isActive = false,
  isWarmest = false,
  onPreview = () => {},
  onOpen = () => {}
}) {
  const recallTrace = getHomeRecallTrace(thinkingObject.userMemoryAnchors || thinkingObject.memoryAnchors);
  const properties = getHomeVisitProperties(thinkingObject);
  return (
    <motion.button
      type="button"
      className={`home-path-card focus-ring ${getHomeObjectCardClass(thinkingObject, members, { isWarmest })} ${isActive ? "is-active" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.085, 0.36), duration: 0.28, ease: EASE }}
      onMouseEnter={() => onPreview(thinkingObject.objectKey)}
      onFocus={() => onPreview(thinkingObject.objectKey)}
      onClick={() => onOpen(thinkingObject.roomId, thinkingObject.conversationId)}
    >
      <span className="home-card-state">{getHomeObjectStateLabel(thinkingObject, members, { isWarmest })}</span>
      <span className="home-card-title">{thinkingObject.workingLabel}</span>
      <span className={`home-recall-line ${thinkingObject.hasMemoryAnchors ? "" : "is-empty"}`}>
        {renderHomeRecallTrace(recallTrace, thinkingObject.objectKey)}
      </span>
      <span className="home-property-row">
        {properties.map((property) => (
          <span key={`${thinkingObject.objectKey}-${property}`}>{property}</span>
        ))}
        <HomeAiStack members={members} quiet />
      </span>
    </motion.button>
  );
}

function HomeCompactObjectRow({ thinkingObject, isActive = false, onPreview = () => {}, onOpen = () => {} }) {
  return (
    <button
      type="button"
      className={`home-compact-row focus-ring ${isActive ? "is-active" : ""}`}
      onMouseEnter={() => onPreview(thinkingObject.objectKey)}
      onFocus={() => onPreview(thinkingObject.objectKey)}
      onClick={() => onOpen(thinkingObject.roomId, thinkingObject.conversationId)}
    >
      <span className="home-compact-title">{thinkingObject.workingLabel}</span>
      <span className="home-compact-meta">
        <span>{thinkingObject.roomName || "房间"}</span>
        <time>{formatHomeVisitMeta(thinkingObject)}</time>
      </span>
    </button>
  );
}

function HomeStorageRow({ thinkingObject, isActive = false, onPreview = () => {}, onOpen = () => {} }) {
  return (
    <button
      type="button"
      className={`home-storage-row focus-ring ${isActive ? "is-active" : ""}`}
      onMouseEnter={() => onPreview(thinkingObject.objectKey)}
      onFocus={() => onPreview(thinkingObject.objectKey)}
      onClick={() => onOpen(thinkingObject.roomId, thinkingObject.conversationId)}
    >
      <span>{thinkingObject.workingLabel}</span>
      <small>{thinkingObject.hasMemoryAnchors ? formatHomeVisitMeta(thinkingObject) : "内容太少"}</small>
    </button>
  );
}

function getHomePeekSlices(thinkingObject) {
  const userTrace = getHomeRecallTrace(thinkingObject.userMemoryAnchors || thinkingObject.memoryAnchors);
  const recentTrace = getHomeRecallTrace(thinkingObject.recentMemoryAnchors || thinkingObject.memoryAnchors);
  const aiAnchors = thinkingObject.aiMemoryAnchors || [];
  const aiTrace = aiAnchors.length ? getHomeRecallTrace(aiAnchors) : "";
  const slices = [
    { label: "用户留下", text: userTrace },
    aiTrace ? { label: "AI 回声", text: aiTrace } : null,
    { label: "最近停顿", text: recentTrace }
  ].filter(Boolean);
  const seen = new Set();
  return slices.filter((slice) => {
    const compactText = getCompactHomeAnchorText(slice.text);
    if (!compactText || seen.has(compactText)) return false;
    seen.add(compactText);
    return true;
  }).slice(0, 3);
}

function HomeObjectPeek({ thinkingObject = null, members = [], isWarmest = false, onOpen = () => {} }) {
  if (!thinkingObject) {
    return (
      <aside className="home-peek-panel" aria-label="Home 侧旁窥看">
        <div className="home-peek-empty">
          <span>还没有可窥看的思考对象</span>
          <p>建立一条对话后，这里会显示最近停顿、AI 参与和可回去的位置。</p>
        </div>
      </aside>
    );
  }

  const recallTrace = getHomeRecallTrace(thinkingObject.recentMemoryAnchors || thinkingObject.memoryAnchors);
  const peekSlices = getHomePeekSlices(thinkingObject);
  const properties = getHomeVisitProperties(thinkingObject);
  return (
    <aside className="home-peek-panel" aria-label="Home 侧旁窥看">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={thinkingObject.objectKey}
          className={`home-peek-card ${isWarmest ? "is-warmest" : ""}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <div className="home-peek-head">
            <span>{getHomeObjectStateLabel(thinkingObject, members, { isWarmest })}</span>
            <button
              type="button"
              className="home-peek-open focus-ring"
              onClick={() => onOpen(thinkingObject.roomId, thinkingObject.conversationId)}
            >
              进入
            </button>
          </div>
          <h2>{thinkingObject.workingLabel}</h2>
          <p className={`home-peek-trace ${thinkingObject.hasMemoryAnchors ? "" : "is-empty"}`}>
            {renderHomeRecallTrace(recallTrace, `${thinkingObject.objectKey}-peek`)}
          </p>
          <div className="home-peek-ai">
            <HomeAiStack members={members} />
          </div>
          <div className="home-peek-slices" aria-label="思考截面">
            {peekSlices.map((slice) => (
              <span className="home-peek-slice" key={`${thinkingObject.objectKey}-peek-${slice.label}`}>
                <small>{slice.label}</small>
                <span>{truncateHomeRecallTrace(normalizeHomeRecallTraceSource(slice.text), 76)}</span>
              </span>
            ))}
          </div>
          <div className="home-peek-meta">
            {properties.map((property) => (
              <span key={`${thinkingObject.objectKey}-peek-${property}`}>{property}</span>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="home-peek-note">
        <span>最近摘录</span>
        <p>笔记列表还没接入；现在先把可摘录的消息痕迹放在这里，避免每次都跳进完整对话确认。</p>
      </div>
    </aside>
  );
}

function HomeDashboard({
  nickname = "",
  room = null,
  rooms = [],
  roomAiMembersByRoomId = {},
  currentUserId = "",
  homeVisitStats = {},
  onOpenConversation = () => {},
  onCreateConversation = () => {},
  onOpenAi = () => {}
}) {
  const thinkingObjects = getHomeThinkingObjectEntries(rooms, room);
  const hasThinkingObjects = thinkingObjects.length > 0;
  const homeName = nickname ? `${nickname} 的 Home` : "Home";
  const [thinkingObjectAnchors, setThinkingObjectAnchors] = useState({});
  const [previewObjectKey, setPreviewObjectKey] = useState("");
  const [storageOpen, setStorageOpen] = useState(false);
  const thinkingObjectKey = thinkingObjects.map((thinkingObject) => thinkingObject.objectKey).join("|");

  useEffect(() => {
    if (!thinkingObjects.length) return undefined;
    const missingThinkingObjects = thinkingObjects.filter((thinkingObject) => {
      return !thinkingObjectAnchors[thinkingObject.objectKey];
    });
    if (!missingThinkingObjects.length) return undefined;

    const controller = new AbortController();
    Promise.all(
      missingThinkingObjects.map((thinkingObject) => {
        return fetchHomeThinkingObjectAnchors(thinkingObject.conversationId, currentUserId, controller.signal)
          .then((anchors) => [thinkingObject.objectKey, anchors])
          .catch((error) => {
            if (error?.name === "AbortError") return null;
            return [thinkingObject.objectKey, []];
          });
      })
    ).then((entries) => {
      if (controller.signal.aborted) return;
      setThinkingObjectAnchors((current) => {
        const next = { ...current };
        entries.forEach((entry) => {
          if (!entry) return;
          const [key, anchors] = entry;
          next[key] = anchors && typeof anchors === "object" ? anchors : { anchors: [] };
        });
        return next;
      });
    });
    return () => controller.abort();
  }, [thinkingObjectKey, currentUserId]);

  const enrichedThinkingObjects = thinkingObjects.map((thinkingObject, index) => {
    const hasFetchedAnchors = Object.prototype.hasOwnProperty.call(thinkingObjectAnchors, thinkingObject.objectKey);
    const fetchedAnchorRecord = hasFetchedAnchors ? thinkingObjectAnchors[thinkingObject.objectKey] : null;
    const fetchedAnchors = Array.isArray(fetchedAnchorRecord)
      ? fetchedAnchorRecord
      : Array.isArray(fetchedAnchorRecord?.anchors)
        ? fetchedAnchorRecord.anchors
        : null;
    const memoryAnchors = fetchedAnchors || thinkingObject.fallbackAnchors;
    const userMemoryAnchors = Array.isArray(fetchedAnchorRecord?.userAnchors) && fetchedAnchorRecord.userAnchors.length
      ? fetchedAnchorRecord.userAnchors
      : memoryAnchors;
    const aiMemoryAnchors = Array.isArray(fetchedAnchorRecord?.aiAnchors) ? fetchedAnchorRecord.aiAnchors : [];
    const recentMemoryAnchors = Array.isArray(fetchedAnchorRecord?.recentAnchors) && fetchedAnchorRecord.recentAnchors.length
      ? fetchedAnchorRecord.recentAnchors
      : memoryAnchors;
    const visit = resolveHomeThinkingObjectVisit(thinkingObject, homeVisitStats[thinkingObject.objectKey], memoryAnchors, index);
    return {
      ...thinkingObject,
      memoryAnchors,
      userMemoryAnchors,
      aiMemoryAnchors,
      recentMemoryAnchors,
      visit,
      hasMemoryAnchors: memoryAnchors.length > 0,
      isTestingObject: isLikelyTestingThinkingObject(thinkingObject, memoryAnchors)
    };
  });
  const homeSections = buildHomeThinkingObjectSections(enrichedThinkingObjects);
  const pathCount = homeSections.path.length;
  const sameSpaceCount = homeSections.sameSpace.length;
  const storageCount = homeSections.storage.length;
  const previewCandidates = [...homeSections.path, ...homeSections.sameSpace, ...homeSections.storage];
  const fallbackPreviewObject = previewCandidates[0] || null;
  const previewObject = previewCandidates.find((thinkingObject) => thinkingObject.objectKey === previewObjectKey) || fallbackPreviewObject;
  const previewMembers = previewObject ? roomAiMembersByRoomId[previewObject.backendRoomId] || [] : [];
  const previewKeySignature = previewCandidates.map((thinkingObject) => thinkingObject.objectKey).join("|");
  const warmestObject = previewCandidates
    .slice()
    .filter((thinkingObject) => thinkingObject.visit?.lastVisitedAtMs)
    .sort((a, b) => b.visit.lastVisitedAtMs - a.visit.lastVisitedAtMs)[0] || null;
  const warmestObjectKey = warmestObject?.objectKey || "";

  useEffect(() => {
    if (!previewObjectKey || previewCandidates.some((thinkingObject) => thinkingObject.objectKey === previewObjectKey)) return;
    setPreviewObjectKey("");
  }, [previewKeySignature, previewObjectKey]);

  return (
    <section className={`home-dashboard ${hasThinkingObjects ? "has-thinking-objects" : "is-empty"}`} aria-label="Home">
      <div className="home-dashboard-inner">
        <header className="home-hero">
          <div className="home-hero-copy">
            <span className="home-kicker">个人讨论室 · 默认入口</span>
            <h1>{homeName}</h1>
            <p>回到最近留下痕迹的事情，而不是翻找一条条对话记录。</p>
          </div>
          <div className="home-hero-actions">
            <button type="button" className="home-action is-primary focus-ring" onClick={onCreateConversation}>
              新建对话
            </button>
            <button type="button" className="home-action focus-ring" onClick={onOpenAi}>
              选择 AI
            </button>
          </div>
        </header>

        {!hasThinkingObjects ? (
          <section className="home-empty-panel" aria-label="开始使用 Atrium">
            <div className="home-empty-grid" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="home-empty-copy">
              <h2>还没有对话</h2>
              <p>先建立一条思考线，再决定要不要让 AI 坐进来。个人讨论室会保留你的对话列表、房间设置和默认 AI 阵容。</p>
            </div>
            <div className="home-empty-actions">
              <button type="button" className="home-action is-primary focus-ring" onClick={onCreateConversation}>
                新建第一个对话
              </button>
              <button type="button" className="home-action focus-ring" onClick={onOpenAi}>
                先配置 AI 阵容
              </button>
            </div>
          </section>
        ) : (
          <div className="home-thinking-sections" aria-label="思考对象">
            {pathCount ? (
              <section className="home-path-section" aria-label="路径上的事情">
                <div className="home-section-head">
                  <div>
                    <h2>路径上</h2>
                    <p>{pathCount} 个最近或高频回访的思考对象</p>
                  </div>
                </div>
                <div className="home-path-list">
                  {homeSections.path.map((thinkingObject) => (
                    <HomePathObjectCard
                      key={thinkingObject.objectKey}
                      thinkingObject={thinkingObject}
                      index={homeSections.path.findIndex((item) => item.objectKey === thinkingObject.objectKey)}
                      members={roomAiMembersByRoomId[thinkingObject.backendRoomId] || []}
                      isActive={previewObject?.objectKey === thinkingObject.objectKey}
                      isWarmest={warmestObjectKey === thinkingObject.objectKey}
                      onPreview={setPreviewObjectKey}
                      onOpen={onOpenConversation}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {sameSpaceCount ? (
              <section className="home-same-space-section" aria-label="同空间">
                <div className="home-section-head is-compact">
                  <div>
                    <h2>同空间</h2>
                    <p>访问过，但最近没回去</p>
                  </div>
                </div>
                <div className="home-compact-list">
                  {homeSections.sameSpace.map((thinkingObject) => (
                    <HomeCompactObjectRow
                      key={thinkingObject.objectKey}
                      thinkingObject={thinkingObject}
                      isActive={previewObject?.objectKey === thinkingObject.objectKey}
                      onPreview={setPreviewObjectKey}
                      onOpen={onOpenConversation}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {storageCount ? (
              <section className="home-storage-section" aria-label="更早和测试性对话">
                <button
                  type="button"
                  className="home-storage-toggle focus-ring"
                  onClick={() => setStorageOpen((value) => !value)}
                  aria-expanded={storageOpen}
                >
                  <span>更早 / 测试性</span>
                  <small>{storageCount} 个可展开</small>
                </button>
                {storageOpen ? (
                  <div className="home-storage-list">
                    {homeSections.storage.map((thinkingObject) => (
                      <HomeStorageRow
                        key={thinkingObject.objectKey}
                        thinkingObject={thinkingObject}
                        isActive={previewObject?.objectKey === thinkingObject.objectKey}
                        onPreview={setPreviewObjectKey}
                        onOpen={onOpenConversation}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        )}

        {hasThinkingObjects ? (
          <HomeObjectPeek
            thinkingObject={previewObject}
            members={previewMembers}
            isWarmest={warmestObjectKey === previewObject?.objectKey}
            onOpen={onOpenConversation}
          />
        ) : null}
      </div>
    </section>
  );
}

function ConversationPrepPanel({
  isVisible,
  roomAiMembers = [],
  conversationAiMembers = [],
  availableAis = [],
  thinkingAdapters = [],
  readOnly = false,
  onChangeTeam = async () => [],
  loadError = ""
}) {
  const availableMembers = mergeAiMemberOptions(availableAis, roomAiMembers, conversationAiMembers);

  if (!isVisible) return null;

  return (
    <motion.section
      className="conversation-prep"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18, ease: EASE }}
      aria-label="新对话 AI 阵容"
    >
      <div className="conversation-prep-seats">
        <AiSeatStrip
          members={conversationAiMembers}
          thinkingAdapters={thinkingAdapters}
          readOnly={readOnly}
          onChange={onChangeTeam}
          emptyText="无 AI"
        />
      </div>
      <AiModelSelector
        models={availableMembers}
        members={conversationAiMembers}
        thinkingAdapters={thinkingAdapters}
        readOnly={readOnly}
        onChange={onChangeTeam}
        className="is-conversation-prep"
      />
      {loadError ? <div className="conversation-prep-error">{loadError}</div> : null}
    </motion.section>
  );
}

export default function ChatRoom({
  nickname, username = "", avatarUrl = "", onProfileUpdate = async () => {},
  connectionState, messages,
  isHeaderScrolled, onScrolled,
  messageDraft, onMessageDraftChange, onSend,
  messageAttachment = null, composerError = "",
  composerFieldRef, messagesViewportRef,
  hiddenMessageId, messageFlight, onMessageFlightComplete,
  onLogout, onDeleteMessage = () => {},
  rooms = null, activeRoomId = "", onRoomSelect = () => {},
  roomAiMembersByRoomId = {},
  currentUserId = "", onRoomsChanged = async () => {},
  roomName = "我的讨论室", roomHint = "",
  room = null,
  roomTransition = null,
  activeConversationId = 0,
  activeConversation = null,
  isMainConversation = true,
  activeConversationModelLabel = "",
  isConversationModelLoading = false,
  roomAiMembers = [],
  conversationAiMembers = [],
  effectiveAiMembers = [],
  availableAis = [],
  thinkingAdapters = [],
  aiConfigError = {},
  assistantState = null,
  roomConversations = [],
  onConversationSelect = () => {}, onNavigateConversation = () => {}, onDeleteConversation = () => {},
  draftConversation = null,
  onDraftAiMembersChange = async () => [],
  onCreateConversationDraft = async () => null,
  onConversationAiMembersChange = async () => [],
  onRoomAiMembersSave = async () => [],
  readOnly = false,
  isFading = false, fadeDuration = 600,
  transitionMode = "idle", transitionConfig = null,
  hideMessageContent = false,
  onPasteImage, onRemoveAttachment,
  hasMoreHistory = false, historyInitialLoading = false, historyLoading = false, historyError = "",
  onLoadMoreHistory
}) {
  const hasComposerContent = Boolean(messageDraft.trim() || messageAttachment);
  const composerDisabled = readOnly ? false : !hasComposerContent || connectionState !== "connected";
  const resolvedTransitionMode =
    transitionMode === "enter-from-auth" ? "enter" : transitionMode === "exit-to-auth" ? "exit" : "idle";
  const visibleMessages = hideMessageContent ? [] : messages;
  const roomTone = room?.tone === "public" ? "public" : "personal";
  const activeBackendRoomId = Number(room?.roomId || 0);
  const isPersonalMainConversation = room?.id === "personal" || Number(room?.type) === 1;
  const isOrdinaryMainConversation = isMainConversation && !isPersonalMainConversation;
  const isHomeDashboard = isMainConversation && isPersonalMainConversation && !draftConversation;

  const [contextMenu, setContextMenu] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const initialChatSurfaceRef = useRef(null);
  if (initialChatSurfaceRef.current == null) initialChatSurfaceRef.current = readStoredChatSurface();
  const initialWorkspacePanelOpen = initialChatSurfaceRef.current.workspacePanelOpen === true;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const initialSurface = isHomeDashboard && !initialWorkspacePanelOpen ? SIDEBAR_SURFACE_HOME : SIDEBAR_SURFACE_DEFAULT;
    return getDefaultSidebarCollapsed(initialSurface);
  });
  const sidebarPreferenceRef = useRef({
    [SIDEBAR_SURFACE_HOME]: null,
    [SIDEBAR_SURFACE_DEFAULT]: null
  });
  const [sidebarMode, setSidebarMode] = useState(() => {
    try {
      return localStorage.getItem("atrium.chat.sidebarMode") || "conversations";
    } catch {
      return "conversations";
    }
  });
  const updateSidebarMode = (mode) => {
    setSidebarMode(mode);
    try { localStorage.setItem("atrium.chat.sidebarMode", mode); } catch {}
  };
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(() => initialWorkspacePanelOpen);
  const [workspacePanelTab, setWorkspacePanelTab] = useState(() => {
    const tab = initialChatSurfaceRef.current.workspacePanelTab;
    return ["room", "ai", "members"].includes(tab) ? tab : "room";
  });
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountNotificationCount, setAccountNotificationCount] = useState(0);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomAiMembers, setNewRoomAiMembers] = useState([]);
  const [createRoomBusy, setCreateRoomBusy] = useState(false);
  const [createRoomError, setCreateRoomError] = useState("");
  const [noteToast, setNoteToast] = useState(null);
  const noteToastTimerRef = useRef(null);
  const [mainRoomMembers, setMainRoomMembers] = useState([]);
  const [mainRoomMembersState, setMainRoomMembersState] = useState("idle");
  const [homeVisitStats, setHomeVisitStats] = useState(() => readStoredHomeVisitStats(currentUserId));
  const fallbackSeatMember = {
    userId: currentUserId || "self",
    username,
    nickname: nickname || username || "我",
    avatarUrl,
    role: 2
  };
  const isPureHomeDashboard = isHomeDashboard && !workspacePanelOpen && !accountCenterOpen && !createRoomOpen;
  const sidebarSurface = isPureHomeDashboard ? SIDEBAR_SURFACE_HOME : SIDEBAR_SURFACE_DEFAULT;

  useEffect(() => {
    if (!contextMenu) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".context-menu")) return;
      setContextMenu(null);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    return () => {
      window.clearTimeout(noteToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setHomeVisitStats(readStoredHomeVisitStats(currentUserId));
  }, [currentUserId]);

  useEffect(() => {
    const userPreference = sidebarPreferenceRef.current[sidebarSurface];
    setSidebarCollapsed(userPreference ?? getDefaultSidebarCollapsed(sidebarSurface));
  }, [sidebarSurface]);

  useEffect(() => {
    if (!currentUserId) {
      setAccountNotificationCount(0);
      return undefined;
    }
    const controller = new AbortController();
    Promise.all([
      fetchFriendRequests("received", controller.signal),
      fetchMyRoomInvitations("received", controller.signal)
    ])
      .then(([friendRequests, roomInvitations]) => {
        setAccountNotificationCount(friendRequests.length + roomInvitations.length);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setAccountNotificationCount(0);
      });
    return () => controller.abort();
  }, [currentUserId]);

  useEffect(() => {
    if (!isOrdinaryMainConversation || !activeBackendRoomId) {
      setMainRoomMembers([]);
      setMainRoomMembersState("idle");
      return undefined;
    }
    const controller = new AbortController();
    setMainRoomMembersState("loading");
    fetchRoomMembers(activeBackendRoomId, controller.signal)
      .then((members) => {
        setMainRoomMembers(members);
        setMainRoomMembersState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setMainRoomMembers([]);
        setMainRoomMembersState("error");
      });
    return () => controller.abort();
  }, [isOrdinaryMainConversation, activeBackendRoomId]);

  function handleMessageContextMenu(e, message) {
    if (!message) return;
    e.preventDefault();
    const menuWidth = 190;
    const menuHeight = 136;
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(e.clientY, window.innerHeight - menuHeight - 8),
      message
    });
  }

  async function copyMessageText() {
    const text = contextMenu?.message?.text || "";
    if (!text) {
      setContextMenu(null);
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const buffer = document.createElement("textarea");
        buffer.value = text;
        buffer.setAttribute("readonly", "");
        buffer.style.position = "fixed";
        buffer.style.opacity = "0";
        document.body.appendChild(buffer);
        buffer.select();
        document.execCommand("copy");
        document.body.removeChild(buffer);
      }
    } finally {
      setContextMenu(null);
    }
  }

  function deleteMessageFromView() {
    if (contextMenu?.message) onDeleteMessage(contextMenu.message);
    setContextMenu(null);
  }

  function excerptMessageToNote() {
    const message = contextMenu?.message;
    const text = String(message?.text || "").trim();
    if (!message || !text) {
      setContextMenu(null);
      return;
    }
    window.dispatchEvent(new CustomEvent("atrium-note-excerpt", {
      detail: {
        messageId: message.id,
        text,
        roomId: activeRoomId,
        roomName
      }
    }));
    window.clearTimeout(noteToastTimerRef.current);
    setNoteToast({ id: `${message.id || "note"}-${Date.now()}`, text });
    noteToastTimerRef.current = window.setTimeout(() => setNoteToast(null), NOTE_TOAST_MS);
    setContextMenu(null);
  }

  function openWorkspace(roomId = activeRoomId, tab = "room") {
    const nextTab = ["room", "ai", "members"].includes(tab) ? tab : "room";
    if (roomId && roomId !== activeRoomId) onRoomSelect(roomId);
    setAccountCenterOpen(false);
    setWorkspacePanelTab(nextTab);
    setWorkspacePanelOpen(true);
    writeStoredChatSurface({ workspacePanelOpen: true, workspacePanelTab: nextTab });
  }

  function openAccountCenter() {
    setWorkspacePanelOpen(false);
    writeStoredChatSurface({ workspacePanelOpen: false, workspacePanelTab });
    setAccountCenterOpen(true);
  }

  function openNoteEntry() {
    window.dispatchEvent(new CustomEvent("atrium-note-entry", {
      detail: {
        roomId: activeRoomId,
        conversationId: activeConversationId,
        roomName
      }
    }));
  }

  function recordHomeConversationVisit(roomId, conversationId) {
    const normalizedConversationId = Number(conversationId || 0);
    if (!roomId || !normalizedConversationId) return;
    const homeRoom = Array.isArray(rooms) ? rooms.find((item) => item.id === "personal" || item.type === 1) : null;
    const homeMainConversationId = homeRoom?.mainConversationId || homeRoom?.conversationId || 0;
    if (homeRoom?.id === roomId && normalizedConversationId === homeMainConversationId) return;
    const objectKey = getHomeObjectKey(roomId, normalizedConversationId);
    setHomeVisitStats((current) => {
      const currentEntry = current[objectKey] || {};
      const nextStats = {
        ...current,
        [objectKey]: {
          lastVisitedAtMs: Date.now(),
          visitCount: normalizeHomeVisitCount(currentEntry.visitCount) + 1
        }
      };
      writeStoredHomeVisitStats(currentUserId, nextStats);
      return nextStats;
    });
  }

  function handleActiveRoomSelect(roomId) {
    const nextRoom = Array.isArray(rooms) ? rooms.find((item) => item.id === roomId) : null;
    const nextConversationId = nextRoom?.mainConversationId || nextRoom?.conversationId || 0;
    const isAlreadyOpen = nextRoom?.id === activeRoomId && nextConversationId === activeConversationId;
    if (nextRoom?.id && nextConversationId && !isAlreadyOpen) {
      recordHomeConversationVisit(nextRoom.id, nextConversationId);
    }
    onRoomSelect(roomId);
  }

  function handleActiveConversationSelect(conversationId) {
    if (activeRoomId && conversationId && conversationId !== activeConversationId) {
      recordHomeConversationVisit(activeRoomId, conversationId);
    }
    onConversationSelect(conversationId);
  }

  function handleHomeObjectOpen(roomId, conversationId) {
    recordHomeConversationVisit(roomId, conversationId);
    onNavigateConversation(roomId, conversationId);
  }

  function insertAiMention(member) {
    const aiName = getAiMemberName(member);
    const nextValue = String(messageDraft || "").replace(/(^|\s)@([^\s@]*)$/, `$1@${aiName} `);
    onMessageDraftChange(nextValue);
    requestAnimationFrame(() => {
      const textarea = composerFieldRef?.current?.querySelector?.("textarea");
      textarea?.focus?.();
      textarea?.setSelectionRange?.(nextValue.length, nextValue.length);
    });
  }

  function openCreateRoom() {
    if (readOnly) return;
    setCreateRoomError("");
    setCreateRoomOpen(true);
  }

  function closeCreateRoom() {
    if (createRoomBusy) return;
    setCreateRoomOpen(false);
    setCreateRoomError("");
  }

  async function updateNewRoomAiMembers(nextMembers) {
    setNewRoomAiMembers(nextMembers);
    return nextMembers;
  }

  async function handleCreateRoom() {
    const name = newRoomName.trim();
    if (!name || createRoomBusy || readOnly) {
      if (!name) setCreateRoomError("请先给讨论室起名");
      return;
    }
    setCreateRoomBusy(true);
    setCreateRoomError("");
    try {
      const created = await createRoom(name);
      if (created?.roomId && newRoomAiMembers.length) {
        await syncRoomAiMembers(created.roomId, newRoomAiMembers);
      }
      const nextRoom = await onRoomsChanged(created?.roomId);
      if (nextRoom?.id) onRoomSelect(nextRoom.id);
      updateSidebarMode("conversations");
      setMobileSidebarOpen(false);
      setCreateRoomOpen(false);
      setNewRoomName("");
      setNewRoomAiMembers([]);
    } catch (error) {
      setCreateRoomError(getApiErrorMessage(error, "新建房间失败"));
    } finally {
      setCreateRoomBusy(false);
    }
  }

  async function handleRenameConversation(conversationId, nextTitle) {
    const normalizedTitle = String(nextTitle || "").trim();
    const normalizedConversationId = Number(conversationId);
    const mainConversationId = Number(room?.mainConversationId || room?.conversationId || 0);
    if (readOnly || !normalizedConversationId || (mainConversationId && normalizedConversationId === mainConversationId)) return;
    if (!normalizedTitle) throw new Error("对话名不能为空");
    try {
      await renameConversation(normalizedConversationId, normalizedTitle);
    } finally {
      await onRoomsChanged(room?.roomId);
    }
  }

  function resolveSectionMotion(timing) {
    if (resolvedTransitionMode === "enter" && timing) {
      return {
        initial: { opacity: 0, x: timing.x || 0, y: timing.y || 0 },
        animate: { opacity: 1, x: 0, y: 0 },
        transition: { delay: timing.delay || 0, duration: timing.duration || 0.24, ease: EASE }
      };
    }
    if (resolvedTransitionMode === "exit" && timing) {
      return {
        initial: false,
        animate: { opacity: 0, x: timing.x || 0, y: timing.y || 0 },
        transition: { delay: timing.delay || 0, duration: timing.duration || 0.2, ease: EASE }
      };
    }
    return {
      initial: false,
      animate: { opacity: 1, x: 0, y: 0 },
      transition: { duration: 0.18, ease: EASE }
    };
  }

  const headerMotion = resolveSectionMotion(transitionConfig?.header);
  const messagesMotion = resolveSectionMotion(transitionConfig?.messages);
  const roomPlaceLabel = room?.placeLabel || (roomTone === "public" ? "公共大厅" : "个人空间");
  const roomAtmosphere = room?.atmosphere || roomHint || "写下一个想法，让讨论从这里开始。";
  const currentModelLabel = isConversationModelLoading ? "团队同步中" : activeConversationModelLabel;
  const emptyTitle = room?.emptyTitle || (roomTone === "public" ? "大厅正在等待新的讨论" : "这里还很安静");
  const emptyHint = room?.emptyHint || roomHint || "写下一个想法，让讨论从这里开始。";
  const emptySuggestions = roomTone === "public"
    ? ["提出一个公共问题", "贴出材料和判断", "沉淀阶段结论"]
    : ["写下研究对象", "让 DeepSeek 接入推演", "保存待整理结论"];
  const composerPlaceholder = isOrdinaryMainConversation
    ? "在主对话发言，可 @AI"
    : room?.composerPlaceholder || "输入消息，按 Enter 发送";
  const roomConversationCount = Math.max(roomConversations.length || 0, 1);
  const selectedConversation = activeConversation || roomConversations.find((item) => item.id === activeConversationId);
  const activeConversationTitle = isHomeDashboard
    ? "Home"
    : isMainConversation
    ? roomName
    : selectedConversation?.name || (activeConversationId ? `对话 ${activeConversationId}` : "对话");
  const mentionQuery = isOrdinaryMainConversation ? getMentionQuery(messageDraft) : null;
  const mainComposerTopSlot = mentionQuery != null && roomAiMembers.length ? (
    <MainConversationMentionReserve
      query={mentionQuery}
      aiMembers={roomAiMembers}
      onPick={insertAiMention}
    />
  ) : null;
  const newRoomAiOptions = mergeAiMemberOptions(availableAis, newRoomAiMembers);
  const currentMoment =
    workspacePanelOpen || accountCenterOpen ? "tooling"
      : isHomeDashboard ? "home"
      : !visibleMessages.length ? "arriving"
        : "thinking";
  const conversationTeamError =
    aiConfigError?.conversation ||
    aiConfigError?.room ||
    aiConfigError?.thinking ||
    "";
  const stageInitial = resolvedTransitionMode === "idle" ? false : messagesMotion.initial;
  const stageAnimate = resolvedTransitionMode === "idle" ? { opacity: 1 } : messagesMotion.animate;
  const stageTransition = resolvedTransitionMode === "idle" ? { duration: 0 } : messagesMotion.transition;

  return (
    <div className={`shell is-moment-${currentMoment} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="mobile-menu-btn"
        onClick={() => setMobileSidebarOpen((v) => !v)}
        aria-label="菜单"
        aria-expanded={mobileSidebarOpen}
        aria-controls="atrium-sidebar-panel"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14"/>
        </svg>
      </button>

      <div className={`sidebar-overlay ${mobileSidebarOpen ? "is-open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />

      <div id="atrium-sidebar-panel" className={`sidebar-wrapper ${mobileSidebarOpen ? "is-open" : ""}`}>
        <Sidebar
          nickname={nickname}
          username={username}
          avatarUrl={avatarUrl}
          onLogout={onLogout}
          shouldAnimateEntry={false}
          transitionMode={resolvedTransitionMode}
          motionTiming={transitionConfig?.sidebar}
          readOnly={readOnly}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onRoomSelect={(id) => { handleActiveRoomSelect(id); setMobileSidebarOpen(false); }}
          roomName={roomName}
          mode={sidebarMode}
          onModeChange={updateSidebarMode}
          room={room}
          conversations={roomConversations}
          activeConversationId={activeConversationId}
          onConversationSelect={(id) => { handleActiveConversationSelect(id); setMobileSidebarOpen(false); }}
          onCreateConversation={onCreateConversationDraft}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={onDeleteConversation}
          onCreateRoom={openCreateRoom}
          onOpenRoomManagement={(roomId, tab) => openWorkspace(roomId, tab)}
          onOpenAccountCenter={openAccountCenter}
          accountNotificationCount={accountNotificationCount}
        />
      </div>

      <button
        type="button"
        className="sidebar-collapse-btn focus-ring"
        onClick={() => setSidebarCollapsed((value) => {
          const nextValue = !value;
          sidebarPreferenceRef.current[sidebarSurface] = nextValue;
          return nextValue;
        })}
        aria-label={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
        aria-expanded={!sidebarCollapsed}
        title={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
      >
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {sidebarCollapsed ? (
            <path d="M6.2 4.2 10.5 8.5l-4.3 4.3" />
          ) : (
            <path d="m10.8 4.2-4.3 4.3 4.3 4.3" />
          )}
          <path d="M3.4 3.2v10.6" />
        </svg>
      </button>

      <main className="main">
        <motion.header
          className={`header ${isHeaderScrolled ? "is-scrolled" : ""} is-connection-${connectionState} ${isOrdinaryMainConversation ? "is-main-timeline" : ""} ${isHomeDashboard ? "is-home-dashboard" : ""}`}
          initial={headerMotion.initial}
          animate={headerMotion.animate}
          transition={headerMotion.transition}
        >
          <div className="header-inner">
            <div className="room-heading" title={roomHint || roomAtmosphere}>
              <div className="room-anchor">
                <div className="room-title-button" aria-label="当前对话">
                  <span className="room-name">{activeConversationTitle}</span>
                  {isOrdinaryMainConversation ? <span className="room-topic">{roomAtmosphere}</span> : null}
                </div>
                <span className="room-anchor-meta">
                  <span>{isOrdinaryMainConversation ? roomPlaceLabel : roomName}</span>
                  <span>{roomConversationCount} 段{isOrdinaryMainConversation ? "公共历史" : "记忆"}</span>
                </span>
              </div>
              {connectionState !== "connected" ? <HeaderStatus modelLabel={currentModelLabel} connectionState={connectionState} /> : null}
            </div>
            <div className="header-actions">
              {isOrdinaryMainConversation ? (
                <button
                  type="button"
                  className="header-icon-button is-note-entry focus-ring"
                  onClick={openNoteEntry}
                  disabled={readOnly}
                  aria-label="笔记"
                  title="笔记"
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4.3 2.8h5.9l2.5 2.5v8.9H4.3z" />
                    <path d="M10.1 2.9v2.5h2.5M6.1 8.2h4.8M6.1 10.9h3.3" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="header-icon-button focus-ring"
                onClick={() => {
                  openWorkspace(activeRoomId, workspacePanelTab);
                }}
                disabled={readOnly}
                aria-label="打开房间、成员与笔记"
                title="打开房间、成员与笔记"
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.2 4.7h10.6M3.2 8.5h10.6M3.2 12.3h10.6" />
                  <path d="M6.1 3.1v3.2M10.9 6.9v3.2M8.3 10.7v3.2" />
                </svg>
              </button>
            </div>
          </div>
        </motion.header>

        <motion.div
          key={draftConversation ? "draft" : `${activeRoomId}-${activeConversationId || "main"}`}
          className={`messages-stage is-${roomTone} ${isOrdinaryMainConversation ? "is-main-timeline" : ""} ${isHomeDashboard ? "is-home-dashboard" : ""} ${roomTransition ? "is-switching" : ""}`}
          initial={stageInitial}
          animate={stageAnimate}
          transition={stageTransition}
        >
          {isOrdinaryMainConversation && !draftConversation ? (
            <MainConversationSeatline
              room={room}
              members={mainRoomMembers}
              membersState={mainRoomMembersState}
              currentUserId={currentUserId}
              fallbackMember={fallbackSeatMember}
              aiMembers={roomAiMembers}
              thinkingAdapters={thinkingAdapters}
              compact={Boolean(visibleMessages.length)}
              onOpenMembers={() => openWorkspace(activeRoomId, "members")}
              onOpenAi={() => openWorkspace(activeRoomId, "ai")}
            />
          ) : null}
          {isHomeDashboard ? (
            <HomeDashboard
              nickname={nickname}
              room={room}
              rooms={rooms}
              roomAiMembersByRoomId={roomAiMembersByRoomId}
              currentUserId={currentUserId}
              homeVisitStats={homeVisitStats}
              onOpenConversation={handleHomeObjectOpen}
              onCreateConversation={onCreateConversationDraft}
              onOpenAi={() => openWorkspace(activeRoomId, "ai")}
            />
          ) : draftConversation ? (
            <div className="empty-state empty-state--ai-start">
              <ConversationPrepPanel
                isVisible={true}
                roomAiMembers={roomAiMembers}
                conversationAiMembers={draftConversation.aiMembers}
                availableAis={availableAis}
                thinkingAdapters={thinkingAdapters}
                readOnly={readOnly}
                onChangeTeam={onDraftAiMembersChange}
                loadError={aiConfigError?.room || aiConfigError?.thinking || ""}
              />
            </div>
          ) : (
            <MessageList
              messages={visibleMessages}
              assistantState={assistantState}
              aiMembers={effectiveAiMembers}
              onScrolled={onScrolled}
              hiddenMessageId={hiddenMessageId}
              shouldAnimateEntry={false}
              itemAnimationMode="calm"
              isFading={isFading}
              fadeDuration={fadeDuration}
              viewportRef={messagesViewportRef}
              renderEmpty={hideMessageContent ? () => null : () => (
                isOrdinaryMainConversation ? (
                  <div className={`empty-state empty-state--room is-main-conversation is-${roomTone}`}>
                    <MainConversationCover
                      roomPlaceLabel={roomPlaceLabel}
                      title={roomAtmosphere}
                      topic={room?.description || emptyHint}
                      aiMembers={roomAiMembers}
                      onOpenAi={() => openWorkspace(activeRoomId, "ai")}
                    />
                  </div>
                ) : (
                  <div className={`empty-state empty-state--room is-${roomTone}`}>
                    <div className="empty-copy">
                      <div className="empty-kicker">{roomPlaceLabel}</div>
                      <div className="empty-title">{emptyTitle}</div>
                      <div className="empty-hint">{emptyHint}</div>
                      <div className="empty-prompt-rail" aria-label="讨论起点">
                        {emptySuggestions.map((item) => <span key={item}>{item}</span>)}
                      </div>
                    </div>
                  </div>
                )
                )
              }
              onContextMenu={handleMessageContextMenu}
              hasMoreHistory={hasMoreHistory && !hideMessageContent}
            historyInitialLoading={historyInitialLoading && !hideMessageContent}
            historyLoading={historyLoading && !hideMessageContent}
            historyError={hideMessageContent ? "" : historyError}
            onLoadMoreHistory={onLoadMoreHistory}
            />
          )}
        </motion.div>

        {isHomeDashboard ? null : (
          <MessageInput
            value={messageDraft}
            onChange={onMessageDraftChange}
            onSend={onSend}
            disabled={composerDisabled}
            attachment={messageAttachment}
            error={composerError}
            composerFieldRef={composerFieldRef}
            shouldAnimateEntry={false}
            transitionMode={resolvedTransitionMode}
            motionTiming={transitionConfig?.composer}
            readOnly={readOnly}
            placeholder={composerPlaceholder}
            topSlot={mainComposerTopSlot}
            onPasteImage={onPasteImage}
            onRemoveAttachment={onRemoveAttachment}
          />
        )}

      </main>

      {readOnly ? null : (
        <MessageFlight flight={messageFlight} onComplete={onMessageFlightComplete} />
      )}

      <WorkspacePanel
        isOpen={workspacePanelOpen && !readOnly}
        onClose={() => {
          setWorkspacePanelOpen(false);
          writeStoredChatSurface({ workspacePanelOpen: false, workspacePanelTab });
        }}
        currentUserId={currentUserId}
        room={room}
        readOnly={readOnly}
        activeTab={workspacePanelTab}
        onTabChange={(tab) => {
          setWorkspacePanelTab(tab);
          writeStoredChatSurface({ workspacePanelOpen: true, workspacePanelTab: tab });
        }}
        onRoomsChanged={onRoomsChanged}
        activeConversationModelLabel={activeConversationModelLabel}
        isConversationModelLoading={isConversationModelLoading}
        activeConversation={activeConversation}
        isMainConversation={isMainConversation}
        roomAiMembers={roomAiMembers}
        conversationAiMembers={conversationAiMembers}
        availableAis={availableAis}
        thinkingAdapters={thinkingAdapters}
        aiConfigError={aiConfigError}
        onRoomAiMembersSave={onRoomAiMembersSave}
        onConversationAiMembersChange={onConversationAiMembersChange}
      />

      <AccountCenterPanel
        isOpen={accountCenterOpen && !readOnly}
        onClose={() => setAccountCenterOpen(false)}
        currentUserId={currentUserId}
        nickname={nickname}
        username={username}
        avatarUrl={avatarUrl}
        onProfileUpdate={onProfileUpdate}
        readOnly={readOnly}
        onRoomsChanged={onRoomsChanged}
        onNotificationCountChange={setAccountNotificationCount}
      />

      <ModalLayer
        isOpen={createRoomOpen && !readOnly}
        title="新建房间"
        subtitle="先命名房间，再配置默认 AI 阵容"
        onClose={closeCreateRoom}
      >
        <div className="ai-create-room">
          <label className="ai-create-room-name">
            <span>房间名</span>
            <input
              className="workspace-input"
              value={newRoomName}
              onChange={(event) => {
                setNewRoomName(event.target.value);
                setCreateRoomError("");
              }}
              placeholder="例如：项目复盘"
              maxLength={32}
              disabled={createRoomBusy}
            />
          </label>
          <div className="ai-create-room-main">
            <AiModelSelector
              models={newRoomAiOptions}
              members={newRoomAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={createRoomBusy}
              onChange={updateNewRoomAiMembers}
              className="is-room-create"
            />
          </div>
          <div className="ai-create-room-seats">
            <AiSeatStrip
              members={newRoomAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={createRoomBusy}
              onChange={updateNewRoomAiMembers}
              emptyText="无 AI"
            />
          </div>
          {createRoomError ? <div className="create-conversation-error">{createRoomError}</div> : null}
          <div className="ai-create-room-actions">
            <motion.button
              type="button"
              className="workspace-action is-primary"
              onClick={handleCreateRoom}
              disabled={createRoomBusy || !newRoomName.trim()}
              whileTap={createRoomBusy || !newRoomName.trim() ? undefined : { scale: 0.98 }}
            >
              {createRoomBusy ? "处理中" : "创建"}
            </motion.button>
          </div>
        </div>
      </ModalLayer>

      <AnimatePresence>
        {noteToast ? (
          <motion.div
            key={noteToast.id}
            className="note-capture-toast"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            role="status"
            aria-live="polite"
          >
            <div className="note-capture-title">已摘录到笔记草稿</div>
            <div className="note-capture-preview">{noteToast.text}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu ? (
          <motion.div
            key="ctx-menu"
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.12, ease: EASE }}
            role="menu"
          >
            <button type="button" className="context-menu-item" onClick={copyMessageText} role="menuitem">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="3" width="8" height="10" rx="1"/>
                <path d="M3 5h-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V12"/>
              </svg>
              复制原文
            </button>
            <button type="button" className="context-menu-item is-note" onClick={excerptMessageToNote} role="menuitem">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2.5h6.8L13 4.7V13a.8.8 0 0 1-.8.8H4A.8.8 0 0 1 3.2 13V3.3A.8.8 0 0 1 4 2.5Z"/>
                <path d="M10.7 2.7V4.8H13M5.4 7.2h5.2M5.4 9.6h3.9"/>
              </svg>
              摘录到笔记
            </button>
            <button type="button" className="context-menu-item is-danger" onClick={deleteMessageFromView} role="menuitem">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.33 4V2.67a.67.67 0 0 1 .67-.67h4a.67.67 0 0 1 .67.67V4M6.67 7.33v4M9.33 7.33v4"/>
                <path d="M3.33 4l.87 8.67a.67.67 0 0 0 .67.6h6.27a.67.67 0 0 0 .67-.6L12.67 4"/>
              </svg>
              从本地移除
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
