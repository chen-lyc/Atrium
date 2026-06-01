import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, MESSAGE_TYPE } from "../constants.js";
import {
  AiModelSelector,
  AiSeatStrip,
  getAiAvatarUrl,
  getAiMemberName,
  mergeAiMemberOptions
} from "./AiTeamEditor.jsx";

const HOME_VISIT_STATS_STORAGE_KEY = "atrium.home.visitStats.v1";
const HOME_MEMORY_ANCHOR_PAGE_LIMIT = 36;
const HOME_MEMORY_ANCHOR_MAX_PAGES = 3;
const HOME_MEMORY_ANCHOR_LIMIT = 2;
const HOME_PATH_LIMIT = 5;
const HOME_PATH_RECENT_MS = 3 * 24 * 60 * 60 * 1000;
const HOME_SPACE_RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const HOME_RECALL_TRACE_LIMIT = 112;
const HOME_TOUCH_MOVE_TOLERANCE = 8;
const HOME_INITIAL_AI_GUIDE_DISMISS_STORAGE_KEY = "atrium.home.initialAiGuideDismissed.v1";
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

function getHomeVisitStorageKey(currentUserId = "") {
  const userKey = String(currentUserId || "anonymous").trim() || "anonymous";
  return `${HOME_VISIT_STATS_STORAGE_KEY}:${userKey}`;
}

export function readStoredHomeVisitStats(currentUserId = "") {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getHomeVisitStorageKey(currentUserId)) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeStoredHomeVisitStats(currentUserId = "", nextStats = {}) {
  try {
    window.localStorage.setItem(getHomeVisitStorageKey(currentUserId), JSON.stringify(nextStats));
  } catch {
    // Visit tracking is a replaceable frontend-only stand-in for future backend fields.
  }
}

function getHomeInitialAiGuideDismissStorageKey(currentUserId = "") {
  const userKey = String(currentUserId || "anonymous").trim() || "anonymous";
  return `${HOME_INITIAL_AI_GUIDE_DISMISS_STORAGE_KEY}:${userKey}`;
}

function readHomeInitialAiGuideDismissed(currentUserId = "") {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(getHomeInitialAiGuideDismissStorageKey(currentUserId)) === "1";
  } catch {
    return false;
  }
}

function writeHomeInitialAiGuideDismissed(currentUserId = "", dismissed = true) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getHomeInitialAiGuideDismissStorageKey(currentUserId), dismissed ? "1" : "0");
  } catch {
    // The guide is optional; failing to remember dismissal should not block Home.
  }
}

export function getHomeObjectKey(roomId, conversationId) {
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

export function normalizeHomeVisitCount(value) {
  const count = Number(value || 0);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
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

function useHomeTouchIntent() {
  const intentRef = useRef({
    pointerId: null,
    touchId: null,
    startX: 0,
    startY: 0,
    didDrag: false,
    suppressClickUntil: 0,
    resetTimer: null
  });

  function resetTouchIntent({ keepDrag = false } = {}) {
    window.clearTimeout(intentRef.current.resetTimer);
    intentRef.current.pointerId = null;
    intentRef.current.touchId = null;
    intentRef.current.resetTimer = null;
    if (!keepDrag) {
      intentRef.current.didDrag = false;
      intentRef.current.suppressClickUntil = 0;
    }
  }

  function finishTouchIntent() {
    const intent = intentRef.current;
    if (!intent.didDrag) {
      resetTouchIntent();
      return;
    }
    intent.pointerId = null;
    intent.touchId = null;
    intent.suppressClickUntil = Date.now() + 700;
    window.clearTimeout(intent.resetTimer);
    intent.resetTimer = window.setTimeout(() => {
      intent.didDrag = false;
      intent.suppressClickUntil = 0;
      intent.resetTimer = null;
    }, 720);
  }

  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse") return;
      intentRef.current = {
        pointerId: event.pointerId,
        touchId: null,
        startX: event.clientX,
        startY: event.clientY,
        didDrag: false,
        suppressClickUntil: 0,
        resetTimer: null
      };
    },
    onPointerMove(event) {
      const intent = intentRef.current;
      if (intent.pointerId !== event.pointerId) return;
      const movedX = Math.abs(event.clientX - intent.startX);
      const movedY = Math.abs(event.clientY - intent.startY);
      if (Math.max(movedX, movedY) > HOME_TOUCH_MOVE_TOLERANCE) {
        intent.didDrag = true;
      }
    },
    onTouchStart(event) {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      intentRef.current = {
        pointerId: null,
        touchId: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        didDrag: false,
        suppressClickUntil: 0,
        resetTimer: null
      };
    },
    onTouchMove(event) {
      const intent = intentRef.current;
      if (intent.touchId == null) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === intent.touchId);
      if (!touch) return;
      const movedX = touch.clientX - intent.startX;
      const movedY = touch.clientY - intent.startY;
      if (Math.max(Math.abs(movedX), Math.abs(movedY)) <= HOME_TOUCH_MOVE_TOLERANCE) return;
      intent.didDrag = true;
    },
    onTouchEnd() {
      finishTouchIntent();
    },
    onTouchCancel() {
      finishTouchIntent();
    },
    onPointerUp(event) {
      const intent = intentRef.current;
      if (intent.pointerId !== event.pointerId) return;
      finishTouchIntent();
    },
    onPointerCancel() {
      finishTouchIntent();
    },
    onClickCapture(event) {
      const intent = intentRef.current;
      if (!intent.didDrag && Date.now() > intent.suppressClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
      resetTouchIntent();
    }
  };
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
  const touchIntent = useHomeTouchIntent();
  return (
    <motion.button
      type="button"
      className={`home-path-card focus-ring ${getHomeObjectCardClass(thinkingObject, members, { isWarmest })} ${isActive ? "is-active" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.085, 0.36), duration: 0.28, ease: EASE }}
      onMouseEnter={() => onPreview(thinkingObject.objectKey)}
      onFocus={() => onPreview(thinkingObject.objectKey)}
      {...touchIntent}
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
  const touchIntent = useHomeTouchIntent();
  return (
    <button
      type="button"
      className={`home-compact-row focus-ring ${isActive ? "is-active" : ""}`}
      onMouseEnter={() => onPreview(thinkingObject.objectKey)}
      onFocus={() => onPreview(thinkingObject.objectKey)}
      {...touchIntent}
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
  const touchIntent = useHomeTouchIntent();
  return (
    <button
      type="button"
      className={`home-storage-row focus-ring ${isActive ? "is-active" : ""}`}
      onMouseEnter={() => onPreview(thinkingObject.objectKey)}
      onFocus={() => onPreview(thinkingObject.objectKey)}
      {...touchIntent}
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
  const openTouchIntent = useHomeTouchIntent();

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
              {...openTouchIntent}
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

function getHomeRoomAiMembers(roomAiMembersByRoomId = {}, room = null) {
  const keys = [room?.roomId, room?.id].filter((key) => key != null && key !== "");
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(roomAiMembersByRoomId, key)) {
      return roomAiMembersByRoomId[key] || [];
    }
  }
  return [];
}

function getHomePublicRoom(rooms = []) {
  return rooms.find((item) => item?.id === "public" || Number(item?.type) === 0) || null;
}

function HomeStarterPanel({
  hasStoredObjects = false,
  storageCount = 0,
  defaultMembers = [],
  publicRoom = null,
  onCreateConversation = () => {},
  onOpenConversation = () => {}
}) {
  const createTouchIntent = useHomeTouchIntent();
  const publicTouchIntent = useHomeTouchIntent();
  const publicConversationId = publicRoom?.mainConversationId || publicRoom?.conversationId || 0;
  const canOpenPublicRoom = Boolean(publicRoom?.id && publicConversationId);
  const aiLine = defaultMembers.length ? `${defaultMembers.length} 位 AI 可带入` : "也可以空席开始";

  return (
    <section className="home-start-panel" aria-label="Home 起始状态">
      <div className="home-start-map" aria-hidden="true">
        <span className="is-current" />
        <span />
        <span />
      </div>
      <div className="home-start-copy">
        <span className="home-start-kicker">{hasStoredObjects ? "还没有形成路径" : "第一次来到这里"}</span>
        <h2>{hasStoredObjects ? "先把真正要继续想的事放上来" : "把第一件要想的事放进来"}</h2>
        <p>
          {hasStoredObjects
            ? "现有记录还太轻，暂时收在更早处。先从一个问题、材料或判断开始，Home 才会长出可回访的路径。"
            : "个人讨论室可以从一个问题、材料或判断开始；AI 阵容会跟着这条新对话一起准备。"}
        </p>
      </div>
      <div className="home-start-actions">
        <button type="button" className="home-action is-primary focus-ring" {...createTouchIntent} onClick={onCreateConversation}>
          开始一条思考线
        </button>
        {canOpenPublicRoom ? (
          <button
            type="button"
            className="home-action focus-ring"
            {...publicTouchIntent}
            onClick={() => onOpenConversation(publicRoom.id, publicConversationId)}
          >
            看看大厅
          </button>
        ) : null}
      </div>
      <div className="home-start-lanes" aria-label="可以放入 Home 的起点">
        <span>
          <small>问题</small>
          <strong>一个还没拆开的判断</strong>
        </span>
        <span>
          <small>材料</small>
          <strong>一段想继续看的信息</strong>
        </span>
        <span>
          <small>AI</small>
          <strong>{aiLine}</strong>
        </span>
      </div>
      {storageCount ? <div className="home-start-storage-note">{storageCount} 条旧痕迹已收起</div> : null}
    </section>
  );
}

function HomeStarterAside({ homeName = "Home", defaultMembers = [], hasStoredObjects = false }) {
  return (
    <aside className="home-start-aside" aria-label="Home 当前状态">
      <div className="home-start-status">
        <span>{hasStoredObjects ? "等待更清晰的痕迹" : "还没有路径"}</span>
        <h2>{homeName}</h2>
        <p>以后主动回访过的讨论会出现在这里，按与你的关系而不是按创建时间排开。</p>
        <div className="home-start-ai">
          <small>默认 AI 阵容</small>
          <HomeAiStack members={defaultMembers} />
        </div>
      </div>
      <div className="home-start-note">
        <span>最近摘录</span>
        <p>摘录还没有接入时，Home 先保留给可回来的讨论痕迹。</p>
      </div>
    </aside>
  );
}

function HomeAiSeatStage({
  members = [],
  thinkingAdapters = [],
  readOnly = false,
  isGuide = false,
  intentModel = null,
  canFocusModel = false,
  onFocusModel = () => {},
  onChange = async () => []
}) {
  const emptySeats = Array.from({ length: 3 }, (_, index) => index);
  const hasMembers = members.length > 0;

  return (
    <div className={`home-ai-seat-stage ${isGuide ? "is-guide" : ""} ${hasMembers ? "has-members" : "is-empty"}`}>
      <AnimatePresence mode="wait" initial={false}>
        {hasMembers ? (
          <motion.div
            key="home-ai-stage-members"
            className="home-ai-seat-stage-members"
            initial={{ opacity: 0, y: 7, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <AiSeatStrip
              members={members}
              thinkingAdapters={thinkingAdapters}
              readOnly={readOnly}
              onChange={onChange}
              emptyText="无 AI"
              className="is-home-seat-stage"
            />
          </motion.div>
        ) : (
          <motion.div
            key="home-ai-stage-empty"
            className="home-ai-empty-seats"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -7, scale: 0.985 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {emptySeats.map((seatIndex) => (
              <button
                type="button"
                key={`home-empty-seat-${seatIndex}`}
                className={`home-ai-empty-seat focus-ring ${seatIndex === 0 ? "is-primary" : ""} ${intentModel && seatIndex === 0 ? "is-receiving-intent" : ""}`}
                onClick={onFocusModel}
                aria-label={seatIndex === 0 ? "选择 AI 放入第一个席位" : `选择 AI 放入第 ${seatIndex + 1} 个席位`}
                disabled={readOnly || !canFocusModel}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HomeDefaultAiPanel({
  isOpen = false,
  variant = "default",
  members = [],
  availableAis = [],
  thinkingAdapters = [],
  readOnly = false,
  loadError = "",
  onChange = async () => [],
  onClose = () => {}
}) {
  const aiMemberOptions = mergeAiMemberOptions(availableAis, members);
  const isStarterGuide = variant === "starter";
  const showSeatGuide = isStarterGuide && !members.length;
  const [guideIntentModel, setGuideIntentModel] = useState(null);
  const [guideFocusRequestKey, setGuideFocusRequestKey] = useState(0);
  const selectedAiIds = new Set(members.map((member) => Number(member.aiId)));
  const firstAvailableModel = aiMemberOptions.find((model) => !selectedAiIds.has(Number(model.aiId))) || aiMemberOptions[0] || null;

  function focusFirstAvailableModel() {
    if (!firstAvailableModel) return;
    setGuideIntentModel(firstAvailableModel);
    setGuideFocusRequestKey((value) => value + 1);
  }

  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.section
          className={`home-ai-panel ${isStarterGuide ? "is-starter-guide" : ""}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: EASE }}
          aria-label="个人房间默认 AI 阵容"
        >
          <header className="home-ai-panel-head">
            <div>
              <span>{isStarterGuide ? "新房间的第一组席位" : "个人房间默认 AI"}</span>
              <h2>{isStarterGuide ? "先放入 AI 席位" : "Home 默认阵容"}</h2>
              <p>
                {isStarterGuide
                  ? "这不是账户设置，而是个人房间的初始阵容。新建对话会先带着这里的 AI，但你仍然可以空席开始。"
                  : "这是个人房间主对话的默认阵容。新建对话会先继承它，进入对话前仍然可以临时调整。"}
              </p>
            </div>
            <button type="button" className="home-ai-panel-close focus-ring" onClick={onClose} aria-label="收起 AI 阵容">
              {isStarterGuide ? "稍后" : "收起"}
            </button>
          </header>
          <HomeAiSeatStage
            members={members}
            thinkingAdapters={thinkingAdapters}
            readOnly={readOnly}
            isGuide={showSeatGuide}
            intentModel={guideIntentModel}
            canFocusModel={Boolean(firstAvailableModel)}
            onFocusModel={focusFirstAvailableModel}
            onChange={onChange}
          />
          <AiModelSelector
            models={aiMemberOptions}
            members={members}
            thinkingAdapters={thinkingAdapters}
            readOnly={readOnly}
            onChange={onChange}
            onModelIntent={showSeatGuide ? setGuideIntentModel : null}
            intentAiId={showSeatGuide ? guideIntentModel?.aiId : null}
            focusAiId={guideFocusRequestKey ? firstAvailableModel?.aiId : null}
            focusRequestKey={guideFocusRequestKey}
            className={`is-home-default ${showSeatGuide ? "is-home-starter-guide" : ""}`}
          />
          {loadError ? <div className="home-ai-panel-error">{loadError}</div> : null}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

export default function HomeDashboard({
  nickname = "",
  room = null,
  rooms = [],
  roomAiMembersByRoomId = {},
  availableAis = [],
  thinkingAdapters = [],
  aiConfigError = {},
  readOnly = false,
  currentUserId = "",
  homeVisitStats = {},
  onOpenConversation = () => {},
  onCreateConversation = () => {},
  onRoomAiMembersSave = async () => []
}) {
  const thinkingObjects = getHomeThinkingObjectEntries(rooms, room);
  const hasThinkingObjects = thinkingObjects.length > 0;
  const homeName = nickname ? `${nickname} 的 Home` : "Home";
  const [thinkingObjectAnchors, setThinkingObjectAnchors] = useState({});
  const [previewObjectKey, setPreviewObjectKey] = useState("");
  const [storageOpen, setStorageOpen] = useState(false);
  const [homeSideMode, setHomeSideMode] = useState("");
  const [initialAiGuideDismissed, setInitialAiGuideDismissed] = useState(() => readHomeInitialAiGuideDismissed(currentUserId));
  const createActionTouchIntent = useHomeTouchIntent();
  const aiActionTouchIntent = useHomeTouchIntent();
  const storageToggleTouchIntent = useHomeTouchIntent();
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
  const showStarterPanel = !pathCount && !sameSpaceCount;
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
  const homeDefaultMembers = getHomeRoomAiMembers(roomAiMembersByRoomId, room);
  const publicRoom = getHomePublicRoom(rooms);
  const shouldShowInitialAiGuide = showStarterPanel && !homeDefaultMembers.length && !initialAiGuideDismissed && homeSideMode !== "ai";
  const showHomeAiPanel = homeSideMode === "ai" || shouldShowInitialAiGuide;

  async function handleHomeAiMembersChange(nextMembers) {
    if (Array.isArray(nextMembers) && nextMembers.length) {
      setHomeSideMode("ai");
      setInitialAiGuideDismissed(true);
      writeHomeInitialAiGuideDismissed(currentUserId, true);
    }
    return onRoomAiMembersSave(nextMembers);
  }

  function closeHomeAiPanel() {
    setHomeSideMode("");
    if (!homeDefaultMembers.length) {
      setInitialAiGuideDismissed(true);
      writeHomeInitialAiGuideDismissed(currentUserId, true);
    }
  }

  function toggleHomeAiPanel() {
    if (showHomeAiPanel && homeSideMode === "ai") {
      closeHomeAiPanel();
      return;
    }
    setHomeSideMode("ai");
  }

  useEffect(() => {
    setInitialAiGuideDismissed(readHomeInitialAiGuideDismissed(currentUserId));
  }, [currentUserId]);

  useEffect(() => {
    if (!previewObjectKey || previewCandidates.some((thinkingObject) => thinkingObject.objectKey === previewObjectKey)) return;
    setPreviewObjectKey("");
  }, [previewKeySignature, previewObjectKey]);

  return (
    <section className={`home-dashboard ${hasThinkingObjects && !showStarterPanel ? "has-thinking-objects" : "is-empty"} ${showStarterPanel ? "is-starter" : ""}`} aria-label="Home">
      <div className="home-dashboard-inner">
        <header className="home-hero">
          <div className="home-hero-copy">
            <span className="home-kicker">个人讨论室 · 默认入口</span>
            <h1>{homeName}</h1>
            <p>回到最近留下痕迹的事情，而不是翻找一条条对话记录。</p>
          </div>
          <div className="home-hero-actions">
            <button type="button" className="home-action is-primary focus-ring" {...createActionTouchIntent} onClick={onCreateConversation}>
              新建对话
            </button>
            <button
              type="button"
              className={`home-action focus-ring ${showHomeAiPanel ? "is-active" : ""}`}
              {...aiActionTouchIntent}
              onClick={toggleHomeAiPanel}
              aria-expanded={showHomeAiPanel}
            >
              AI 阵容
            </button>
          </div>
        </header>

        {showStarterPanel ? (
          <>
            <div className="home-starter-stack">
              <HomeStarterPanel
                hasStoredObjects={hasThinkingObjects}
                storageCount={storageCount}
                defaultMembers={homeDefaultMembers}
                publicRoom={publicRoom}
                onCreateConversation={onCreateConversation}
                onOpenConversation={onOpenConversation}
              />
              {storageCount ? (
                <section className="home-storage-section" aria-label="更早和测试性对话">
                  <button
                    type="button"
                    className="home-storage-toggle focus-ring"
                    {...storageToggleTouchIntent}
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
            {showHomeAiPanel ? (
              <HomeDefaultAiPanel
                isOpen={true}
                variant={shouldShowInitialAiGuide ? "starter" : "default"}
                members={homeDefaultMembers}
                availableAis={availableAis}
                thinkingAdapters={thinkingAdapters}
                readOnly={readOnly}
                loadError={aiConfigError?.room || aiConfigError?.models || aiConfigError?.thinking || ""}
                onChange={handleHomeAiMembersChange}
                onClose={closeHomeAiPanel}
              />
            ) : (
              <HomeStarterAside homeName={homeName} defaultMembers={homeDefaultMembers} hasStoredObjects={hasThinkingObjects} />
            )}
          </>
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
                  {...storageToggleTouchIntent}
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

        {hasThinkingObjects && !showStarterPanel ? (
          showHomeAiPanel ? (
            <HomeDefaultAiPanel
              isOpen={true}
              members={homeDefaultMembers}
              availableAis={availableAis}
              thinkingAdapters={thinkingAdapters}
              readOnly={readOnly}
              loadError={aiConfigError?.room || aiConfigError?.models || aiConfigError?.thinking || ""}
              onChange={handleHomeAiMembersChange}
              onClose={closeHomeAiPanel}
            />
          ) : (
            <HomeObjectPeek
              thinkingObject={previewObject}
              members={previewMembers}
              isWarmest={warmestObjectKey === previewObject?.objectKey}
              onOpen={onOpenConversation}
            />
          )
        ) : null}
      </div>
    </section>
  );
}
