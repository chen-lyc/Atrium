import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "../constants.js";
import MessageInput from "../chat/MessageInput.jsx";
import MessageList from "../chat/MessageList.jsx";
import AgentDecisionDock from "../chat/AgentDecisionDock.jsx";
import NoteCaptureToast from "../chat/NoteCaptureToast.jsx";
import { AiSeatStrip } from "../chat/AiTeamEditor.jsx";
import {
  DESIGN_LAB_AI_MEMBERS,
  DESIGN_LAB_HOME_CARDS,
  DESIGN_LAB_MESSAGES,
  DESIGN_LAB_PROPOSALS,
  DESIGN_LAB_THINKING_ADAPTERS
} from "./designLabScenarios.js";

function PreviewShell({ scenario, children }) {
  return (
    <section className="design-lab-preview-card" aria-label={`${scenario.title} 预览`}>
      <header className="design-lab-preview-head">
        <div>
          <span>{scenario.surface}</span>
          <h3>{scenario.title}</h3>
        </div>
        <div className="design-lab-preview-tags">
          {scenario.tags?.map((tag) => <small key={tag}>{tag}</small>)}
        </div>
      </header>
      <div className="design-lab-preview-body">{children}</div>
    </section>
  );
}

function useScriptedPhase(steps, runKey) {
  const timersRef = useRef([]);
  const [phase, setPhase] = useState(steps[0]?.phase || "");

  useEffect(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    setPhase(steps[0]?.phase || "");
    steps.slice(1).forEach((step) => {
      const timer = window.setTimeout(() => setPhase(step.phase), step.delay);
      timersRef.current.push(timer);
    });
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
    };
  }, [runKey]);

  return phase;
}

const CHAT_FLOW_STEPS = [
  { phase: "join", delay: 0 },
  { phase: "brief", delay: 520 },
  { phase: "ai-reply", delay: 1280 },
  { phase: "long-content", delay: 2180 },
  { phase: "interrupted", delay: 3200 }
];

const SEAT_FLOW_STEPS = [
  { phase: "empty", delay: 0 },
  { phase: "joining", delay: 620 },
  { phase: "team", delay: 1320 },
  { phase: "governance", delay: 2180 },
  { phase: "settled", delay: 3600 }
];

const HOME_FLOW_STEPS = [
  { phase: "first", delay: 0 },
  { phase: "second", delay: 1500 },
  { phase: "third", delay: 3000 }
];

const AUTH_FLOW_STEPS = [
  { phase: "arrive", delay: 0 },
  { phase: "ask", delay: 700 },
  { phase: "answer", delay: 1550 },
  { phase: "ready", delay: 2500 }
];

const COMPOSER_FLOW_STEPS = [
  { phase: "empty", delay: 0 },
  { phase: "typing", delay: 420 },
  { phase: "long", delay: 1450 },
  { phase: "sent", delay: 2700 }
];

const MOTION_FLOW_STEPS = [
  { phase: "empty", delay: 0 },
  { phase: "message", delay: 280 },
  { phase: "dock", delay: 1040 },
  { phase: "toast", delay: 1900 },
  { phase: "settled", delay: 3020 }
];

function ChatMessagesPreview({ scenario, runKey }) {
  const phase = useScriptedPhase(CHAT_FLOW_STEPS, runKey);
  const countByPhase = {
    join: 1,
    brief: 2,
    "ai-reply": 3,
    "long-content": 4,
    interrupted: DESIGN_LAB_MESSAGES.length
  };
  const visibleMessages = DESIGN_LAB_MESSAGES.slice(0, countByPhase[phase] || 1);
  const assistantState = phase === "interrupted"
    ? {
        status: "quota-exceeded",
        message: "今日 AI 额度已用完",
        detail: "这个状态平时不容易自然遇到"
      }
    : null;
  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-chat-frame">
        <MessageList
          messages={visibleMessages}
          aiMembers={DESIGN_LAB_AI_MEMBERS}
          hiddenMessageId=""
          shouldAnimateEntry={true}
          entryDelay={0}
          itemAnimationMode="calm"
          stickToBottom={true}
          className="design-lab-message-viewport"
          innerClassName="design-lab-message-inner"
          assistantState={assistantState}
        />
        <div className="design-lab-run-status">
          {phase === "interrupted" ? "AI 中断和额度提示已进入消息尾部" : "消息正在按真实顺序进入时间线"}
        </div>
      </div>
    </PreviewShell>
  );
}

function AiSeatsPreview({ scenario, runKey }) {
  const phase = useScriptedPhase(SEAT_FLOW_STEPS, runKey);
  const members = phase === "empty"
    ? []
    : phase === "joining"
      ? DESIGN_LAB_AI_MEMBERS.slice(0, 1)
      : DESIGN_LAB_AI_MEMBERS;
  const governanceAiIds = phase === "governance" ? [1] : [];
  const status = {
    empty: "房间还没有 AI 成员",
    joining: "DeepSeek Pro 入席",
    team: "三位 AI 成员稳定在场",
    governance: "DeepSeek Pro 提议更新讨论白板",
    settled: "白板处理后席位回到成员在场"
  }[phase] || "";
  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-seat-stage">
        <div className="design-lab-seat-flow-copy">
          <span>{status}</span>
        </div>
        <AiSeatStrip
          members={members}
          thinkingAdapters={DESIGN_LAB_THINKING_ADAPTERS}
          readOnly={true}
          presentationOnly={false}
          vitalSigns={true}
          governanceAiIds={governanceAiIds}
          onChange={async () => DESIGN_LAB_AI_MEMBERS}
          showLabels={true}
          emptyText="当前没有 AI 入席"
          className="is-design-lab"
        />
      </div>
    </PreviewShell>
  );
}

function DecisionDockPreview({ scenario, runKey }) {
  const isStack = scenario.previewType === "decision-stack";
  const phase = useScriptedPhase([
    { phase: "waiting", delay: 0 },
    { phase: "proposal", delay: 620 },
    { phase: "stack", delay: 1500 }
  ], runKey);
  const [result, setResult] = useState("");
  const proposals = isStack && phase === "stack"
    ? DESIGN_LAB_PROPOSALS
    : phase === "waiting" || result
      ? []
      : DESIGN_LAB_PROPOSALS.slice(0, 1);

  useEffect(() => setResult(""), [runKey, scenario.id]);

  function resolve(label) {
    setResult(label);
  }

  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-dock-stage">
        {proposals.length ? (
          <AgentDecisionDock
            proposals={proposals}
            aiMembers={DESIGN_LAB_AI_MEMBERS}
            onAccept={(proposal) => resolve(`已写入：${proposal.actionLabel || "写入白板"}`)}
            onReject={() => resolve("暂不写入：讨论白板保持不变")}
            onConvert={(_, action) => resolve(`已改为：${getGovernanceResolutionLabel(action)}`)}
          />
        ) : (
          <motion.div
            className="design-lab-dock-placeholder"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {result || "AI 提议即将进入"}
          </motion.div>
        )}
      </div>
    </PreviewShell>
  );
}

function createGovernanceFlowMessages(phase, resolution) {
  const now = Date.now();
  const messages = [];
  if (phase !== "writing") {
    messages.push({
      id: "flow-user-brief",
      nickname: "林夏",
      text: "我们把刚才关于“哪些内容能进入共享白板”的分歧先记下来，免得下一轮又从头讨论。",
      timestamp: now - 1000 * 40,
      isSelf: true,
      status: "sent"
    });
  }
  if (["proposal", "accepted", "rejected", "ordinary_reply", "open_question", "note", "later"].includes(phase)) {
    messages.push({
      id: "flow-ai-raise",
      nickname: "__system__",
      text: "DeepSeek Pro 提议把分歧列为开放问题",
      timestamp: now - 1000 * 26,
      status: "sent"
    });
  }
  if (phase === "accepted") {
    messages.push({
      id: "flow-result-accepted",
      nickname: "__system__",
      text: "已列为开放问题：后续多 AI 会带着这个边界继续。",
      timestamp: now - 1000 * 9,
      status: "sent"
    });
  }
  if (phase === "rejected") {
    messages.push({
      id: "flow-result-rejected",
      nickname: "__system__",
      text: "暂不写入：这条分歧不进入讨论白板。",
      timestamp: now - 1000 * 9,
      status: "sent"
    });
  }
  if (phase === "ordinary_reply") {
    messages.push({
      id: "flow-result-ordinary",
      nickname: "DeepSeek Pro",
      text: "那我只作为普通发言补一句：这个分歧值得保留，但现在还不到写进讨论白板的时候。",
      timestamp: now - 1000 * 9,
      isAI: true,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      status: "sent"
    });
  }
  if (phase === "open_question") {
    messages.push({
      id: "flow-result-question",
      nickname: "__system__",
      text: "已列为开放问题：先保留分歧，不直接改写当前结论。",
      timestamp: now - 1000 * 9,
      status: "sent"
    });
  }
  if (phase === "note") {
    messages.push({
      id: "flow-result-note",
      nickname: "__system__",
      text: "已转为笔记：内容进入整理链路，不改变讨论白板。",
      timestamp: now - 1000 * 9,
      status: "sent"
    });
  }
  if (phase === "later") {
    messages.push({
      id: "flow-result-later",
      nickname: "__system__",
      text: "稍后处理：提议先从当前输入路径退场，不打断本轮讨论。",
      timestamp: now - 1000 * 9,
      status: "sent"
    });
  }
  if (resolution && phase !== "proposal") {
    messages.push({
      id: "flow-result-anchor",
      nickname: "__system__",
      text: `处理结果：${resolution}`,
      timestamp: now - 1000 * 4,
      status: "sent"
    });
  }
  return messages;
}

function getGovernanceResolutionLabel(action) {
  if (action === "accepted") return "列为开放问题";
  if (action === "rejected") return "讨论白板保持不变";
  if (action === "ordinary_reply") return "改成普通发言";
  if (action === "open_question") return "列为开放问题";
  if (action === "note") return "转为笔记";
  if (action === "later") return "稍后处理";
  return "";
}

function GovernanceFlowPreview({ scenario, runKey }) {
  const timersRef = useRef([]);
  const [phase, setPhase] = useState("writing");
  const [resolution, setResolution] = useState("");
  const proposal = {
    ...DESIGN_LAB_PROPOSALS[0],
    id: "flow-proposal-open-question",
    title: "是否列为开放问题",
    reason: "这会进入讨论白板，影响后续多 AI 共用的背景。",
    actionLabel: "列为开放问题",
    rejectLabel: "暂不写入",
    sourceLabel: "讨论白板"
  };
  const isProposalActive = phase === "proposal";
  const messages = createGovernanceFlowMessages(phase, resolution);

  function clearTimers() {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }

  function schedule(callback, delay) {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
  }

  function startFlow() {
    clearTimers();
    setPhase("writing");
    setResolution("");
    schedule(() => setPhase("sent"), 460);
    schedule(() => setPhase("proposal"), 1280);
  }

  useEffect(() => {
    startFlow();
    return clearTimers;
  }, [runKey]);

  function resolveFlow(action) {
    clearTimers();
    setResolution(getGovernanceResolutionLabel(action));
    setPhase(action);
  }

  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-flow-stage">
        <div className="design-lab-flow-roombar">
          <div>
            <span>项目复盘</span>
            <small>
              {phase === "writing" ? "脚本消息正在进入" : isProposalActive ? "等待确认" : resolution || "流程回放"}
            </small>
          </div>
          <AiSeatStrip
            members={DESIGN_LAB_AI_MEMBERS.slice(0, 2)}
            thinkingAdapters={DESIGN_LAB_THINKING_ADAPTERS}
            readOnly={true}
            presentationOnly={false}
            vitalSigns={true}
            governanceAiIds={isProposalActive ? [1] : []}
            showHoverSummary={true}
            onChange={async () => DESIGN_LAB_AI_MEMBERS}
          />
        </div>

        <div className="design-lab-flow-chat">
          <MessageList
            messages={messages}
            aiMembers={DESIGN_LAB_AI_MEMBERS}
            agentDecisionProposals={isProposalActive ? [proposal] : []}
            onAgentProposalAccept={() => resolveFlow("accepted")}
            onAgentProposalReject={() => resolveFlow("rejected")}
            onAgentProposalConvert={(_, action) => resolveFlow(action)}
            hiddenMessageId=""
            shouldAnimateEntry={true}
            entryDelay={0}
            itemAnimationMode="calm"
            stickToBottom={true}
            className="design-lab-flow-message-viewport"
            innerClassName="design-lab-flow-message-inner"
            renderEmpty={() => (
              <div className="design-lab-flow-empty">
                <span>脚本消息准备发送</span>
              </div>
            )}
          />

          <motion.div
            key={phase}
            className={`design-lab-flow-composer is-${phase}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            {phase === "writing" ? "正在发送脚本消息..." : isProposalActive ? "提议已进入消息流，可继续输入" : "流程已回落，可重放"}
          </motion.div>

          <AnimatePresence>
            {!isProposalActive && resolution ? (
              <motion.div
                className="design-lab-flow-result"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: EASE }}
              >
                <span>{resolution}</span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </PreviewShell>
  );
}

function HomeCardsPreview({ scenario, runKey }) {
  const phase = useScriptedPhase(HOME_FLOW_STEPS, runKey);
  const activeIndex = phase === "second" ? 1 : phase === "third" ? 2 : 0;
  const activeCard = DESIGN_LAB_HOME_CARDS[activeIndex] || DESIGN_LAB_HOME_CARDS[0];
  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-home-stage">
        <div className="design-lab-home-grid">
          {DESIGN_LAB_HOME_CARDS.map((card, index) => (
          <motion.article
            key={card.title}
            className={`design-lab-home-card ${index === activeIndex ? "is-active" : ""}`}
            animate={{ y: index === activeIndex ? -3 : 0 }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <span>路径上</span>
            <h4>{card.title}</h4>
            <p>{card.recall}</p>
            <small>{card.meta}</small>
          </motion.article>
          ))}
        </div>
        <motion.aside
          key={activeCard.title}
          className="design-lab-home-peek"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <span>当前窥看</span>
          <strong>{activeCard.title}</strong>
          <p>{activeCard.recall}</p>
        </motion.aside>
      </div>
    </PreviewShell>
  );
}

function AuthRoomPreview({ scenario, runKey }) {
  const phase = useScriptedPhase(AUTH_FLOW_STEPS, runKey);
  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-auth-stage">
        <div className="design-lab-auth-room">
          <div className="design-lab-auth-orbit" aria-hidden="true" />
          {["ask", "answer", "ready"].includes(phase) ? (
            <motion.div className="design-lab-auth-message is-user" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              我刚才那个临时想法还能继续吗？
            </motion.div>
          ) : null}
          {["answer", "ready"].includes(phase) ? (
            <motion.div className="design-lab-auth-message is-ai" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              可以，我保留了刚才的讨论线。
            </motion.div>
          ) : null}
          <motion.div key={phase} className="design-lab-auth-composer" initial={{ opacity: 0.72 }} animate={{ opacity: 1 }}>
            {phase === "ready" ? "继续进入 Atrium" : "正在恢复房间状态"}
          </motion.div>
        </div>
      </div>
    </PreviewShell>
  );
}

function MotionPreview({ scenario, runKey }) {
  const phase = useScriptedPhase(MOTION_FLOW_STEPS, runKey);
  const message = {
    id: `motion-message-${runKey}`,
    nickname: "林夏",
    text: "这条消息用真实 MessageList / MessageItem 入场。",
    timestamp: Date.now() - 1000 * 6,
    isSelf: true,
    status: "sent"
  };
  const messages = phase === "empty" ? [] : [message];
  const proposals = phase === "dock"
    ? [{ ...DESIGN_LAB_PROPOSALS[0], id: `motion-proposal-${runKey}` }]
    : [];
  const toast = phase === "toast"
    ? { id: `motion-toast-${runKey}`, text: "Design Lab 正在复用真实摘录 toast。" }
    : null;
  const status = {
    empty: "等待真实组件进入",
    message: "MessageList 正在处理消息入场",
    dock: "AgentDecisionDock 正在处理确认浮层",
    toast: "NoteCaptureToast 正在处理状态提示",
    settled: "真实组件已完成退场回落"
  }[phase] || "真实组件回放";

  return (
    <PreviewShell scenario={scenario}>
      <div className={`design-lab-motion-stage is-${phase}`}>
        <MessageList
          messages={messages}
          aiMembers={DESIGN_LAB_AI_MEMBERS}
          hiddenMessageId=""
          shouldAnimateEntry={true}
          entryDelay={0}
          itemAnimationMode="calm"
          stickToBottom={true}
          className="design-lab-motion-message-viewport"
          innerClassName="design-lab-motion-message-inner"
          renderEmpty={() => (
            <div className="design-lab-motion-empty">
              <span>准备回放真实消息入场</span>
            </div>
          )}
        />
        <div className="design-lab-motion-dock-layer">
          <AgentDecisionDock
            proposals={proposals}
            aiMembers={DESIGN_LAB_AI_MEMBERS}
            onAccept={() => {}}
            onReject={() => {}}
            onConvert={() => {}}
          />
        </div>
        <NoteCaptureToast toast={toast} className="is-design-lab-motion" />
        <div className="design-lab-motion-status" aria-live="polite">{status}</div>
      </div>
    </PreviewShell>
  );
}

function ComposerPreview({ scenario, runKey }) {
  const phase = useScriptedPhase(COMPOSER_FLOW_STEPS, runKey);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (phase === "empty") setValue("");
    if (phase === "typing") setValue("先记一下这个判断：");
    if (phase === "long") setValue("先记一下这个判断：我们不要把 AI 的普通补充都做成审批，只把共享讨论状态的变化拿出来确认。");
    if (phase === "sent") setValue("");
  }, [phase]);

  return (
    <PreviewShell scenario={scenario}>
      <div className="design-lab-composer-stage">
        <div className="design-lab-composer-flow-copy">
          {phase === "sent" ? "脚本草稿已发送，输入落点回到空态" : "脚本草稿正在进入输入框"}
        </div>
        <MessageInput
          value={value}
          onChange={setValue}
          onSend={() => setValue("")}
          disabled={false}
          readOnly={false}
          placeholder="Design Lab composer preview"
        />
      </div>
    </PreviewShell>
  );
}

export default function DesignLabPreview({ scenario, viewport, theme, runKey }) {
  if (!scenario) return null;
  const className = [
    "design-lab-preview",
    `is-${viewport}`,
    `is-theme-${theme}`
  ].join(" ");

  return (
    <div className={className}>
      {scenario.previewType === "messages" ? <ChatMessagesPreview scenario={scenario} runKey={runKey} /> : null}
      {scenario.previewType === "ai-seats" ? <AiSeatsPreview scenario={scenario} runKey={runKey} /> : null}
      {scenario.previewType === "governance-flow" ? <GovernanceFlowPreview scenario={scenario} runKey={runKey} /> : null}
      {scenario.previewType === "decision-single" || scenario.previewType === "decision-stack" ? (
        <DecisionDockPreview scenario={scenario} runKey={runKey} />
      ) : null}
      {scenario.previewType === "home-cards" ? <HomeCardsPreview scenario={scenario} runKey={runKey} /> : null}
      {scenario.previewType === "auth-room" ? <AuthRoomPreview scenario={scenario} runKey={runKey} /> : null}
      {scenario.previewType === "motion" ? <MotionPreview scenario={scenario} runKey={runKey} /> : null}
      {scenario.previewType === "composer" ? <ComposerPreview scenario={scenario} runKey={runKey} /> : null}
    </div>
  );
}
