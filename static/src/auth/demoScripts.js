const DEFAULT_TAIL_SILENCE = 3800;

export const DEMO_SCRIPTS = [
  {
    topic: "读书会讨论",
    messages: [
      { delay: 800, nickname: "Ryan", text: "今晚读书会还继续吗" },
      { delay: 2600, nickname: "Maya", text: "继续,我想把第三章的几个问题先列出来" },
      { delay: 5900, nickname: "Leo", text: "我只看了一半,可以旁听" },
      { delay: 7700, nickname: "Maya", text: "没关系,我们先把争议点放在这里" },
      { delay: 11000, nickname: "Leo", text: "这样比群里翻消息舒服很多" },
      { delay: 13500, type: "system", text: "Nora 加入了讨论室" },
      { delay: 16000, nickname: "Nora", text: "我晚点来整理结论" },
      { delay: 17900, nickname: "Ryan", text: "那我先把问题都发出来" },
      { delay: 21200, nickname: "Maya", text: "最后可以让 AI 帮我们归纳一下" },
      { delay: 24500, nickname: "Nora", text: "好,整理成笔记就不怕散了" }
    ],
    typeA: {
      afterMessageIndex: 2,
      content: "我想先记录三个没想明白的问题",
      replyOnSend: {
        reply: { nickname: "Nora", text: "发出来,我帮你一起拆" },
        followups: [
          { nickname: "Ryan", text: "也可以直接标成今晚的讨论清单" },
          { nickname: "Maya", text: "结论最后沉淀到笔记里" },
          { nickname: "Leo", text: "这样我补进度也方便" }
        ]
      }
    },
    typeB: ["你们聊的太快了 🫠", "我先把问题记下来", "这个房间适合慢慢想", "学习了,先潜水"],
    tailSilence: DEFAULT_TAIL_SILENCE
  },
  {
    topic: "周末安排",
    messages: [
      { delay: 800, nickname: "Leo", text: "周末有人去望京那边吃饭吗" },
      { delay: 4000, nickname: "Ethan", text: "望京的日料最近哪家好" },
      { delay: 7100, nickname: "Leo", text: "就想找个不踩雷的" },
      { delay: 10400, nickname: "Maya", text: "我上次去那家寿司屋不错,但人均 500+" },
      { delay: 13400, nickname: "Leo", text: "贵了" },
      { delay: 16500, nickname: "Ethan", text: "哈哈" },
      { delay: 19700, nickname: "Nora", text: "望京小腰吧,接地气" },
      { delay: 23000, nickname: "Leo", text: "这个可以" }
    ],
    typeA: {
      afterMessageIndex: 2,
      content: "有人推荐个人均 100 以内的吗",
      replyOnSend: {
        reply: { nickname: "Ethan", text: "绝味或者西少爷" },
        followups: [
          { nickname: "Maya", text: "西少爷还行,但不算好吃" },
          { nickname: "Leo", text: "我推荐那家兰州拉面,70 就够" },
          { nickname: "Nora", text: "+1 拉面香" }
        ]
      }
    },
    typeB: ["什么时候啊 我看看能不能去", "饿了", "好想吃火锅", "我最近在减肥 🥲"],
    tailSilence: DEFAULT_TAIL_SILENCE
  },
  {
    topic: "小组共创",
    messages: [
      { delay: 800, nickname: "Ryan", text: "我把活动方案放到这里,大家一起过一遍" },
      { delay: 2700, nickname: "Ryan", text: "先看目标人群,再看流程" },
      { delay: 6200, nickname: "Maya", text: "目标人群那里还不够具体" },
      { delay: 8100, nickname: "Maya", text: "我们最好写清楚适合谁,不适合谁" },
      { delay: 11600, nickname: "Ryan", text: "对,不然宣传语会太泛" },
      { delay: 15100, nickname: "Maya", text: "可以让 AI 先帮忙整理几个版本" },
      { delay: 18600, nickname: "Ryan", text: "有道理,我们再人工筛" },
      { delay: 22100, nickname: "Nora", text: "最后把选中的版本存成笔记" }
    ],
    typeA: {
      afterMessageIndex: 3,
      content: "我觉得目标用户应该再收窄一点",
      replyOnSend: {
        reply: { nickname: "Maya", text: "赞同,先不要写给所有人" },
        followups: [
          { nickname: "Ryan", text: "我们可以先列三个最典型的人" },
          { nickname: "Leo", text: "这样讨论会更聚焦" },
          { nickname: "Nora", text: "我来记录这个结论" }
        ]
      }
    },
    typeB: ["我先看目标人群", "这个方向更清楚", "等会儿我补一版文案", "先把结论记下来"],
    tailSilence: DEFAULT_TAIL_SILENCE
  },
  {
    topic: "会议整理",
    messages: [
      { delay: 800, nickname: "Ethan", text: "刚才会议结论有点散" },
      { delay: 2700, nickname: "Ethan", text: "我记得有三件事,但顺序乱了" },
      { delay: 6000, nickname: "Leo", text: "先把原话都丢进来" },
      { delay: 9300, nickname: "Ethan", text: "然后让 AI 帮忙整理成行动项?" },
      { delay: 12600, nickname: "Ryan", text: "可以,但最终版本我们自己确认" },
      { delay: 15800, nickname: "Ethan", text: "这样比会后凭记忆补强多了" },
      { delay: 19200, nickname: "Maya", text: "我来负责把结论放到共享笔记" },
      { delay: 22500, nickname: "Ethan", text: "好,这次不会漏了" }
    ],
    typeA: {
      afterMessageIndex: 2,
      content: "我先把行动项粗略列出来",
      replyOnSend: {
        reply: { nickname: "Leo", text: "列,我帮你检查有没有漏" },
        followups: [
          { nickname: "Ryan", text: "整理完可以直接存一版" },
          { nickname: "Ethan", text: "以后回看就不用翻聊天了" },
          { nickname: "Nora", text: "我喜欢这个流程" }
        ]
      }
    },
    typeB: ["先别急,慢慢整理", "这个可以沉淀成笔记", "我帮你补遗漏", "会议终于不怕散了"],
    tailSilence: DEFAULT_TAIL_SILENCE
  },
  {
    topic: "个人房间",
    messages: [
      { delay: 800, nickname: "Nora", text: "我喜欢先回个人房间想一会儿" },
      { delay: 2600, nickname: "Nora", text: "公共讨论太快的时候,这里更安静" },
      { delay: 5900, nickname: "Ryan", text: "像一张自己的桌子" },
      { delay: 9100, nickname: "Maya", text: "对,可以先把想法放进去" },
      { delay: 12400, nickname: "Nora", text: "等思路清楚了再拿去大厅讨论" },
      { delay: 15800, nickname: "Leo", text: "以后这里能加 AI 成员吗" },
      { delay: 19000, nickname: "Nora", text: "这个方向很适合" },
      { delay: 22300, nickname: "Ryan", text: "个人 + 多 AI 讨论室,听起来不错" }
    ],
    typeA: {
      afterMessageIndex: 2,
      content: "我想先在个人房间整理一下",
      replyOnSend: {
        reply: { nickname: "Nora", text: "好,想清楚再带到大厅也可以" },
        followups: [
          { nickname: "Maya", text: "安静空间对长讨论很重要" },
          { nickname: "Ryan", text: "这里适合和 AI 慢慢拆问题" },
          { nickname: "Leo", text: "我也需要这种地方" }
        ]
      }
    },
    typeB: ["我也想先想一会儿", "个人房间很适合沉淀", "等会儿再去大厅", "这里节奏舒服"],
    tailSilence: DEFAULT_TAIL_SILENCE
  }
];
