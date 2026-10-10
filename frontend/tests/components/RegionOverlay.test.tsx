import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RegionShape } from '../../src/components/RegionOverlay';

afterEach(cleanup);

const base = { id: 'r', color: '#0f0', startX: 10, startY: 20, endX: 13, endY: 24, angle: 0 };
const mount = (region: any, props: any = {}) => {
    const onAction = vi.fn(), onHover = vi.fn();
    const r = render(<svg><RegionShape region={{ ...base, ...region }} isSelected={false} isHovered={false}
        zoom={1} drawMode="pan" onAction={onAction} onHover={onHover} {...props} /></svg>);
    return { ...r, onAction, onHover };
};

describe('RegionShape', () => {
    it.each([
        ['circle', 'circle', 2], ['box', 'rect', 2], ['ellipse', 'ellipse', 2], ['annulus', 'circle', 4],
    ])('draws a %s (hit target + outline)', (type, tag, count) => {
        const { container } = mount({ type });
        expect(container.querySelectorAll(tag)).toHaveLength(count);
    });

    it('circle radius is the start-end distance; annulus inner defaults to half', () => {
        expect(mount({ type: 'circle' }).container.querySelector('circle')!.getAttribute('r')).toBe('5');
        cleanup();
        const rs = [...mount({ type: 'annulus' }).container.querySelectorAll('circle')].map(c => c.getAttribute('r'));
        expect(rs).toEqual(['5', '2.5', '5', '2.5']);
        cleanup();
        const rs2 = [...mount({ type: 'annulus', innerR: 1 }).container.querySelectorAll('circle')].map(c => c.getAttribute('r'));
        expect(rs2[1]).toBe('1');
    });

    it('applies rotation about the center', () => {
        const { container } = mount({ type: 'box', angle: 30 });
        expect(container.querySelector('g')!.getAttribute('transform')).toBe('rotate(30 11.5 22)');
    });

    it('emits move only in pan mode and hover callbacks', () => {
        const { container, onAction, onHover } = mount({ type: 'circle' });
        const target = container.querySelector('circle')!;
        fireEvent.mouseDown(target);
        expect(onAction).toHaveBeenCalledWith('r', 'move', expect.anything());
        fireEvent.mouseEnter(target);
        expect(onHover).toHaveBeenCalledWith('r');
        fireEvent.mouseLeave(target);
        expect(onHover).toHaveBeenCalledWith(null);
        cleanup();
        const draw = mount({ type: 'circle' }, { drawMode: 'circle' });
        fireEvent.mouseDown(draw.container.querySelector('circle')!);
        expect(draw.onAction).not.toHaveBeenCalled();
    });

    it('highlights on hover and dashes backgrounds', () => {
        const { container } = mount({ type: 'circle', isBackground: true }, { isHovered: true, zoom: 2 });
        const outline = container.querySelectorAll('circle')[1] as SVGElement;
        expect(outline.style.stroke).toBe('rgb(255, 255, 255)');
        expect(outline.style.strokeDasharray).toContain('3');
    });

    it('shows no handles when unselected or draft', () => {
        expect(mount({ type: 'box' }).container.querySelectorAll('rect')).toHaveLength(2);
        cleanup();
        expect(mount({ type: 'box' }, { isSelected: true, isDraft: true }).container.querySelectorAll('rect')).toHaveLength(2);
    });

    it('selected box exposes rotate and resize handles', () => {
        const { container, onAction } = mount({ type: 'box' }, { isSelected: true });
        const handles = container.querySelectorAll('rect, circle');
        const rotate = [...handles].find(h => h.tagName === 'circle')!;
        fireEvent.mouseDown(rotate);
        expect(onAction).toHaveBeenLastCalledWith('r', 'rotate', expect.anything());
        const resize = [...container.querySelectorAll('rect')].at(-1)!;
        fireEvent.mouseDown(resize);
        expect(onAction).toHaveBeenLastCalledWith('r', 'resize', expect.anything());
    });

    it('selected circle has resize only; annulus adds an inner handle', () => {
        const c = mount({ type: 'circle' }, { isSelected: true });
        expect(c.container.querySelectorAll('rect')).toHaveLength(1);
        cleanup();
        const a = mount({ type: 'annulus' }, { isSelected: true });
        const rects = a.container.querySelectorAll('rect');
        expect(rects).toHaveLength(2);
        fireEvent.mouseDown(rects[1]);
        expect(a.onAction).toHaveBeenLastCalledWith('r', 'resize-inner', expect.anything());
    });
});
