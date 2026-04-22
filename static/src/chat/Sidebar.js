// Renders the chat sidebar, identity area, and static room list.
(() => {
    const { motion } = window;
    const { EASE, TAP_TRANSITION } = window.AppConstants;

    function Sidebar({
        username,
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
                    Signal
                </motion.div>

                <div className="identity">
                    <div className="identity-name">{username}</div>
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
                    <div className="sidebar-group">你的房间</div>
                    <div className="sidebar-title">房间列表</div>
                    <div className="room-list">
                        <div className="room-item is-active">{roomName}</div>
                    </div>
                    <div className="room-note">更多房间稍后开放</div>
                </section>
            </motion.aside>
        );
    }

    window.Sidebar = Sidebar;
})();
