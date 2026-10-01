'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from './use-reduced-motion';

export type TypewriterTiming = {
  /** Per typed character. */
  type: number;
  /** Per erased character. */
  erase: number;
  /** How long a finished word stays. */
  hold: number;
  /** Empty line between two words. */
  gap: number;
};

export type Frame = { text: string; wait: number };

const CALM: TypewriterTiming = { type: 110, erase: 55, hold: 2600, gap: 320 };

/**
 * Every frame of the animation, computed up front: the first word stays, is erased, the next
 * one is typed, and so on for `switches` changes. The last frame stays (wait Infinity).
 */
export function typewriterScript(words: readonly string[], switches: number, timing: TypewriterTiming): Frame[] {
  const first = words[0] ?? '';
  if (words.length < 2 || switches < 1) return [{ text: first, wait: Infinity }];
  const frames: Frame[] = [];
  for (let index = 0; index < switches; index++) {
    const from = words[index % words.length]!;
    const to = words[(index + 1) % words.length]!;
    frames.push({ text: from, wait: timing.hold });
    for (let length = from.length - 1; length > 0; length--) frames.push({ text: from.slice(0, length), wait: timing.erase });
    frames.push({ text: '', wait: timing.gap });
    for (let length = 1; length < to.length; length++) frames.push({ text: to.slice(0, length), wait: timing.type });
  }
  frames.push({ text: words[switches % words.length]!, wait: Infinity });
  return frames;
}

type Props = {
  /** The accessible text; it never changes while the visible words are typed. */
  label: string;
  words: readonly string[];
  /** Word changes before it settles (an even number ends on the first word). */
  switches?: number;
  timing?: TypewriterTiming;
};

/**
 * Calm typewriter for a short title: type, hold, erase, switch, then it settles. Screen readers
 * read `label` only; with reduced motion the label is shown as plain text.
 */
export function Typewriter({ label, words, switches = 4, timing = CALM }: Props) {
  const reduced = useReducedMotion();
  const [frames] = useState(() => typewriterScript(words, switches, timing));
  const [index, setIndex] = useState(0);
  const frame = frames[index]!;

  useEffect(() => {
    if (reduced || frame.wait === Infinity) return;
    const timer = setTimeout(() => setIndex((current) => current + 1), frame.wait);
    return () => clearTimeout(timer);
  }, [reduced, frame.wait, index]);

  if (reduced) return <>{label}</>;
  const settled = frame.wait === Infinity;
  return (
    <>
      <span className="sr-only">{label}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {/* A zero-width space keeps the line height while the word is empty. */}
        <span>{frame.text || '​'}</span>
        <span
          className={`ml-0.5 inline-block h-[0.9em] w-0.5 translate-y-[0.1em] self-baseline rounded-full bg-sodium transition-opacity duration-500 ${settled ? 'opacity-0' : 'opacity-100'}`}
        />
      </span>
    </>
  );
}
