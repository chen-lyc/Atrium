import { useState } from "react";
import { AiSeatStrip } from "./AiTeamEditor.jsx";

const DEMO_AI_SEATS = Object.freeze([
  {
    aiId: 1,
    provider: "deepseek",
    model: "deepseek-chat",
    displayName: "DeepSeek",
    avatarUrl: "/avatars/deepseek-logo.svg"
  },
  {
    aiId: 2,
    provider: "qwen",
    model: "qwen-plus",
    displayName: "Qwen Plus",
    avatarUrl: "/avatars/qwen-logo.svg"
  },
  {
    aiId: 3,
    provider: "deepseek",
    model: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner",
    avatarUrl: "/avatars/deepseek-logo.svg"
  },
  {
    aiId: 4,
    provider: "qwen",
    model: "qwen-flash",
    displayName: "Qwen Flash",
    avatarUrl: "/avatars/qwen-logo.svg"
  },
  {
    aiId: 5,
    provider: "deepseek",
    model: "deepseek-chat-shadow",
    displayName: "DeepSeek Shadow",
    avatarUrl: "/avatars/deepseek-logo.svg"
  }
]);

const DEMO_ADAPTER_SEATS = Object.freeze([
  { key: "default", label: "默认" },
  { key: "aggressive", label: "激进" },
  { key: "conservative", label: "保守" },
  { key: "comprehensive", label: "全面" },
  { key: "counterexample", label: "反例" },
  { key: "divergent", label: "发散" },
  { key: "convergent", label: "收敛" }
].map((item, index) => ({
  aiId: 100 + index,
  provider: "deepseek",
  model: `deepseek-seat-${item.key}`,
  displayName: `DeepSeek ${item.label}`,
  avatarUrl: "/avatars/deepseek-logo.svg",
  thinkingMode: item.key,
  label: item.label
})));

const DEMO_THINKING_ADAPTERS = Object.freeze([
  "aggressive.md",
  "conservative.md",
  "comprehensive.md",
  "counterexample.md",
  "convergent.md",
  "divergent.md"
]);

function AdapterDemo() {
  const [members, setMembers] = useState(() => DEMO_ADAPTER_SEATS);

  async function handleChange(nextMembers) {
    setMembers(nextMembers);
    return nextMembers;
  }

  return (
    <main className="ai-seat-vitals-page is-adapter-demo">
      <section className="ai-seat-vitals-stage is-adapter-demo" aria-label="Thinking adapter 席位交互验收">
        <AiSeatStrip
          members={members}
          thinkingAdapters={DEMO_THINKING_ADAPTERS}
          readOnly={false}
          presentationOnly={false}
          onChange={handleChange}
          emptyText=""
          className="is-vitals-demo is-adapter-demo is-adapter-interaction-demo"
        />
      </section>
    </main>
  );
}

export default function AiSeatVitalsDemo({ variant = "vitals" }) {
  if (variant === "adapters") return <AdapterDemo />;

  return (
    <main className="ai-seat-vitals-page">
      <section className="ai-seat-vitals-stage" aria-label="AI 席位生命体征验收">
        <AiSeatStrip
          members={DEMO_AI_SEATS}
          readOnly={true}
          presentationOnly={true}
          emptyText=""
          className="is-vitals-demo"
        />
      </section>
    </main>
  );
}
