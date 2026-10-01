import { describe, expect, it } from 'vitest';
import { greetingFor } from './greeting';

const at = (hour: number, minute = 0) => new Date(2026, 9, 1, hour, minute);

describe('greetingFor', () => {
  it('says good morning from 5 to 11, hello during the day, good evening from 18', () => {
    expect(greetingFor(at(4, 59))).toBe('evening');
    expect(greetingFor(at(5))).toBe('morning');
    expect(greetingFor(at(10, 59))).toBe('morning');
    expect(greetingFor(at(11))).toBe('day');
    expect(greetingFor(at(17, 59))).toBe('day');
    expect(greetingFor(at(18))).toBe('evening');
    expect(greetingFor(at(23))).toBe('evening');
  });
});
