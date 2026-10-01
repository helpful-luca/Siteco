/**
 * The question: right aligned in a quiet filled shape, the one "bubble" of the conversation. It
 * rises 4 px into place as it appears (CSS starting style, a cut under reduced motion).
 */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[80%] rounded-card bg-fill-strong px-4 py-2 text-reading whitespace-pre-wrap wrap-anywhere transition-[opacity,translate] duration-300 ease-out-soft starting:translate-y-1 starting:opacity-0">
      {text}
    </div>
  );
}
