import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import { VirtualTable } from '../../src/components/VirtualTable';

beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = `.overflow-auto{overflow:auto}.position-relative{position:relative}.position-absolute{position:absolute}
        .position-sticky{position:sticky}.w-100{width:100%}.h-100{height:100%}.top-0{top:0}.start-0{left:0}`;
    document.head.appendChild(style);
});

const cols = [
    { name: 'ID', unit: '', form: '1J', typecode: 41 },
    { name: 'FLAG', unit: '', form: '1L', typecode: 14 },
    { name: 'CPLX', unit: 'Jy', form: '1C', typecode: 83 },
    { name: 'VEC', unit: '', form: '3E', typecode: 42 },
    { name: 'NAME', unit: '', form: '8A', typecode: 16 },
];
const mkData = (n: number) => ({
    ID: Array.from({ length: n }, (_, i) => i * 10),
    FLAG: Array.from({ length: n }, (_, i) => i % 3),
    CPLX: Array.from({ length: n }, (_, i) => [i, -i]),
    VEC: Array.from({ length: n }, (_, i) => new Float32Array([i, 1, 2])),
    NAME: Array.from({ length: n }, (_, i) => `n${i}`),
});

const mount = (props: any = {}) => render(
    <div style={{ height: 400, width: 800 }}>
        <VirtualTable numRows={5} columns={cols} dataMap={mkData(5)} {...props} />
    </div>
);
const rows = () => screen.getAllByRole('row');
const cell = (row: number, col: number) => within(rows()[row]).getAllByRole('cell')[col + 1];

describe('VirtualTable', () => {
    afterEach(() => { cleanup(); vi.useRealTimers(); });

    it('renders headers with unit or format fallbacks and 1-based row numbers', () => {
        mount();
        expect(screen.getByText('ID')).toBeInTheDocument();
        expect(screen.getByText('Jy')).toBeInTheDocument();
        expect(screen.getByText('1J')).toBeInTheDocument();
        expect(rows()).toHaveLength(5);
        expect(within(rows()[0]).getAllByRole('cell')[0]).toHaveTextContent('1');
    });

    it('formats scalars, booleans, complex numbers, strings and vectors', () => {
        mount();
        expect(cell(1, 0)).toHaveTextContent('10');
        expect(cell(0, 1)).toHaveTextContent('F');
        expect(cell(1, 1)).toHaveTextContent('T');
        expect(cell(2, 1)).toHaveTextContent('2');
        expect(cell(2, 2)).toHaveTextContent('2,-2');
        expect(cell(0, 4)).toHaveTextContent('n0');
        expect(cell(0, 3)).toHaveTextContent('[3]');
    });

    it('shows ellipses for missing data and nulls as empty text', () => {
        const data: any = mkData(3);
        data.ID[1] = undefined; data.NAME[2] = null;
        mount({ numRows: 3, dataMap: data });
        expect(cell(1, 0)).toHaveTextContent('...');
        expect(cell(2, 4)).toHaveTextContent('');
    });

    it('invokes onVectorClick without triggering row click', () => {
        const onVectorClick = vi.fn(), onRowClick = vi.fn();
        mount({ onVectorClick, onRowClick });
        fireEvent.click(within(cell(1, 3)).getByRole('button'));
        expect(onVectorClick).toHaveBeenCalledWith('VEC', 1, expect.any(Float32Array));
        expect(onRowClick).not.toHaveBeenCalled();
        fireEvent.click(rows()[2]);
        expect(onRowClick).toHaveBeenCalledWith(2);
    });

    it('does not crash when a vector is clicked without a handler', () => {
        mount();
        fireEvent.click(within(cell(0, 3)).getByRole('button'));
    });

    it('highlights the selected row', () => {
        mount({ selectedRow: 1 });
        expect((rows()[1] as HTMLElement).style.backgroundColor).toBe('rgba(0, 255, 0, 0.15)');
        expect((rows()[0] as HTMLElement).style.backgroundColor).not.toBe('rgba(0, 255, 0, 0.15)');
    });

    describe('editing', () => {
        it('edits a scalar and reports 1-based column number', () => {
            const onCellEdit = vi.fn();
            mount({ onCellEdit });
            fireEvent.doubleClick(cell(1, 0));
            const input = screen.getByDisplayValue('10');
            fireEvent.change(input, { target: { value: '99' } });
            fireEvent.keyDown(input, { key: 'Enter' });
            expect(onCellEdit).toHaveBeenCalledWith('ID', 1, 1, '99');
            expect(screen.queryByDisplayValue('99')).toBeNull();
        });

        it('edits string cells, cancels on Escape/blur, and tolerates a missing callback', () => {
            const onCellEdit = vi.fn();
            mount({ onCellEdit });
            fireEvent.doubleClick(cell(0, 4));
            fireEvent.keyDown(screen.getByDisplayValue('n0'), { key: 'Escape' });
            expect(screen.queryByDisplayValue('n0')).toBeNull();
            fireEvent.doubleClick(cell(0, 4));
            fireEvent.blur(screen.getByDisplayValue('n0'));
            expect(screen.queryByDisplayValue('n0')).toBeNull();
            expect(onCellEdit).not.toHaveBeenCalled();
            cleanup();
            mount();
            fireEvent.doubleClick(cell(0, 4));
            fireEvent.keyDown(screen.getByDisplayValue('n0'), { key: 'Enter' });
        });

        it('does not edit read-only tables, vectors, or missing cells', () => {
            mount({ isReadOnly: true });
            fireEvent.doubleClick(cell(0, 0));
            expect(screen.queryByRole('textbox')).toBeNull();
            cleanup();
            mount();
            fireEvent.doubleClick(cell(0, 3));
            fireEvent.doubleClick(cell(0, 2));
            expect(screen.queryByRole('textbox')).toBeNull();
            cleanup();
            const data: any = mkData(2); data.ID[0] = undefined;
            mount({ numRows: 2, dataMap: data });
            fireEvent.doubleClick(cell(0, 0));
            expect(screen.queryByRole('textbox')).toBeNull();
        });
    });

    describe('column resizing', () => {
        const handle = (container: HTMLElement, idx: number) =>
            container.querySelectorAll('[style*="col-resize"]')[idx] as HTMLElement;
        const headerWidth = (container: HTMLElement, idx: number) =>
            (handle(container, idx).parentElement as HTMLElement).style.width;

        it('resizes with a 50px minimum and stops on pointer up', () => {
            const { container } = mount();
            expect(headerWidth(container, 0)).toBe('120px');
            const h = handle(container, 0);
            fireEvent.mouseEnter(h); fireEvent.mouseLeave(h);
            fireEvent.pointerDown(h, { clientX: 100 });
            act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160 })); });
            expect(headerWidth(container, 0)).toBe('180px');
            act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: -500 })); });
            expect(headerWidth(container, 0)).toBe('50px');
            act(() => { window.dispatchEvent(new PointerEvent('pointerup')); });
            act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300 })); });
            expect(headerWidth(container, 0)).toBe('50px');
        });
    });

    describe('lazy loading', () => {
        beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });

        it('requests missing chunks once, debounced', () => {
            const onFetchData = vi.fn();
            mount({ numRows: 1000, dataMap: {}, onFetchData });
            expect(onFetchData).not.toHaveBeenCalled();
            act(() => { vi.advanceTimersByTime(150); });
            expect(onFetchData).toHaveBeenCalledTimes(1);
            expect(onFetchData.mock.calls[0][0]).toBe(0);
            expect(onFetchData.mock.calls[0][1]).toBeGreaterThan(50);
        });

        it('does not request when data is present or there are no columns/handler', () => {
            const onFetchData = vi.fn();
            mount({ dataMap: mkData(5), onFetchData });
            cleanup();
            mount({ columns: [], onFetchData });
            cleanup();
            mount({ numRows: 1000, dataMap: {} });
            act(() => { vi.advanceTimersByTime(500); });
            expect(onFetchData).not.toHaveBeenCalled();
        });

        it('requests a new chunk after scrolling', () => {
            const onFetchData = vi.fn();
            const { container } = mount({ numRows: 10000, dataMap: {}, onFetchData });
            act(() => { vi.advanceTimersByTime(150); });
            const scroller = container.querySelector('.overflow-auto') as HTMLElement;
            scroller.scrollTop = 32 * 5000;
            fireEvent.scroll(scroller);
            act(() => { vi.advanceTimersByTime(150); });
            expect(onFetchData).toHaveBeenCalledTimes(2);
            expect(onFetchData.mock.calls[1][0]).toBeGreaterThan(4000);
        });
    });

    it('scrolls to an externally selected row below and above the viewport', () => {
        const { container, rerender } = mount({ numRows: 1000, dataMap: {}, selectedRow: null });
        const scroller = container.querySelector('.overflow-auto') as HTMLElement;
        const ui = (sel: number | null) => (
            <div style={{ height: 400, width: 800 }}>
                <VirtualTable numRows={1000} columns={cols} dataMap={{}} selectedRow={sel} />
            </div>
        );
        rerender(ui(500));
        expect(scroller.scrollTop).toBeGreaterThan(32 * 400);
        const after = scroller.scrollTop;
        rerender(ui(2));
        expect(scroller.scrollTop).toBeLessThan(after);
    });
});
