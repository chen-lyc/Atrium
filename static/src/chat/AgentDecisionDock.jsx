import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "../constants.js";
import { getAiAvatarUrl, getAiMemberName } from "./AiTeamEditor.jsx";

const TYPE_LABELS = {
  context: "讨论白板",
  whiteboard: "讨论白板",
  question: "开放问题",
  phase: "讨论阶段",
  process: "讨论流程",
  note: "笔记",
  tool: "工具",
  resource: "资源"
};

const CONVERT_ACTIONS = [
  { key: "ordinary_reply", label: "作为普通发言" },
  { key: "open_question", label: "列为开放问题" },
  { key: "note", label: "转为笔记" },
  { key: "later", label: "稍后处理" }
];

function getProposalTypeLabel(proposal) {
  const type = String(proposal?.type || "").trim().toLowerCase();
  return TYPE_LABELS[type] || "上下文提议";
}

function findProposalMember(proposal, aiMembers) {
  if (!proposal || !Array.isArray(aiMembers)) return null;
  const aiId = String(proposal.aiId ?? proposal.ai_id ?? "");
  if (aiId) {
    const byId = aiMembers.find((member) => String(member.aiId ?? member.ai_id ?? "") === aiId);
    if (byId) return byId;
  }
  const provider = String(proposal.provider || "").toLowerCase();
  const model = String(proposal.model || "").toLowerCase();
  if (provider || model) {
    const byModel = aiMembers.find((member) => {
      const memberProvider = String(member.provider || "").toLowerCase();
      const memberModel = String(member.model || "").toLowerCase();
      return (!provider || memberProvider === provider) && (!model || memberModel === model);
    });
    if (byModel) return byModel;
  }
  return null;
}

function getProposalAiName(proposal, member) {
  return proposal?.displayName || proposal?.aiName || proposal?.name || (member ? getAiMemberName(member) : "AI");
}

function getProposalAvatar(proposal, member) {
  return proposal?.avatarUrl || proposal?.avatar_url || (member ? getAiAvatarUrl(member) : "");
}

export default function AgentDecisionDock({
  proposals = [],
  aiMembers = [],
  onAccept = () => {},
  onReject = () => {},
  onConvert = () => {}
}) {
  const [elseOpen, setElseOpen] = useState(false);
  const activeProposal = proposals[0] || null;
  const member = useMemo(() => findProposalMember(activeProposal, aiMembers), [activeProposal, aiMembers]);
  const aiName = getProposalAiName(activeProposal, member);
  const avatarUrl = getProposalAvatar(activeProposal, member);
  const typeLabel = getProposalTypeLabel(activeProposal);
  const primaryActionLabel = activeProposal?.actionLabel || "写入白板";
  const rejectActionLabel = activeProposal?.rejectLabel || "暂不写入";
  const remainingCount = Math.max(0, proposals.length - 1);

  useEffect(() => {
    setElseOpen(false);
  }, [activeProposal?.id]);

  return (
    <AnimatePresence>
      {activeProposal ? (
        <motion.section
          key={activeProposal.id}
          className="agent-decision-dock"
          role="region"
          aria-label="AI 上下文提议"
          aria-live="polite"
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.985 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <div className="agent-decision-main">
            <div className="agent-decision-identity">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span aria-hidden="true">{aiName.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="agent-decision-copy">
              <div className="agent-decision-kicker">
                <span>{aiName}</span>
                <span>{typeLabel}</span>
                {activeProposal.sourceLabel ? <span>{activeProposal.sourceLabel}</span> : null}
              </div>
              <div className="agent-decision-title">{activeProposal.title || activeProposal.actionLabel || "是否更新讨论白板"}</div>
              {activeProposal.reason ? <p>{activeProposal.reason}</p> : null}
            </div>
            {remainingCount ? <div className="agent-decision-count">+{remainingCount}</div> : null}
          </div>

          <div className="agent-decision-actions">
            <button type="button" className="agent-decision-action is-primary focus-ring" onClick={() => onAccept(activeProposal)}>
              {primaryActionLabel}
            </button>
            <button type="button" className="agent-decision-action focus-ring" onClick={() => onReject(activeProposal)}>
              {rejectActionLabel}
            </button>
            <div className="agent-decision-else">
              <button
                type="button"
                className="agent-decision-action focus-ring"
                onClick={() => setElseOpen((value) => !value)}
                aria-expanded={elseOpen}
              >
                改为
              </button>
              <AnimatePresence>
                {elseOpen ? (
                  <motion.div
                    className="agent-decision-menu"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.14, ease: EASE }}
                  >
                    {CONVERT_ACTIONS.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        className="focus-ring"
                        onClick={() => onConvert(activeProposal, action.key)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
