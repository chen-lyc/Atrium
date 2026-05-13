import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, THINKING_MODE_OPTIONS } from "../constants.js";
import {
  getApiErrorMessage,
  getModelDisplayName,
  getThinkingModeFromMember,
  getThinkingModeLabel,
  resolveThinkingAdapterUrl
} from "../utils.js";

const CONTENT_THINKING_KEYS = new Set(["aggressive", "conservative", "comprehensive", "counterexample", "convergent", "divergent"]);
const FEATURED_MODELS_PER_PROVIDER = 2;
const PROVIDER_LABELS = {
  deepseek: "DeepSeek",
  qwen: "Qwen",
  claude: "Claude",
  openai: "OpenAI"
};

function normalizeProvider(provider) {
  return String(provider || "other").trim().toLowerCase() || "other";
}

function getProviderLabel(provider) {
  const key = resolveProvider({ provider });
  return PROVIDER_LABELS[key] || key.replace(/(^|-)([a-z])/g, (_, sep, char) => `${sep}${char.toUpperCase()}`);
}

function resolveProvider(member) {
  const provider = normalizeProvider(member?.provider);
  if (provider && provider !== "other") return provider;
  const model = String(member?.model || "").trim().toLowerCase();
  if (model.startsWith("deepseek")) return "deepseek";
  if (model.startsWith("qwen")) return "qwen";
  return "other";
}

function getAiAvatarUrl(member) {
  const explicit = member?.avatarUrl || member?.avatar_url;
  if (explicit) return explicit;
  const provider = resolveProvider(member);
  if (provider === "deepseek") return "/avatars/deepseek-logo.svg";
  if (provider === "qwen") return "/avatars/qwen-logo.svg";
  return "/avatars/deepseek-logo.svg";
}

function hasProviderCollision(members) {
  if (!members || members.length < 2) return false;
  const counts = new Map();
  for (const m of members) {
    const provider = resolveProvider(m);
    if (provider && provider !== "other") {
      counts.set(provider, (counts.get(provider) || 0) + 1);
    }
  }
  for (const count of counts.values()) {
    if (count > 1) return true;
  }
  return false;
}

function getAiMemberName(member) {
  return getModelDisplayName(member, member?.displayName || member?.display_name || member?.provider || (member?.aiId ? `AI ${member.aiId}` : "AI"));
}

function getAiShortName(member) {
  const model = String(member?.model || "").trim();
  if (!model) return getAiMemberName(member);
  return model
    .replace(/^deepseek-/i, "")
    .replace(/^qwen/i, "qwen ")
    .replace(/-/g, " ")
    .replace(/\bv(\d)/i, "V$1")
    .replace(/\bplus\b/i, "Plus")
    .replace(/\bpro\b/i, "Pro")
    .replace(/\bflash\b/i, "Flash")
    .trim();
}

function mergeAiMemberOptions(...groups) {
  const byId = new Map();
  groups.flat().forEach((member) => {
    const aiId = Number(member?.aiId ?? member?.ai_id ?? member?.id);
    if (!Number.isSafeInteger(aiId) || aiId <= 0 || byId.has(aiId)) return;
    byId.set(aiId, {
      ...member,
      aiId,
      id: aiId,
      avatarUrl: member?.avatarUrl || member?.avatar_url || "",
      displayName: member?.displayName || member?.display_name || ""
    });
  });
  return [...byId.values()];
}

function buildMemberWithThinking(member, thinkingKey, customText, thinkingAdapters) {
  const isCustom = thinkingKey === "custom";
  return {
    ...member,
    aiId: Number(member?.aiId ?? member?.ai_id ?? member?.id),
    id: Number(member?.aiId ?? member?.ai_id ?? member?.id),
    avatarUrl: member?.avatarUrl || member?.avatar_url || "",
    displayName: member?.displayName || member?.display_name || "",
    adapterUrl: isCustom ? "" : resolveThinkingAdapterUrl(thinkingKey, thinkingAdapters),
    customAdapterText: isCustom ? customText || member.customAdapterText || "" : ""
  };
}

function sortModels(models) {
  return [...models].sort((a, b) => {
    const providerCompare = resolveProvider(a).localeCompare(resolveProvider(b));
    if (providerCompare) return providerCompare;
    const aRank = /pro|plus/i.test(a.model) ? 0 : /flash/i.test(a.model) ? 1 : 2;
    const bRank = /pro|plus/i.test(b.model) ? 0 : /flash/i.test(b.model) ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.model || "").localeCompare(String(b.model || ""));
  });
}

function groupModelsByProvider(models) {
  const grouped = new Map();
  sortModels(models).forEach((model) => {
    const key = resolveProvider(model);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(model);
  });
  return [...grouped.entries()].map(([provider, items]) => ({ provider, items }));
}

function getProviderVisibleModels(items, selectedById, isExpanded) {
  if (isExpanded || items.length <= FEATURED_MODELS_PER_PROVIDER) return items;
  const featured = items.slice(0, FEATURED_MODELS_PER_PROVIDER);
  const visibleIds = new Set(featured.map((item) => item.aiId));
  const selectedHidden = items.filter((item) => selectedById.has(item.aiId) && !visibleIds.has(item.aiId));
  return [...featured, ...selectedHidden];
}

function ThinkingPicker({
  value = "default",
  customText = "",
  onSelect,
  disabled = false
}) {
  const [draft, setDraft] = useState(customText || "");
  const [customOpen, setCustomOpen] = useState(value === "custom");
  const metaOptions = THINKING_MODE_OPTIONS.filter((option) => option.key === "default" || option.key === "custom");
  const contentOptions = THINKING_MODE_OPTIONS.filter((option) => CONTENT_THINKING_KEYS.has(option.key));

  useEffect(() => {
    setDraft(customText || "");
    setCustomOpen(value === "custom");
  }, [customText, value]);

  function handleOption(option) {
    if (disabled) return;
    if (option.key === "custom") {
      setCustomOpen(true);
      return;
    }
    onSelect(option.key, "");
  }

  return (
    <div className="thinking-picker" aria-label="Thinking 选择">
      <div className="thinking-picker-group is-meta">
        {metaOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`thinking-card ${value === option.key ? "is-active" : ""}`}
            onClick={() => handleOption(option)}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="thinking-picker-group">
        {contentOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`thinking-card ${value === option.key ? "is-active" : ""}`}
            onClick={() => handleOption(option)}
            disabled={disabled}
          >
            {option.label}
          </button>
        ))}
      </div>
      {customOpen ? (
        <div className="thinking-custom">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="写下这位 AI 要遵循的思考方式"
            rows={3}
            disabled={disabled}
          />
          <button type="button" onClick={() => onSelect("custom", draft)} disabled={disabled || !draft.trim()}>
            应用
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AiIdentity({ member, compact = false, members = null }) {
  const preferModel = hasProviderCollision(members) && member?.model;
  const displayName = preferModel
    ? (compact ? getAiShortName(member) : String(member.model).trim())
    : (compact ? getAiShortName(member) : getAiMemberName(member));
  return (
    <span className={`ai-identity ${compact ? "is-compact" : ""}`}>
      <img src={getAiAvatarUrl(member)} alt="" />
      <span>{displayName}</span>
    </span>
  );
}

function ModelThinkingLayer({
  model,
  selectedMember,
  thinkingAdapters,
  onApply,
  onRemove,
  pending,
  members = []
}) {
  const thinkingKey = getThinkingModeFromMember(selectedMember || model);
  return (
    <motion.div
      className="ai-model-thinking-layer"
      initial={{ opacity: 0, y: -4, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -3, scale: 0.99 }}
      transition={{ duration: 0.14, ease: EASE }}
    >
      <div className="ai-model-thinking-head">
        <AiIdentity member={model} members={members} />
        {selectedMember ? (
          <button type="button" onClick={() => onRemove(model)} disabled={pending}>
            移除
          </button>
        ) : null}
      </div>
      <ThinkingPicker
        value={thinkingKey}
        customText={selectedMember?.customAdapterText || ""}
        disabled={pending}
        onSelect={(key, customText) => onApply(model, key, customText)}
      />
    </motion.div>
  );
}

function AiModelSelector({
  models = [],
  members = [],
  thinkingAdapters = [],
  readOnly = false,
  onChange = async () => [],
  className = ""
}) {
  const [editingAiId, setEditingAiId] = useState(null);
  const [expandedProviders, setExpandedProviders] = useState(() => new Set());
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const selectorRef = useRef(null);
  const selectedById = useMemo(() => new Map(members.map((member) => [Number(member.aiId), member])), [members]);
  const groups = useMemo(() => groupModelsByProvider(mergeAiMemberOptions(models, members)), [models, members]);
  const canEdit = !readOnly && !pending;

  useEffect(() => {
    if (editingAiId == null) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".ai-model-card-wrap.is-editing")) return;
      setEditingAiId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [editingAiId]);

  function toggleProvider(provider) {
    setExpandedProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  async function persist(nextMembers, successText = "") {
    if (!canEdit) return [];
    setPending(true);
    setStatus("");
    try {
      const synced = await onChange(nextMembers);
      setStatus(successText);
      return synced;
    } catch (error) {
      setStatus(getApiErrorMessage(error, "AI 团队同步失败"));
      throw error;
    } finally {
      setPending(false);
    }
  }

  async function applyThinking(model, thinkingKey, customText = "") {
    const selectedMember = selectedById.get(model.aiId);
    const nextMember = buildMemberWithThinking(selectedMember || model, thinkingKey, customText, thinkingAdapters);
    const nextMembers = selectedMember
      ? members.map((member) => member.aiId === model.aiId ? nextMember : member)
      : [...members, nextMember];
    try {
      await persist(nextMembers, selectedMember ? "已更新" : "已加入席位");
      setEditingAiId(null);
    } catch {
      // Inline status carries the failure reason.
    }
  }

  async function removeMember(model) {
    try {
      await persist(members.filter((member) => member.aiId !== model.aiId), "已移除");
      setEditingAiId(null);
    } catch {
      // Inline status carries the failure reason.
    }
  }

  if (!groups.length) {
    return <div className={`ai-model-selector ${className}`.trim()}><div className="ai-empty-line">模型目录暂时不可用</div></div>;
  }

  return (
    <div className={`ai-model-selector ${className}`.trim()}>
      <div className="ai-provider-grid">
        {groups.map((group) => {
          const isExpanded = expandedProviders.has(group.provider);
          const visibleModels = getProviderVisibleModels(group.items, selectedById, isExpanded);
          const visibleIds = new Set(visibleModels.map((item) => item.aiId));
          const hiddenCount = group.items.filter((item) => !visibleIds.has(item.aiId)).length;
          return (
            <section key={group.provider} className="ai-provider-group">
              <div className="ai-provider-title">
                <span>{getProviderLabel(group.provider)}</span>
                {hiddenCount || isExpanded ? (
                  <button
                    type="button"
                    className="ai-provider-toggle"
                    onClick={() => toggleProvider(group.provider)}
                    disabled={pending}
                  >
                    {isExpanded ? "收起" : `展开 ${hiddenCount}`}
                  </button>
                ) : null}
              </div>
              <div className="ai-model-card-row">
                {visibleModels.map((model) => {
                  const selectedMember = selectedById.get(model.aiId);
                  const isEditing = editingAiId === model.aiId;
                  return (
                    <div key={model.aiId} className={`ai-model-card-wrap ${isEditing ? "is-editing" : ""}`}>
                      <button
                        type="button"
                        className={`ai-model-card ${selectedMember ? "is-selected" : ""}`}
                        onClick={() => canEdit && setEditingAiId(isEditing ? null : model.aiId)}
                        disabled={!canEdit}
                      >
                        <AiIdentity member={model} members={members} />
                        {selectedMember ? <span className="ai-selected-mark" aria-hidden="true">✓</span> : null}
                      </button>
                      <AnimatePresence>
                        {isEditing ? (
                          <ModelThinkingLayer
                            model={model}
                            selectedMember={selectedMember}
                            thinkingAdapters={thinkingAdapters}
                            onApply={applyThinking}
                            onRemove={removeMember}
                            pending={pending}
                            members={members}
                          />
                        ) : null}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="ai-sync-line">{pending ? "同步中" : status || " "}</div>
    </div>
  );
}

function AiSeatStrip({
  members = [],
  thinkingAdapters = [],
  readOnly = false,
  onChange = async () => [],
  emptyText = "未设置 AI",
  className = ""
}) {
  const [openAiId, setOpenAiId] = useState(null);
  const [thinkingOpenAiId, setThinkingOpenAiId] = useState(null);
  const [pending, setPending] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (thinkingOpenAiId == null) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".ai-seat-thinking-panel")) return;
      setThinkingOpenAiId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [thinkingOpenAiId]);

  function open(member) {
    window.clearTimeout(timerRef.current);
    setOpenAiId(member.aiId);
  }

  function queueClose() {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpenAiId(null);
      setThinkingOpenAiId(null);
    }, 140);
  }

  function handleSeatBlur(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    queueClose();
  }

  async function persist(nextMembers) {
    if (readOnly || pending) return;
    setPending(true);
    try {
      await onChange(nextMembers);
    } finally {
      setPending(false);
    }
  }

  async function updateThinking(member, key, customText) {
    const nextMember = buildMemberWithThinking(member, key, customText, thinkingAdapters);
    await persist(members.map((item) => item.aiId === member.aiId ? nextMember : item));
    setThinkingOpenAiId(null);
    setOpenAiId(null);
  }

  async function removeMember(member) {
    await persist(members.filter((item) => item.aiId !== member.aiId));
    setOpenAiId(null);
  }

  return (
    <div className={`ai-seat-strip ${className}`.trim()}>
      {members.length ? members.map((member) => {
        const isOpen = openAiId === member.aiId;
        return (
          <div
            key={member.aiId}
            className="ai-seat-wrap"
            onMouseEnter={() => open(member)}
            onMouseLeave={queueClose}
            onFocus={() => open(member)}
            onBlur={handleSeatBlur}
          >
            <button
              type="button"
              className="ai-seat-pill"
              aria-label={getAiMemberName(member)}
              aria-disabled={readOnly}
            >
              <img src={getAiAvatarUrl(member)} alt="" />
            </button>
            <AnimatePresence>
              {isOpen ? (
                <motion.div
                  className="ai-seat-popover"
                  initial={{ opacity: 0, y: -4, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -3, scale: 0.99 }}
                  transition={{ duration: 0.14, ease: EASE }}
                >
                  <div className="ai-seat-popover-head">
                    <AiIdentity member={member} members={members} />
                    <button type="button" onClick={() => removeMember(member)} disabled={readOnly || pending}>
                      移除
                    </button>
                  </div>
                  <button
                    type="button"
                    className="ai-seat-thinking-label"
                    onClick={() => setThinkingOpenAiId((current) => current === member.aiId ? null : member.aiId)}
                    disabled={readOnly || pending}
                  >
                    {getThinkingModeLabel(member)}
                  </button>
                  <AnimatePresence>
                    {thinkingOpenAiId === member.aiId ? (
                      <motion.div
                        className="ai-seat-thinking-panel"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.16, ease: EASE }}
                      >
                        <ThinkingPicker
                          value={getThinkingModeFromMember(member)}
                          customText={member.customAdapterText || ""}
                          disabled={readOnly || pending}
                          onSelect={(key, customText) => updateThinking(member, key, customText)}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      }) : (
        <span className="ai-seat-empty">{emptyText}</span>
      )}
    </div>
  );
}

function AiRosterList({
  members = [],
  thinkingAdapters = [],
  readOnly = false,
  onChange = async () => [],
  emptyText = "房间默认阵容为空"
}) {
  const [editingAiId, setEditingAiId] = useState(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (editingAiId == null) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".ai-roster-row.is-editing")) return;
      setEditingAiId(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [editingAiId]);

  async function persist(nextMembers) {
    if (readOnly || pending) return;
    setPending(true);
    try {
      await onChange(nextMembers);
    } finally {
      setPending(false);
    }
  }

  async function updateThinking(member, key, customText) {
    const nextMember = buildMemberWithThinking(member, key, customText, thinkingAdapters);
    await persist(members.map((item) => item.aiId === member.aiId ? nextMember : item));
    setEditingAiId(null);
  }

  if (!members.length) return <div className="ai-roster-empty">{emptyText}</div>;

  return (
    <div className="ai-roster-list">
      {members.map((member) => {
        const editing = editingAiId === member.aiId;
        return (
          <div key={member.aiId} className={`ai-roster-row ${editing ? "is-editing" : ""}`}>
            <div className="ai-roster-main">
              <AiIdentity member={member} members={members} />
              <button type="button" className="ai-roster-thinking" onClick={() => setEditingAiId(editing ? null : member.aiId)} disabled={readOnly || pending}>
                {getThinkingModeLabel(member)}
              </button>
            </div>
            <div className="ai-roster-actions">
              <button type="button" onClick={() => setEditingAiId(editing ? null : member.aiId)} disabled={readOnly || pending} aria-label={`修改 ${getAiMemberName(member)} thinking`}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.7 3.3 12.7 6.3M3.2 12.8l2.9-.6 6.8-6.8a1.2 1.2 0 0 0-1.7-1.7L4.4 10.5l-.8 2.7Z" />
                </svg>
              </button>
              <button type="button" onClick={() => persist(members.filter((item) => item.aiId !== member.aiId))} disabled={readOnly || pending} aria-label={`移除 ${getAiMemberName(member)}`}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <AnimatePresence>
              {editing ? (
                <motion.div
                  className="ai-roster-thinking-panel"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.16, ease: EASE }}
                >
                  <ThinkingPicker
                    value={getThinkingModeFromMember(member)}
                    customText={member.customAdapterText || ""}
                    disabled={readOnly || pending}
                    onSelect={(key, customText) => updateThinking(member, key, customText)}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function ModalLayer({
  isOpen,
  title,
  subtitle = "",
  onClose,
  children
}) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="ai-modal-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: EASE }}
        >
          <button type="button" className="ai-modal-backdrop" aria-label="关闭" onClick={onClose} />
          <motion.section
            className="ai-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <header className="ai-modal-head">
              <div>
                <h2 id={titleId}>{title}</h2>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
              <button type="button" className="ai-modal-close" onClick={onClose} aria-label="关闭">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>
            <div className="ai-modal-body">{children}</div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const AiTeamModal = ModalLayer;

export {
  AiIdentity,
  AiModelSelector,
  AiRosterList,
  AiSeatStrip,
  AiTeamModal,
  ModalLayer,
  ThinkingPicker,
  getAiAvatarUrl,
  getAiMemberName,
  mergeAiMemberOptions
};

export default AiModelSelector;
