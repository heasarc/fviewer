import { describe, it, expect } from 'vitest';
import { getColormapLUT } from '../../src/utils/colormaps';

const px = (l: Uint8Array, i: number) => [l[i * 3], l[i * 3 + 1], l[i * 3 + 2]];

describe('getColormapLUT', () => {
    it('returns 256 RGB entries for every map', () => {
        for (const n of ['gray', 'heat', 'cool', 'plasma', 'unknown']) {
            expect(getColormapLUT(n).length).toBe(768);
        }
    });
    it('gray is the identity ramp and is the default', () => {
        const l = getColormapLUT('gray');
        expect(px(l, 0)).toEqual([0, 0, 0]);
        expect(px(l, 255)).toEqual([255, 255, 255]);
        expect(getColormapLUT('nope')).toEqual(l);
    });
    it('heat goes black to white', () => {
        const l = getColormapLUT('heat');
        expect(px(l, 0)).toEqual([0, 0, 0]);
        expect(px(l, 255)).toEqual([255, 255, 255]);
    });
    it('cool keeps blue saturated and swaps red/green', () => {
        const l = getColormapLUT('cool');
        expect(px(l, 0)).toEqual([0, 255, 255]);
        expect(px(l, 255)).toEqual([255, 0, 255]);
    });
    it('plasma ends at red and starts black-ish', () => {
        const l = getColormapLUT('plasma');
        expect(px(l, 0)).toEqual([0, 0, 255]);
        expect(px(l, 255)[0]).toBe(255);
        expect(px(l, 255)[2]).toBe(0);
    });
});
