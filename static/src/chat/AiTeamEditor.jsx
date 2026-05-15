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
const RADIAL_ADAPTER_OPTIONS = Object.freeze([
  { key: "aggressive", label: "激进", clockAngle: 0 },
  { key: "comprehensive", label: "全面", clockAngle: 60 },
  { key: "convergent", label: "收敛", clockAngle: 120 },
  { key: "conservative", label: "保守", clockAngle: 180 },
  { key: "counterexample", label: "反例", clockAngle: 240 },
  { key: "divergent", label: "发散", clockAngle: 300 }
].map((option) => {
  const radians = (option.clockAngle * Math.PI) / 180;
  const radius = 74;
  return {
    ...option,
    x: Math.sin(radians) * radius,
    y: -Math.cos(radians) * radius
  };
}));
const FEATURED_MODELS_PER_PROVIDER = 2;
const PROVIDER_LABELS = {
  deepseek: "DeepSeek",
  qwen: "Qwen",
  claude: "Claude",
  openai: "OpenAI"
};
const SEAT_BREATH_MIN_SECONDS = 3.45;
const SEAT_BREATH_DEPTH_MIN = 0.006;
const SEAT_NEUTRAL_VISUAL_PROFILE = Object.freeze({
  rhythm: "organic",
  flow: "neutral"
});
const SEAT_ADAPTER_VISUAL_PROFILES = Object.freeze({
  aggressive: {
    durationBase: 2.34,
    durationJitter: 0.18,
    rhythm: "organic",
    flow: "neutral",
    depthScale: 1.22,
    auraScale: 1.08,
    outlineScale: 1.04,
    bodyStyle: {
      "--ai-seat-bg-main-share": "94%",
      "--ai-seat-bg-light-share": "6%",
      "--ai-seat-border-line-share": "70%",
      "--ai-seat-inner-shade-share": "1.5%",
      "--ai-seat-shadow-y": "7px",
      "--ai-seat-shadow-blur": "18px",
      "--ai-seat-shadow-alpha": "0.055",
      "--ai-seat-aura-center-share": "9%",
      "--ai-seat-aura-mid-share": "3.5%",
      "--ai-seat-aura-mid-stop": "43%",
      "--ai-seat-aura-edge-stop": "78%"
    }
  },
  conservative: {
    durationBase: 7.08,
    durationJitter: 0.42,
    rhythm: "organic",
    flow: "neutral",
    depthScale: 0.72,
    auraScale: 0.68,
    outlineScale: 1.14,
    bodyStyle: {
      "--ai-seat-bg-main-share": "98%",
      "--ai-seat-bg-light-share": "2%",
      "--ai-seat-border-line-share": "88%",
      "--ai-seat-inner-shade-share": "4%",
      "--ai-seat-shadow-y": "11px",
      "--ai-seat-shadow-blur": "22px",
      "--ai-seat-shadow-alpha": "0.07",
      "--ai-seat-aura-center-share": "6%",
      "--ai-seat-aura-mid-share": "2%",
      "--ai-seat-aura-mid-stop": "40%",
      "--ai-seat-aura-edge-stop": "68%",
      "--ai-seat-outline-peak-scale": "1.01",
      "--ai-seat-outline-tail-scale": "1.003"
    }
  },
  comprehensive: {
    durationBase: 4.72,
    durationJitter: 0,
    rhythm: "even",
    flow: "neutral",
    depthScale: 0.82,
    auraScale: 0.96,
    outlineScale: 0.96,
    bodyStyle: {
      "--ai-seat-aura-center-share": "7%",
      "--ai-seat-aura-mid-share": "4%",
      "--ai-seat-aura-mid-stop": "55%",
      "--ai-seat-aura-edge-stop": "84%",
      "--ai-seat-aura-peak-scale": "1.014",
      "--ai-seat-outline-peak-scale": "1.014"
    }
  },
  counterexample: {
    durationBase: 4.38,
    durationJitter: 0.18,
    rhythm: "interrupted",
    flow: "neutral",
    depthScale: 0.96,
    auraScale: 0.9,
    outlineScale: 1.08,
    bodyStyle: {
      "--ai-seat-border-line-share": "86%",
      "--ai-seat-aura-center-share": "7%",
      "--ai-seat-aura-mid-share": "2.5%",
      "--ai-seat-aura-mid-stop": "42%",
      "--ai-seat-aura-edge-stop": "70%",
      "--ai-seat-edge-mark-share": "18%",
      "--ai-seat-edge-mark-size": "18%",
      "--ai-seat-edge-mark-x": "82%",
      "--ai-seat-edge-mark-y": "18%",
      "--ai-seat-outline-peak-scale": "1.013",
      "--ai-seat-outline-tail-scale": "1.004"
    }
  },
  divergent: {
    durationBase: 4.36,
    durationJitter: 0.32,
    rhythm: "organic",
    flow: "outward",
    depthScale: 0.86,
    auraScale: 0.92,
    outlineScale: 0.6
  },
  convergent: {
    durationBase: 4.58,
    durationJitter: 0.22,
    rhythm: "organic",
    flow: "inward",
    depthScale: 0.74,
    auraScale: 0.82,
    outlineScale: 1.1
  }
});
const SEAT_EXPLICIT_THINKING_KEYS = new Set(THINKING_MODE_OPTIONS.map((option) => option.key));

function getSeatVitalSeed(member, index) {
  const source = [
    member?.aiId ?? member?.ai_id ?? member?.id ?? index,
    member?.provider,
    member?.model,
    member?.displayName || member?.display_name
  ].join(":");
  let seed = 0;
  for (let i = 0; i < source.length; i += 1) {
    seed = (seed * 31 + source.charCodeAt(i)) % 9973;
  }
  return seed + index * 97;
}

function getSeatThinkingMode(member) {
  const explicit = member?.thinkingMode ?? member?.thinking_mode ?? member?.adapterKey ?? member?.adapter;
  if (typeof explicit === "string" && SEAT_EXPLICIT_THINKING_KEYS.has(explicit)) return explicit;
  return getThinkingModeFromMember(member);
}

function getSeatAdapterVisualProfile(thinkingMode) {
  return SEAT_ADAPTER_VISUAL_PROFILES[thinkingMode] || SEAT_NEUTRAL_VISUAL_PROFILE;
}

function getSeedUnit(seed, salt) {
  return ((seed * salt) % 1000) / 1000;
}

function getSeatVitalStyle(member, index, visualProfile = SEAT_NEUTRAL_VISUAL_PROFILE) {
  const seed = getSeatVitalSeed(member, index);
  const isNeutral = visualProfile === SEAT_NEUTRAL_VISUAL_PROFILE;
  const duration = isNeutral
    ? SEAT_BREATH_MIN_SECONDS + (seed % 150) / 100
    : visualProfile.durationBase + getSeedUnit(seed, 41) * visualProfile.durationJitter;
  const delay = isNeutral
    ? -((seed * 37) % 430) / 100
    : -(getSeedUnit(seed, 37) * duration);
  const baseDepth = SEAT_BREATH_DEPTH_MIN + (seed % 8) / 1000;
  const baseAura = 0.14 + ((seed >> 2) % 7) / 100;
  const baseOutline = 0.27 + ((seed >> 4) % 8) / 100;
  const depth = baseDepth * (visualProfile.depthScale ?? 1);
  const aura = baseAura * (visualProfile.auraScale ?? 1);
  const outline = baseOutline * (visualProfile.outlineScale ?? 1);
  const interruptDuration = duration * (3.7 + getSeedUnit(seed, 61) * 1.05);
  const interruptDelay = -(getSeedUnit(seed, 73) * interruptDuration);
  const flowStyle = visualProfile.flow === "outward"
    ? {
        "--ai-seat-bg-main-share": "94%",
        "--ai-seat-bg-light-share": "6%",
        "--ai-seat-border-line-share": "48%",
        "--ai-seat-inner-shade-share": "1.2%",
        "--ai-seat-shadow-y": "8px",
        "--ai-seat-shadow-blur": "18px",
        "--ai-seat-shadow-alpha": "0.045",
        "--ai-seat-outline-inset": "0px",
        "--ai-seat-aura-inset": "0px",
        "--ai-seat-aura-center-share": "4.5%",
        "--ai-seat-aura-mid-share": "4%",
        "--ai-seat-aura-mid-stop": "62%",
        "--ai-seat-aura-edge-stop": "98%",
        "--ai-seat-aura-rest-scale": "0.996",
        "--ai-seat-aura-peak-scale": "1.018",
        "--ai-seat-aura-tail-scale": "1.008",
        "--ai-seat-outline-peak-scale": "1.006",
        "--ai-seat-outline-tail-scale": "1.002"
      }
    : visualProfile.flow === "inward"
      ? {
          "--ai-seat-bg-main-share": "97%",
          "--ai-seat-bg-light-share": "3%",
          "--ai-seat-border-line-share": "88%",
          "--ai-seat-inner-shade-share": "3%",
          "--ai-seat-shadow-y": "8px",
          "--ai-seat-shadow-blur": "18px",
          "--ai-seat-shadow-alpha": "0.055",
          "--ai-seat-outline-inset": "0px",
          "--ai-seat-aura-inset": "2px",
          "--ai-seat-aura-center-share": "9%",
          "--ai-seat-aura-mid-share": "1.4%",
          "--ai-seat-aura-mid-stop": "34%",
          "--ai-seat-aura-edge-stop": "50%",
          "--ai-seat-aura-rest-scale": "0.996",
          "--ai-seat-aura-peak-scale": "1.006",
          "--ai-seat-aura-tail-scale": "1",
          "--ai-seat-outline-peak-scale": "1.006",
          "--ai-seat-outline-tail-scale": "1.001"
        }
      : {};
  return {
    "--ai-seat-breath-duration": `${duration.toFixed(2)}s`,
    "--ai-seat-breath-delay": `${delay.toFixed(2)}s`,
    "--ai-seat-breath-peak-scale": (1 + depth).toFixed(3),
    "--ai-seat-breath-tail-scale": (1 + depth * 0.42).toFixed(3),
    "--ai-seat-breath-alert-scale": (1 + depth * 0.64).toFixed(3),
    "--ai-seat-aura-opacity": aura.toFixed(2),
    "--ai-seat-aura-rest-opacity": (aura * 0.62).toFixed(2),
    "--ai-seat-aura-tail-opacity": (aura * 0.58).toFixed(2),
    "--ai-seat-outline-opacity": outline.toFixed(2),
    "--ai-seat-outline-rest-opacity": (outline * 0.72).toFixed(2),
    "--ai-seat-outline-tail-opacity": (outline * 0.62).toFixed(2),
    "--ai-seat-interrupt-duration": `${interruptDuration.toFixed(2)}s`,
    "--ai-seat-interrupt-delay": `${interruptDelay.toFixed(2)}s`,
    ...flowStyle,
    ...(visualProfile.bodyStyle || {})
  };
}

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
    thinkingMode: thinkingKey,
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
  presentationOnly = false,
  vitalSigns = true,
  onChange = async () => [],
  emptyText = "未设置 AI",
  className = ""
}) {
  const [openAiId, setOpenAiId] = useState(null);
  const [previewThinkingMode, setPreviewThinkingMode] = useState("");
  const [pending, setPending] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  function open(member) {
    window.clearTimeout(timerRef.current);
    setOpenAiId(member.aiId);
    setPreviewThinkingMode("");
  }

  function queueClose() {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setOpenAiId(null);
      setPreviewThinkingMode("");
    }, 160);
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
    setOpenAiId(null);
    setPreviewThinkingMode("");
  }

  async function commitAdapter(member, key) {
    if (pending) return;
    if (getSeatThinkingMode(member) !== key) {
      await updateThinking(member, key, "");
      return;
    }
    setOpenAiId(null);
    setPreviewThinkingMode("");
  }

  const isInteractive = !readOnly && !presentationOnly;
  const stripClassName = [
    "ai-seat-strip",
    vitalSigns ? "has-vital-signs" : "",
    presentationOnly ? "is-presentation-only" : "",
    isInteractive && openAiId != null ? "is-seat-focus-active" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <div className={stripClassName}>
      {members.length ? members.map((member, index) => {
        const isOpen = openAiId === member.aiId;
        const committedThinkingMode = getSeatThinkingMode(member);
        const thinkingMode = isOpen && previewThinkingMode ? previewThinkingMode : committedThinkingMode;
        const visualProfile = getSeatAdapterVisualProfile(thinkingMode);
        const vitalStyle = vitalSigns ? getSeatVitalStyle(member, index, visualProfile) : undefined;
        const wrapClassName = [
          "ai-seat-wrap",
          isOpen ? "is-focused" : "",
          isInteractive && openAiId != null && !isOpen ? "is-muted" : ""
        ].filter(Boolean).join(" ");
        return (
          <div
            key={member.aiId}
            className={wrapClassName}
            data-seat-rhythm={visualProfile.rhythm}
            style={vitalStyle}
            onMouseEnter={isInteractive ? () => open(member) : undefined}
            onMouseLeave={isInteractive ? queueClose : undefined}
            onFocus={isInteractive ? () => open(member) : undefined}
            onBlur={isInteractive ? handleSeatBlur : undefined}
          >
            <button
              type="button"
              className="ai-seat-pill"
              aria-label={getAiMemberName(member)}
              aria-disabled={readOnly || presentationOnly}
              tabIndex={isInteractive ? 0 : -1}
              data-thinking-mode={thinkingMode}
              data-seat-rhythm={visualProfile.rhythm}
              data-seat-flow={visualProfile.flow}
              style={vitalStyle}
            >
              <img src={getAiAvatarUrl(member)} alt="" />
            </button>
            <AnimatePresence>
              {isInteractive && isOpen ? (
                <motion.div
                  className="ai-seat-radial-menu"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.22, ease: EASE }}
                  onMouseEnter={() => window.clearTimeout(timerRef.current)}
                  onMouseLeave={queueClose}
                  aria-label={`${getAiMemberName(member)} adapter 选择`}
                >
                  {RADIAL_ADAPTER_OPTIONS.map((option, optionIndex) => {
                    const optionVisualProfile = getSeatAdapterVisualProfile(option.key);
                    const optionVitalStyle = vitalSigns
                      ? getSeatVitalStyle(
                          { ...member, aiId: `${member.aiId}:${option.key}`, thinkingMode: option.key },
                          index + optionIndex + 11,
                          optionVisualProfile
                        )
                      : undefined;
                    const isActiveAdapter = committedThinkingMode === option.key;
                    return (
                      <motion.button
                        key={option.key}
                        type="button"
                        className={`ai-seat-adapter-option ${isActiveAdapter ? "is-active" : ""}`}
                        initial={{ opacity: 0, x: -28, y: -31, scale: 0.84 }}
                        animate={{ opacity: 1, x: option.x - 28, y: option.y - 31, scale: 1 }}
                        exit={{ opacity: 0, x: -28, y: -31, scale: 0.88 }}
                        transition={{ duration: 0.24, delay: optionIndex * 0.012, ease: EASE }}
                        onMouseEnter={() => setPreviewThinkingMode(option.key)}
                        onFocus={() => setPreviewThinkingMode(option.key)}
                        onClick={() => commitAdapter(member, option.key)}
                        disabled={pending}
                        aria-pressed={isActiveAdapter}
                      >
                        <span
                          className="ai-seat-adapter-option-seat"
                          data-seat-rhythm={optionVisualProfile.rhythm}
                          data-seat-flow={optionVisualProfile.flow}
                          style={optionVitalStyle}
                          aria-hidden="true"
                        >
                          <img src={getAiAvatarUrl(member)} alt="" />
                        </span>
                        <span className="ai-seat-adapter-option-label">{option.label}</span>
                      </motion.button>
                    );
                  })}
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
