// Defines the login form without changing its original auth behavior.
(() => {
    const { useState } = window.React;
    const { motion } = window;
    const { TAP_TRANSITION } = window.AppConstants;
    const { buildAuthBody } = window.AppUtils;
    const InlineError = window.InlineError;
    const LoadingDots = window.LoadingDots;

    function LoginPage({ onSwitchRegister, onSuccess, disabled }) {
        const [username, setUsername] = useState("");
        const [password, setPassword] = useState("");
        const [fieldErrors, setFieldErrors] = useState({ username: "", password: "" });
        const [networkError, setNetworkError] = useState("");
        const [isSubmitting, setIsSubmitting] = useState(false);
        const isLocked = isSubmitting || disabled;

        function handleUsernameChange(value) {
            setUsername(value);
            setNetworkError("");
            setFieldErrors((prev) => ({ ...prev, username: "", password: "" }));
        }

        function handlePasswordChange(value) {
            setPassword(value);
            setNetworkError("");
            setFieldErrors((prev) => ({ ...prev, password: "" }));
        }

        async function handleSubmit() {
            if (isLocked) {
                return;
            }

            const trimmedUsername = username.trim();
            if (!trimmedUsername) {
                setFieldErrors({ username: "请输入用户名", password: "" });
                setNetworkError("");
                return;
            }

            if (!password) {
                setFieldErrors({ username: "", password: "请输入密码" });
                setNetworkError("");
                return;
            }

            setFieldErrors({ username: "", password: "" });
            setNetworkError("");
            setIsSubmitting(true);

            try {
                const res = await fetch("/login", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: buildAuthBody(trimmedUsername, password),
                    credentials: "include"
                });

                if (res.ok) {
                    onSuccess(trimmedUsername);
                    return;
                }

                if (res.status === 401) {
                    setFieldErrors({ username: "", password: "用户名或密码错误" });
                    return;
                }

                setNetworkError("网络连接失败，请检查网络");
            } catch (error) {
                setNetworkError("网络连接失败，请检查网络");
            } finally {
                setIsSubmitting(false);
            }
        }

        function handleKeyDown(event) {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
            }
        }

        return (
            <>
                <div className="auth-fields">
                    <div className="auth-field">
                        <input
                            className={`field-input ${fieldErrors.username ? "is-error" : ""}`}
                            value={username}
                            onChange={(event) => handleUsernameChange(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="用户名"
                            autoComplete="username"
                            disabled={isLocked}
                        />
                        <InlineError message={fieldErrors.username} />
                    </div>

                    <div className="auth-field">
                        <input
                            type="password"
                            className={`field-input ${fieldErrors.password ? "is-error" : ""}`}
                            value={password}
                            onChange={(event) => handlePasswordChange(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="密码"
                            autoComplete="current-password"
                            disabled={isLocked}
                        />
                        <InlineError message={fieldErrors.password} />
                    </div>
                </div>

                <div className="auth-actions">
                    <motion.button
                        type="button"
                        className="modal-button primary auth-submit focus-ring"
                        onClick={handleSubmit}
                        disabled={isLocked}
                        whileTap={{ scale: 0.97 }}
                        transition={TAP_TRANSITION}
                    >
                        {isSubmitting ? <LoadingDots /> : "登录"}
                    </motion.button>
                    <InlineError message={networkError} className="network" />
                </div>

                <div className="auth-switch">
                    <span>还没有账号？</span>
                    <button
                        type="button"
                        className="auth-switch-button focus-ring"
                        onClick={onSwitchRegister}
                        disabled={isLocked}
                    >
                        注册
                    </button>
                </div>
            </>
        );
    }

    window.LoginPage = LoginPage;
})();
