import { describe, expect, it } from 'vitest';
import type { ModelInfo } from '@/shared/api/types';
import { alternateModel, formatCost, formatListTime, formatSeconds, isMeaningfulNotice, modelLabel, priceLevel } from './format';

const model = (id: string, output: number): ModelInfo => ({
  id,
  label: id.toUpperCase(),
  tier: 'balanced',
  input_usd_per_mtok: 1,
  output_usd_per_mtok: output,
  cache_read_usd_per_mtok: 0.1,
  efforts: [],
  default_effort: null,
  available: true,
});

describe('format', () => {
  it('shows fractions of a cent', () => {
    expect(formatCost(0.00216, 'en')).toBe('$0.0022');
    expect(formatCost(1.5, 'en')).toBe('$1.50');
    expect(formatCost(0.00216, 'de')).toMatch(/^0,0022\s\$$/);
  });

  it('shows seconds with one decimal', () => {
    expect(formatSeconds(2310, 'de')).toBe('2,3');
  });

  it('labels models from the config and ranks their price', () => {
    const models = [model('haiku', 5), model('sonnet', 10), model('opus', 25)];
    expect(modelLabel(models, 'sonnet')).toBe('SONNET');
    expect(modelLabel(models, 'other')).toBe('other');
    expect(models.map((m) => priceLevel(models, m.id))).toEqual([1, 2, 3]);
  });
});

describe('alternateModel', () => {
  const models = [model('haiku', 5), model('sonnet', 10), { ...model('opus', 25), available: false }];

  it('offers the default when another model failed', () => {
    expect(alternateModel(models, 'haiku', 'sonnet')).toBe('sonnet');
  });

  it('offers the first other available model when the default failed', () => {
    expect(alternateModel(models, 'sonnet', 'sonnet')).toBe('haiku');
  });

  it('never offers an unavailable model or none at all', () => {
    expect(alternateModel([models[0], models[2]], 'haiku', 'haiku')).toBeNull();
    expect(alternateModel(undefined, 'haiku')).toBeNull();
  });
});

describe('formatListTime', () => {
  const now = new Date(2026, 9, 1, 15, 0);
  const at = (days: number, hour = 9, minute = 5) => new Date(2026, 9, 1 - days, hour, minute).toISOString();

  it('shows the time today and yesterday, the weekday this week, else the date', () => {
    expect(formatListTime(at(0), now, 'de')).toBe('09:05');
    expect(formatListTime(at(1, 23, 59), now, 'de')).toBe('23:59');
    expect(formatListTime(at(3), now, 'de')).toBe('Mo');
    expect(formatListTime(at(12), now, 'de')).toBe('19. Sept.');
    expect(formatListTime(at(3), now, 'en')).toBe('Mon');
  });
});


describe('dated model ids', () => {
  const models = [{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }] as Parameters<typeof modelLabel>[0];

  it('labels a dated id like its alias', () => {
    expect(modelLabel(models, 'claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5');
  });

  it('hides a model switch that only names the same model with its date', () => {
    const notice = (served: string) => ({ code: 'MODEL_SWITCHED', params: { old: 'claude-haiku-4-5', new: served } });
    expect(isMeaningfulNotice(notice('claude-haiku-4-5-20251001'))).toBe(false);
    expect(isMeaningfulNotice(notice('claude-sonnet-5'))).toBe(true);
    expect(isMeaningfulNotice({ code: 'NO_CITATIONS', params: {} })).toBe(true);
  });
});
