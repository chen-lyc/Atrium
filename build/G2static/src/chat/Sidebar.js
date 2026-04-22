// Renders the chat sidebar, identity area, and static room list.
(() => {
    const { motion } = window;
    const { EASE, FIRST_SEND_SPRING, TAP_TRANSITION } = window.AppConstants;

    function Sidebar({ username, onLogout, shouldAnimateEntry, entryDelay, readOnly = false, roomName = "/chat" }) {
        return (
            <motion.aside
                className="sidebar"
                initial={shouldAnimateEntry ? { x: -20, opacity: 0 } : false}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: entryDelay, duration: 0.3, ease: EASE }}
            >
                <motion.div
                    className="brand"
                    layoutId="brand-signal"
                    transition={FIRST_SEND_SPRING}
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
