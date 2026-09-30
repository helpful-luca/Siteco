/** The question: right aligned in a quiet filled shape, the one "bubble" of the conversation. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[80%] rounded-card bg-fill-strong px-4 py-2 text-reading whitespace-pre-wrap wrap-anywhere">
      {text}
    </div>
  );
}
