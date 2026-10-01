export type Greeting = 'morning' | 'day' | 'evening';

/** The greeting for the viewer's local time, like a person would say it. */
export function greetingFor(now: Date): Greeting {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 18) return 'day';
  return 'evening';
}
