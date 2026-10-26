function SparkleIcon() {
  return (
    <svg className="ask-ai-sparkle" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3l1.6 5.1L19 9.7l-5.4 1.6L12 16.5l-1.6-5.2L5 9.7l5.4-1.6L12 3zm6.5 9.5l.9 2.8 2.8.9-2.8.9-.9 2.8-.9-2.8-2.8-.9 2.8-.9.9-2.8zM5.5 14l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z"
      />
    </svg>
  );
}

export function AskAiButton({
  pressed,
  onClick,
}: {
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ask-ai-btn"
      title="Ask AI"
      aria-pressed={pressed}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <SparkleIcon />
      <span className="note-action-label">Ask AI</span>
    </button>
  );
}
