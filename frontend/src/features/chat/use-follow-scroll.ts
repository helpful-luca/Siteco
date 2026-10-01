'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** How close to the end still counts as "at the end" (px). */
const NEAR_END = 96;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Scrolling of the conversation: it follows growing content only while you are near
 * the end; scrolling up stops that and offers a jump back. A new question is scrolled to the top.
 */
export function useFollowScroll() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  const measure = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_END;
    stick.current = near;
    setAtEnd(near);
    setScrolled(element.scrollTop > 0);
  }, []);

  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!element || !inner) return;
    element.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight;
      else measure();
    });
    observer.observe(inner);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure]);

  const scrollToEnd = useCallback(
    (smooth = true) => {
      const element = scroller.current;
      if (!element) return;
      stick.current = true;
      element.scrollTo({ top: element.scrollHeight, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
    },
    [],
  );

  /** Puts an element at the top of the view, below the list's top padding. */
  const scrollToTop = useCallback(
    (target: HTMLElement) => {
      const element = scroller.current;
      if (!element) return;
      const offset = target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
      element.scrollTo({ top: offset - 24, behavior: 'auto' });
      measure();
    },
    [measure],
  );

  return { scrollRef: scroller, contentRef: content, atEnd, scrolled, scrollToEnd, scrollToTop };
}
