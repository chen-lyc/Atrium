import { useState } from "react";
import { motion } from "framer-motion";
import { TAP_TRANSITION } from "../constants.js";
import { buildAuthBody, validateAuthNickname, validateAuthPassword, resolveAuthFailure } from "../utils.js";
import { InlineError, LoadingDots } from "./AuthShell.jsx";

export default function RegisterPage({ onSwitchLogin, onSuccess, disabled }) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ nickname: "", password: "", confirm: "" });
  const [networkError, setNetworkError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLocked = isSubmitting || disabled;

  const liveConfirmError = confirmPassword && password && confirmPassword !== password ? "两次输入不一致" : fieldErrors.confirm;

  function handleNicknameChange(value) { setNickname(value); setNetworkError(""); setFieldErrors((prev) => ({ ...prev, nickname: "" })); }
  function handlePasswordChange(value) { setPassword(value); setNetworkError(""); setFieldErrors((prev) => ({ ...prev, password: "", confirm: "" })); }
  function handleConfirmPasswordChange(value) { setConfirmPassword(value); setNetworkError(""); setFieldErrors((prev) => ({ ...prev, confirm: "" })); }

  async function handleSubmit() {
    if (isLocked) return;
    const trimmedNickname = nickname.trim();
    const nicknameError = validateAuthNickname(trimmedNickname);
    if (nicknameError) { setFieldErrors({ nickname: nicknameError, password: "", confirm: "" }); setNetworkError(""); return; }
    const passwordError = validateAuthPassword(password);
    if (passwordError) { setFieldErrors({ nickname: "", password: passwordError, confirm: "" }); setNetworkError(""); return; }
    if (!confirmPassword) { setFieldErrors({ nickname: "", password: "", confirm: "请再次输入密码" }); setNetworkError(""); return; }
    if (password !== confirmPassword) { setFieldErrors({ nickname: "", password: "", confirm: "两次输入不一致" }); setNetworkError(""); return; }
    setFieldErrors({ nickname: "", password: "", confirm: "" }); setNetworkError(""); setIsSubmitting(true);
    try {
      const res = await fetch("/register", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: buildAuthBody(trimmedNickname, password), credentials: "include" });
      if (res.ok) { onSuccess(trimmedNickname); return; }
      const failure = await resolveAuthFailure(res, "register");
      setFieldErrors({ nickname: failure.field === "nickname" ? failure.message : "", password: failure.field === "password" ? failure.message : "", confirm: "" });
      setNetworkError(failure.networkError);
    } catch (error) { setNetworkError("网络连接失败，请检查网络"); }
    finally { setIsSubmitting(false); }
  }

  function handleKeyDown(event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleSubmit(); } }

  return (
    <>
      <div className="auth-fields">
        <div className="auth-field">
          <input id="register-nickname" name="username" className={`field-input ${fieldErrors.nickname ? "is-error" : ""}`} value={nickname} onChange={(e) => handleNicknameChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="昵称" autoComplete="username" disabled={isLocked} />
          <InlineError message={fieldErrors.nickname} />
        </div>
        <div className="auth-field">
          <input id="register-password" name="password" type="password" className={`field-input ${fieldErrors.password ? "is-error" : ""}`} value={password} onChange={(e) => handlePasswordChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="密码" autoComplete="new-password" disabled={isLocked} />
          <InlineError message={fieldErrors.password} />
        </div>
        <div className="auth-field">
          <input id="register-confirm-password" name="confirmPassword" type="password" className={`field-input ${liveConfirmError ? "is-error" : ""}`} value={confirmPassword} onChange={(e) => handleConfirmPasswordChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="确认密码" autoComplete="new-password" disabled={isLocked} />
          <InlineError message={liveConfirmError} />
        </div>
      </div>
      <div className="auth-actions">
        <motion.button type="button" className="modal-button primary auth-submit focus-ring" onClick={handleSubmit} disabled={isLocked} whileTap={{ scale: 0.97 }} transition={TAP_TRANSITION}>
          {isSubmitting ? <LoadingDots /> : "注册"}
        </motion.button>
        <InlineError message={networkError} className="network" />
      </div>
      <div className="auth-switch">
        <span>已有账号？</span>
        <button type="button" className="auth-switch-button focus-ring" onClick={onSwitchLogin} disabled={isLocked}>登录</button>
      </div>
    </>
  );
}
