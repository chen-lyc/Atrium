const DEFAULT_TAIL_SILENCE = 5200;

export const DEMO_SCRIPTS = [
  {
    topic: "明天的讨论",
    messages: [
      { delay: 450, nickname: "lyc", text: "明天要开需求会，我还没想清楚先聊哪几个点。", isSelf: true },
      { delay: 2300, nickname: "DeepSeek", text: "可以先把最卡的地方写下来。比如：用户到底是想更快创建房间，还是想更快找到上次讨论？", isAI: true, provider: "deepseek", model: "deepseek-v4-pro" },
      { delay: 4700, nickname: "Qwen", text: "我帮你整理成三个会前问题：入口、房间列表、AI 什么时候出现。先把这三个放在同一个讨论里。", isAI: true, provider: "qwen", model: "qwen3.5-plus" },
      { delay: 7100, nickname: "Nora", text: "这样我进来就能直接接着看，不用翻聊天记录。" },
      { delay: 9300, nickname: "DeepSeek", text: "还有一个容易漏掉的点：如果第一次打开就很吵，用户可能根本不会写下第一个问题。", isAI: true, provider: "deepseek", model: "deepseek-v4-pro" },
      { delay: 11800, nickname: "Qwen", text: "那今天先定一个小目标：登录前就能看到讨论怎么开始，登录后继续同一条线。", isAI: true, provider: "qwen", model: "qwen3.5-plus" }
    ],
    typeA: {
      afterMessageIndex: 2,
      content: "帮我把明天要聊的点先理一下",
      replyOnSend: {
        reply: { nickname: "DeepSeek", text: "先写最具体的一句：明天到底要决定什么？如果只是泛泛讨论，很容易聊散。", isAI: true, provider: "deepseek", model: "deepseek-v4-pro" },
        followups: [
          { nickname: "Qwen", text: "我先列一个会前小清单：目标、已有材料、需要谁确认、会后要留下什么结论。", isAI: true, provider: "qwen", model: "qwen3.5-plus" },
          { nickname: "lyc", text: "可以，这样我登录进去就能接着改，不用重新组织一遍。", isSelf: true }
        ]
      }
    },
    typeB: ["帮我把明天要聊的点先理一下", "先把这个想法放进房间", "我想整理一下会前问题", "等我登录后继续这条讨论"],
    tailSilence: DEFAULT_TAIL_SILENCE
  },
  {
    topic: "临时想法",
    messages: [
      { delay: 450, nickname: "lyc", text: "我刚想到一个页面改法，但怕明天又忘了。", isSelf: true },
      { delay: 2400, nickname: "Qwen", text: "先不用写完整方案。你可以只丢一句：想改哪里、为什么现在不舒服。", isAI: true, provider: "qwen", model: "qwen3.5-flash" },
      { delay: 5000, nickname: "DeepSeek", text: "我帮你补一个检查点：这个改法会不会让登录更顺，但让真正进房间之后更乱？", isAI: true, provider: "deepseek", model: "deepseek-v4-pro" },
      { delay: 7500, nickname: "Maya", text: "这个提醒挺实用，像有人在旁边帮忙把坑先圈出来。" },
      { delay: 9800, nickname: "Qwen", text: "那我把它记成待确认：登录页先展示一次真实讨论，不提前解释所有功能。", isAI: true, provider: "qwen", model: "qwen3.5-flash" },
      { delay: 12200, nickname: "DeepSeek", text: "明天回来再看时，先问一句：这个演示像真实使用，还是像在介绍产品？", isAI: true, provider: "deepseek", model: "deepseek-v4-pro" }
    ],
    typeA: {
      afterMessageIndex: 3,
      content: "先帮我把这个想法留住",
      replyOnSend: {
        reply: { nickname: "Qwen", text: "可以，我先帮你写成一句待办：把登录前的演示改得像真实房间里的第一段讨论。", isAI: true, provider: "qwen", model: "qwen3.5-flash" },
        followups: [
          { nickname: "DeepSeek", text: "再补一个判断标准：用户看完以后，应该想继续问，而不是觉得已经看完介绍。", isAI: true, provider: "deepseek", model: "deepseek-v4-pro" },
          { nickname: "lyc", text: "好，这样就像正常使用时顺手留了一句。", isSelf: true }
        ]
      }
    },
    typeB: ["先帮我把这个想法留住", "我想明天继续看这个问题", "帮我把这句整理一下", "先别展开，留个清楚的入口"],
    tailSilence: DEFAULT_TAIL_SILENCE
  }
];
