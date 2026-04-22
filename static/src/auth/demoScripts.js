// Provides the rotating auth-page demo scripts and reply scaffolding.
(() => {
    const DEFAULT_TAIL_SILENCE = 3800;

    window.DEMO_SCRIPTS = [
        {
            topic: "技术讨论",
            messages: [
                { delay: 800, nickname: "Ryan", text: "这个 WebSocket 的 close 事件有点诡异" },
                { delay: 2600, nickname: "Ryan", text: "客户端断开后 onclose 有时候要等 30 秒才触发" },
                { delay: 5900, nickname: "Maya", text: "检查一下 TCP keepalive 参数?" },
                { delay: 7700, nickname: "Maya", text: "Linux 默认是 7200 秒,太长了" },
                { delay: 11000, nickname: "Leo", text: "7200 秒 = 两小时,笑死" },
                { delay: 13500, type: "system", text: "Nora 加入了频道" },
                { delay: 16000, nickname: "Nora", text: "这个问题我们踩过" },
                { delay: 17900, nickname: "Nora", text: "加了心跳包,30 秒没收到 PING 就主动 close" },
                { delay: 21200, nickname: "Ryan", text: "懂了,我加个心跳试试" },
                { delay: 24500, nickname: "Maya", text: "服务端也要回 PONG 别忘了" }
            ],
            typeA: {
                afterMessageIndex: 2,
                content: "最近在看 CSAPP 第九章,虚拟内存那章真精彩",
                replyOnSend: {
                    reply: { nickname: "Nora", text: "那章我读了三遍才懂" },
                    followups: [
                        { nickname: "Ryan", text: "+1,页表那节特别难" },
                        { nickname: "Maya", text: "推荐配着 OSTEP 一起看" },
                        { nickname: "Leo", text: "我还没看到,还在啃第一章" }
                    ]
                }
            },
            typeB: [
                "你们聊的太快了 🫠",
                "说起来我上次也碰到类似的",
                "正在啃操作系统,听不懂",
                "学习了,先潜水"
            ],
            tailSilence: DEFAULT_TAIL_SILENCE
        },
        {
            topic: "日常闲聊",
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
            typeB: [
                "什么时候啊 我看看能不能去",
                "饿了",
                "好想吃火锅",
                "我最近在减肥 🥲"
            ],
            tailSilence: DEFAULT_TAIL_SILENCE
        },
        {
            topic: "项目协作",
            messages: [
                { delay: 800, nickname: "Ryan", text: "刚开了个 PR,有人帮忙 review 一下吗" },
                { delay: 2700, nickname: "Ryan", text: "github.com/team/repo/pull/42" },
                { delay: 6200, nickname: "Maya", text: "我看下" },
                { delay: 8100, nickname: "Maya", text: "line 87 那个锁的粒度是不是太粗了" },
                { delay: 11600, nickname: "Ryan", text: "嗯我也犹豫过,主要担心 race condition" },
                { delay: 15100, nickname: "Maya", text: "可以拆成两段,读写分开" },
                { delay: 18600, nickname: "Ryan", text: "有道理,我改一下" },
                { delay: 22100, nickname: "Nora", text: "你们 review 真快 😂" }
            ],
            typeA: {
                afterMessageIndex: 3,
                content: "锁粒度的问题我之前也纠结过,有时候粗粒度反而更简单",
                replyOnSend: {
                    reply: { nickname: "Maya", text: "看具体场景,热点路径必须细粒度" },
                    followups: [
                        { nickname: "Ryan", text: "性能剖析之后再决定比较稳" },
                        { nickname: "Leo", text: "粗粒度的可读性是真的好" },
                        { nickname: "Nora", text: "有 benchmark 再优化" }
                    ]
                }
            },
            typeB: [
                "跪求有人 review 我的 PR 呜呜",
                "我写代码的速度比 review 慢多了",
                "坐等 merge",
                "LGTM (其实没看)"
            ],
            tailSilence: DEFAULT_TAIL_SILENCE
        },
        {
            topic: "产品吐槽",
            messages: [
                { delay: 800, nickname: "Ethan", text: "PM 又加需求了" },
                { delay: 2700, nickname: "Ethan", text: "说要在首页加个\"每日推荐\"模块" },
                { delay: 6000, nickname: "Leo", text: "这周五上线来得及吗" },
                { delay: 9300, nickname: "Ethan", text: "来不及,后端接口都没有" },
                { delay: 12600, nickname: "Ryan", text: "先 mock 数据顶一下?" },
                { delay: 15800, nickname: "Ethan", text: "可以是可以,但推荐逻辑还没设计" },
                { delay: 19200, nickname: "Maya", text: "先 hard code 几条,下个迭代再做" },
                { delay: 22500, nickname: "Ethan", text: "行,我去跟 PM 谈延期" }
            ],
            typeA: {
                afterMessageIndex: 2,
                content: "我们 PM 昨天也突然加了三个需求 🙂",
                replyOnSend: {
                    reply: { nickname: "Leo", text: "这是行业统一习惯吗" },
                    followups: [
                        { nickname: "Ryan", text: "可能是吧,到哪都这样" },
                        { nickname: "Ethan", text: "我已经麻了" },
                        { nickname: "Nora", text: "大家都是打工人 💪" }
                    ]
                }
            },
            typeB: [
                "这就是人生",
                "PM 的需求文档能看懂吗",
                "我也加班中",
                "周五一定上线 👻"
            ],
            tailSilence: DEFAULT_TAIL_SILENCE
        },
        {
            topic: "学习分享",
            messages: [
                { delay: 800, nickname: "Nora", text: "最近在看《设计数据密集型应用》" },
                { delay: 2600, nickname: "Nora", text: "讲分布式一致性那几章特别好" },
                { delay: 5900, nickname: "Ryan", text: "DDIA 确实经典" },
                { delay: 9100, nickname: "Maya", text: "我也看过,就是有点硬核" },
                { delay: 12400, nickname: "Nora", text: "每章都要配个例子才能懂" },
                { delay: 15800, nickname: "Leo", text: "我还没开始看,求推荐前置阅读" },
                { delay: 19000, nickname: "Nora", text: "直接啃就行,遇到不懂的搜就好" },
                { delay: 22300, nickname: "Ryan", text: "+1,不用先修课" }
            ],
            typeA: {
                afterMessageIndex: 2,
                content: "我在看 CSAPP 和 DDIA 之间纠结",
                replyOnSend: {
                    reply: { nickname: "Nora", text: "CSAPP 更底层,DDIA 更偏系统" },
                    followups: [
                        { nickname: "Maya", text: "看你方向,做系统就 DDIA" },
                        { nickname: "Ryan", text: "底层基础打牢了看啥都快" },
                        { nickname: "Leo", text: "我选择都不看 😂" }
                    ]
                }
            },
            typeB: [
                "我还在看第一章 ...",
                "求大佬带读",
                "最近没时间看书 🥲",
                "学习了,收藏夹又多一本"
            ],
            tailSilence: DEFAULT_TAIL_SILENCE
        }
    ];
})();
