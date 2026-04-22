// Defines the register form without changing validation or request flow.
(() => {
    const { useState } = window.React;
    const { motion } = window;
    const { TAP_TRANSITION } = window.AppConstants;
    const { buildAuthBody } = window.AppUtils;
    const InlineError = window.InlineError;
    const LoadingDots = window.LoadingDots;

    function RegisterPage({ onSwitchLogin, onSuccess, disabled }) {
        const [username, setUsername] = useState("");
        const [password, setPassword] = useState("");
        const [confirmPassword, setConfirmPassword] = useState("");
        const [fieldErrors, setFieldErrors] = useState({
            username: "",
            password: "",
            confirm: ""
        });
        const [networkError, setNetworkError] = useState("");
        const [isSubmitting, setIsSubmitting] = useState(false);
        const isLocked = isSubmitting || disabled;

        const liveConfirmError =
            confirmPassword && password && confirmPassword !== password
                ? "两次输入不一致"
                : fieldErrors.confirm;

        function handleUsernameChange(value) {
            setUsername(value);
            setNetworkError("");
            setFieldErrors((prev) => ({ ...prev, username: "" }));
        }

        function handlePasswordChange(value) {
            setPassword(value);
            setNetworkError("");
            setFieldErrors((prev) => ({ ...prev, password: "", confirm: "" }));
        }

        function handleConfirmPasswordChange(value) {
            setConfirmPassword(value);
            setNetworkError("");
            setFieldErrors((prev) => ({ ...prev, confirm: "" }));
        }

        async function handleSubmit() {
            if (isLocked) {
                return;
            }

            const trimmedUsername = username.trim();
            if (!trimmedUsername) {
                setFieldErrors({ username: "请输入用户名", password: "", confirm: "" });
                setNetworkError("");
                return;
            }

            if (/\s/.test(trimmedUsername)) {
                setFieldErrors({ username: "用户名不能包含空格", password: "", confirm: "" });
                setNetworkError("");
                return;
            }

            if (!password) {
                setFieldErrors({ username: "", password: "请输入密码", confirm: "" });
                setNetworkError("");
                return;
            }

            if (!confirmPassword) {
                setFieldErrors({ username: "", password: "", confirm: "请再次输入密码" });
                setNetworkError("");
                return;
            }

            if (password !== confirmPassword) {
                setFieldErrors({ username: "", password: "", confirm: "两次输入不一致" });
                setNetworkError("");
                return;
            }

            setFieldErrors({ username: "", password: "", confirm: "" });
            setNetworkError("");
            setIsSubmitting(true);

            try {
                const res = await fetch("/register", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: buildAuthBody(trimmedUsername, password),
                    credentials: "include"
                });

                if (res.ok) {
                    onSuccess(trimmedUsername);
                    return;
                }

                if (res.status === 409) {
                    setFieldErrors({ username: "用户名已被占用", password: "", confirm: "" });
                    return;
                }

                if (res.status >= 500) {
                    setNetworkError("服务器开小差了，请稍后再试");
                    return;
                }

                setNetworkError("注册失败，请稍后重试");
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
                            id="register-username"
                            name="username"
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
                            id="register-password"
                            name="password"
                            type="password"
                            className={`field-input ${fieldErrors.password ? "is-error" : ""}`}
                            value={password}
                            onChange={(event) => handlePasswordChange(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="密码"
                            autoComplete="new-password"
                            disabled={isLocked}
                        />
                        <InlineError message={fieldErrors.password} />
                    </div>

                    <div className="auth-field">
                        <input
                            id="register-confirm-password"
                            name="confirmPassword"
                            type="password"
                            className={`field-input ${liveConfirmError ? "is-error" : ""}`}
                            value={confirmPassword}
                            onChange={(event) => handleConfirmPasswordChange(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="确认密码"
                            autoComplete="new-password"
                            disabled={isLocked}
                        />
                        <InlineError message={liveConfirmError} />
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
                        {isSubmitting ? <LoadingDots /> : "注册"}
                    </motion.button>
                    <InlineError message={networkError} className="network" />
                </div>

                <div className="auth-switch">
                    <span>已有账号？</span>
                    <button
                        type="button"
                        className="auth-switch-button focus-ring"
                        onClick={onSwitchLogin}
                        disabled={isLocked}
                    >
                        登录
                    </button>
                </div>
            </>
        );
    }

    window.RegisterPage = RegisterPage;
})();
