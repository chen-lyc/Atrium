export default function AuthThemeToggle({ mode, resolvedMode, onCycle }) {
  const icon =
    mode === "system" ? (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 2.5a5.5 5.5 0 0 1 0 11" fill="currentColor" opacity="0.22" />
      </svg>
    ) : resolvedMode === "dark" ? (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M12.6 10.2A5.4 5.4 0 0 1 5.8 3.4a5.7 5.7 0 1 0 6.8 6.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ) : (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 1.5v1.4M8 13.1v1.4M14.5 8h-1.4M2.9 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  return (
    <button type="button" className="icon-button auth-theme-button focus-ring" onClick={onCycle} aria-label={`切换外观，当前为${mode === "system" ? "跟随系统" : mode === "dark" ? "深色" : "浅色"}`} title={`当前外观：${mode === "system" ? "跟随系统" : mode === "dark" ? "深色" : "浅色"}`}>
      {icon}
    </button>
  );
}
