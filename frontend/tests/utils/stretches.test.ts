import { describe, it, expect } from 'vitest';
import { applyStretch } from '../../src/utils/stretches';

describe('applyStretch', () => {
    it.each(['linear', 'log', 'square root', 'asinh'])('%s maps 0->0 and 1->1', (s) => {
        expect(applyStretch(0, s)).toBeCloseTo(0, 5);
        expect(applyStretch(1, s)).toBeCloseTo(1, 3);
    });
    it('clamps out-of-range input', () => {
        expect(applyStretch(-5, 'log')).toBe(0);
        expect(applyStretch(5, 'linear')).toBe(1);
    });
    it('non-linear stretches boost faint values', () => {
        for (const s of ['log', 'square root', 'asinh']) {
            expect(applyStretch(0.1, s)).toBeGreaterThan(0.1);
        }
    });
    it('unknown stretch falls back to linear', () => {
        expect(applyStretch(0.3, 'bogus')).toBe(0.3);
    });
});
