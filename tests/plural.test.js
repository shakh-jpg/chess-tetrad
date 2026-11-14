import { describe, it, expect } from 'vitest';
import { plural, countLabel, pliesLabel } from '../src/ui/plural.js';

describe('Russian plural forms', () => {
  it('labels plies correctly (was always "полуходов")', () => {
    expect(pliesLabel(1)).toBe('1 полуход');
    expect(pliesLabel(2)).toBe('2 полухода');
    expect(pliesLabel(4)).toBe('4 полухода');
    expect(pliesLabel(5)).toBe('5 полуходов');
    expect(pliesLabel(11)).toBe('11 полуходов');
    expect(pliesLabel(12)).toBe('12 полуходов');
    expect(pliesLabel(14)).toBe('14 полуходов');
    expect(pliesLabel(21)).toBe('21 полуход');
    expect(pliesLabel(22)).toBe('22 полухода');
    expect(pliesLabel(45)).toBe('45 полуходов');
    expect(pliesLabel(101)).toBe('101 полуход');
    expect(pliesLabel(111)).toBe('111 полуходов');
  });

  it('works for other words and zero', () => {
    expect(countLabel(0, 'задача', 'задачи', 'задач')).toBe('0 задач');
    expect(countLabel(3, 'запись', 'записи', 'записей')).toBe('3 записи');
    expect(plural(1, 'a', 'b', 'c')).toBe('a');
  });
});
