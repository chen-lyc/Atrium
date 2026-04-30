import { useState } from "react";
import { motion } from "framer-motion";
import { TAP_TRANSITION } from "../constants.js";
import { buildAuthBody, validateAuthNickname, validateAuthPassword, resolveAuthFailure, readAuthSuccess } from "../utils.js";
import { InlineError, LoadingDots } from "./AuthShell.jsx";

export default function LoginPage({ onSwitchRegister, onSuccess, disabled }) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ nickname: "", password: "" });
  const [networkError, setNetworkError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLocked = isSubmitting || disabled;

  function handleNicknameChange(value) { setNickname(value); setNetworkError(""); setFieldErrors((prev) => ({ ...prev, nickname: "", password: "" })); }
  function handlePasswordChange(value) { setPassword(value); setNetworkError(""); setFieldErrors((prev) => ({ ...prev, password: "" })); }

  async function handleSubmit() {
    if (isLocked) return;
    const trimmedNickname = nickname.trim();
    const nicknameError = validateAuthNickname(trimmedNickname);
    if (nicknameError) { setFieldErrors({ nickname: nicknameError, password: "" }); setNetworkError(""); return; }
    const passwordError = validateAuthPassword(password);
    if (passwordError) { setFieldErrors({ nickname: "", password: passwordError }); setNetworkError(""); return; }
    setFieldErrors({ nickname: "", password: "" }); setNetworkError(""); setIsSubmitting(true);
    try {
      const res = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: buildAuthBody(trimmedNickname, password), credentials: "include" });
      if (res.ok) { onSuccess(await readAuthSuccess(res, trimmedNickname)); return; }
      const failure = await resolveAuthFailure(res, "login");
      setFieldErrors({ nickname: failure.field === "nickname" ? failure.message : "", password: failure.field === "password" ? failure.message : "" });
      setNetworkError(failure.networkError);
    } catch (error) { setNetworkError("网络连接失败，请检查网络"); }
    finally { setIsSubmitting(false); }
  }

  function handleKeyDown(event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSubmit(); } }

  return (
    <>
      <div className="auth-fields">
        <div className="auth-field">
          <input id="login-nickname" name="username" className={`field-input ${fieldErrors.nickname ? "is-error" : ""}`} value={nickname} onChange={(e) => handleNicknameChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="昵称" autoComplete="username" disabled={isLocked} />
          <InlineError message={fieldErrors.nickname} />
        </div>
        <div className="auth-field">
          <input id="login-password" name="password" type="password" className={`field-input ${fieldErrors.password ? "is-error" : ""}`} value={password} onChange={(e) => handlePasswordChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="密码" autoComplete="current-password" disabled={isLocked} />
          <InlineError message={fieldErrors.password} />
        </div>
      </div>
      <div className="auth-actions">
        <motion.button type="button" className="modal-button primary auth-submit focus-ring" onClick={handleSubmit} disabled={isLocked} whileTap={{ scale: 0.97 }} transition={TAP_TRANSITION}>
          {isSubmitting ? <LoadingDots /> : "登录"}
        </motion.button>
        <InlineError message={networkError} className="network" />
      </div>
      <div className="auth-switch">
        <span>还没有账号？</span>
        <button type="button" className="auth-switch-button focus-ring" onClick={onSwitchRegister} disabled={isLocked}>注册</button>
      </div>
    </>
  );
}
