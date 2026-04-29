// Renders the chat sidebar, identity area, and static room list.
(() => {
    const { motion } = window;
    const { EASE, TAP_TRANSITION } = window.AppConstants;

    function Sidebar({
        nickname,
        onLogout,
        shouldAnimateEntry,
        entryDelay,
        entryDuration = 0.3,
        entryOffsetX = -20,
        transitionMode = "idle",
        motionTiming = null,
        readOnly = false,
        roomName = "/chat"
    }) {
        const reducedMotion = window.useReducedMotion();
        const isEntering = transitionMode === "enter";
        const isExiting = transitionMode === "exit";
        const initial = isEntering
            ? { x: reducedMotion ? 0 : motionTiming?.x ?? entryOffsetX, opacity: 0 }
            : shouldAnimateEntry
                ? { x: reducedMotion ? 0 : entryOffsetX, opacity: 0 }
                : false;
        const animate = isExiting
            ? { x: reducedMotion ? 0 : motionTiming?.x || 0, opacity: 0 }
            : { x: 0, opacity: 1 };
        const transition = isEntering || isExiting
            ? {
                delay: motionTiming?.delay || 0,
                duration: motionTiming?.duration || entryDuration,
                ease: EASE
            }
            : shouldAnimateEntry
                ? { delay: entryDelay, duration: entryDuration, ease: EASE }
                : { duration: 0.18, ease: EASE };

        return (
            <motion.aside
                className="sidebar"
                initial={initial}
                animate={animate}
                transition={transition}
            >
                <motion.div
                    className="brand"
                    style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0, lineHeight: 1.2 }}
                >
                    Atrium
                </motion.div>

                <div className="identity">
                    <div className="identity-name">{nickname}</div>
                    {readOnly ? null : (
                        <motion.button
                            type="button"
                            className="link-button focus-ring"
                            onClick={onLogout}
                            whileTap={{ scale: 0.97 }}
                            transition={TAP_TRANSITION}
                        >
                            登出
                        </motion.button>
                    )}
                </div>

                <section>
                    <div className="section-label">群聊</div>
                    <div className="room-list">
                        <div className="room-item is-active">{roomName}</div>
                    </div>
                    <div className="room-note">更多群聊稍后开放</div>
                </section>

                <section>
                    <div className="section-label">好友</div>
                    <div style={{ padding: '0 12px', fontSize: 13, color: 'var(--text-subtle)' }}>
                        好友功能开发中
                    </div>
                </section>

                <section>
                    <div className="section-label">在线</div>
                </section>

                <div style={{ marginTop: 'auto', padding: '8px 12px 4px', fontSize: 12, color: 'var(--text-subtle)', display: 'flex', gap: 14 }}>
                    <span>通知</span>
                    <span>外观</span>
                </div>
            </motion.aside>
        );
    }

    window.Sidebar = Sidebar;
})();
