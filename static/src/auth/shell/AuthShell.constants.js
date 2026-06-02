export const CHANGELOG_ITEMS = [
  { version: "v3.0", title: "多人讨论室雏形" },
  { version: "v2.3", title: "个人房间与大厅" },
  { version: "v2.0", title: "首页空间叙事" },
  { version: "v1.x", title: "实时聊天基础" }
];

export const VALUE_CARDS = [
  { key: "card-1", className: "tech-card-1", title: "共同讨论", subtitle: "多人实时进入同一张讨论桌", type: "co-thinking", tagId: "tag-co-thinking" },
  { key: "card-2", className: "tech-card-2", title: "AI 一起讨论", subtitle: "不同 AI 给出不同角度", type: "ai-member", tagId: "tag-ai-member" },
  { key: "card-3", className: "tech-card-3", title: "个人空间", subtitle: "回到安静房间慢慢想", type: "personal-space", tagId: "tag-personal-space" },
  { key: "card-4", className: "tech-card-4", title: "随手沉淀", subtitle: "重要对话可以整理成笔记", type: "notes", tagId: "tag-notes" }
];

export const SVG_VIEWBOX = { x: -800, y: -450, width: 1600, height: 900 };
export const ARCH_PULSE_ARRIVAL_THRESHOLD = 0.95;
export const ARCH_PATHS = [
  { id: "path-personal", d: "M -392.36 -114.80 C -486.00 -86.00 -486.00 86.00 -430.00 188.00", sourceTagId: "tag-co-thinking", targetTagId: "tag-personal-space" },
  { id: "path-ai", d: "M -352 -166 C -262 -175 -204 -332 -12 -332 C 196 -332 286 -200 386 -126", sourceTagId: "tag-co-thinking", targetTagId: "tag-ai-member" },
  { id: "path-notes", d: "M -358.38 -115.41 C -318.00 -86.00 -228.00 288.00 38.00 336.00 C 232.00 340.00 336.00 305.00 384.00 230.00", sourceTagId: "tag-co-thinking", targetTagId: "tag-notes" }
];
export const PULSE_TRAIL_STEPS = [0, 0.014, 0.028, 0.042];
export const LOADING_DOT_DELAYS = ["0s", "0.15s", "0.3s"];
