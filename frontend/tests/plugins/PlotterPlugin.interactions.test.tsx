import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { initPlotterPlugin } from '../../src/plugins/PlotterPlugin';
import { renderPluginSlot } from '../utils/PluginTestWrapper';

const plotProps = vi.fn();
vi.mock('../../src/components/FitsPlot', () => ({
    FitsPlot: (p: any) => { plotProps(p); return <div data-testid="plot">{p.plotType}</div>; },
}));

const tableInfo = { numRows: 100, numCols: 3, columns: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
const mkWorker = () => ({ readColumn: vi.fn(async (i: number) => ({ data: new Float64Array([i, i]) })) });
const render = (over: any = {}) => {
    const fitsWorker = mkWorker(), voWorker = mkWorker();
    return { fitsWorker, voWorker, ...renderPluginSlot(initPlotterPlugin, 'workspace:right',
        { isPlotterOpen: true, tableInfo, activeHdu: 2, fitsWorker, voWorker, ...over }) };
};
const lastProps = () => plotProps.mock.calls.at(-1)![0];

describe('PlotterPlugin interactions', () => {
    afterEach(() => { cleanup(); vi.restoreAllMocks(); plotProps.mockClear(); });

    it('defaults axes to the first two columns and fetches them from the FITS worker', async () => {
        const { fitsWorker, voWorker } = render();
        await waitFor(() => expect(screen.getByTestId('plot')).toBeInTheDocument());
        expect(fitsWorker.readColumn).toHaveBeenCalledWith(1, 'A');
        expect(fitsWorker.readColumn).toHaveBeenCalledWith(2, 'B');
        expect(voWorker.readColumn).not.toHaveBeenCalled();
        expect(lastProps()).toMatchObject({ xLabel: 'A', yLabel: 'B', plotType: 'scatter', subsetMode: 'all' });
    });

    it('uses the VO worker for votables, even without an HDU', async () => {
        const { fitsWorker, voWorker } = render({ activeDataType: 'votable', activeHdu: null });
        await waitFor(() => expect(voWorker.readColumn).toHaveBeenCalledTimes(2));
        expect(fitsWorker.readColumn).not.toHaveBeenCalled();
    });

    it('does not fetch while closed', () => {
        const { fitsWorker } = render({ isPlotterOpen: false });
        expect(fitsWorker.readColumn).not.toHaveBeenCalled();
    });

    it('retries a column after a read failure and ignores empty results', async () => {
        const fitsWorker = { readColumn: vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(null) };
        render({ fitsWorker });
        await waitFor(() => expect(fitsWorker.readColumn).toHaveBeenCalledTimes(2));
        expect(screen.getByText('Select columns to plot')).toBeInTheDocument();
    });

    it('switches to histogram, disabling Y and error selectors', async () => {
        render();
        await screen.findByTestId('plot');
        fireEvent.change(screen.getByDisplayValue('Scatter Plot'), { target: { value: 'histogram' } });
        expect(screen.getByDisplayValue('Counts')).toBeDisabled();
        expect(lastProps()).toMatchObject({ plotType: 'histogram', yLabel: 'Counts', yData: undefined });
    });

    it('passes axis, error-bar, style and log options through', async () => {
        render();
        await screen.findByTestId('plot');
        const selects = screen.getAllByRole('combobox');
        // order: type, X, ErrX, Y, ErrY, subset
        fireEvent.change(selects[2], { target: { value: 'C' } });
        fireEvent.change(selects[4], { target: { value: 'C' } });
        fireEvent.change(selects[1], { target: { value: 'B' } });
        fireEvent.change(selects[3], { target: { value: 'A' } });
        fireEvent.click(screen.getByLabelText('Log Scale (X)'));
        fireEvent.click(screen.getByLabelText('Log Scale (Y)'));
        fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
        fireEvent.change(screen.getByTitle('Choose point color'), { target: { value: '#ff0000' } });
        await waitFor(() => expect(lastProps().xErrData).toBeDefined());
        expect(lastProps()).toMatchObject({ xLabel: 'B', yLabel: 'A', logX: true, logY: true, pointSize: 5, pointColor: '#ff0000' });
        expect(lastProps().yErrData).toBeDefined();
    });

    it('shows range and random sample controls', async () => {
        render();
        await screen.findByTestId('plot');
        const subset = screen.getByDisplayValue('Plot All Rows');
        fireEvent.change(subset, { target: { value: 'range' } });
        const nums = screen.getAllByRole('spinbutton').slice(1);
        fireEvent.change(nums[0], { target: { value: '5' } });
        fireEvent.change(nums[1], { target: { value: '50' } });
        const sliders = screen.getAllByRole('slider');
        fireEvent.change(sliders[0], { target: { value: '7' } });
        fireEvent.change(sliders[1], { target: { value: '60' } });
        expect(lastProps()).toMatchObject({ subsetMode: 'range', subsetRange: [7, 60] });

        fireEvent.change(subset, { target: { value: 'random' } });
        fireEvent.change(screen.getAllByRole('spinbutton').at(-1)!, { target: { value: '25' } });
        expect(lastProps()).toMatchObject({ subsetMode: 'random', subsetRandomN: 25 });
    });

    it('uses an overlay on narrow screens and keeps width inside the viewport', async () => {
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(500);
        vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(500);
        const { container } = render();
        await screen.findByTestId('plot');
        const panel = container.querySelector('.d-flex.flex-column.flex-shrink-0') as HTMLElement;
        expect(panel.style.position).toBe('fixed');
        expect(panel.style.right).toBe('0px');
        expect(panel.style.width).toBe('450px');
    });

    it('resizes by dragging, within limits, and stops on pointer up', async () => {
        vi.spyOn(document.body, 'clientWidth', 'get').mockReturnValue(1400);
        const { container } = render();
        await screen.findByTestId('plot');
        const handle = container.querySelector('[style*="col-resize"]') as HTMLElement;
        fireEvent.mouseEnter(handle); fireEvent.mouseLeave(handle);
        fireEvent.pointerDown(handle);
        const inner = () => container.querySelector('.p-3') as HTMLElement;
        act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1400 - 500 })); });
        expect(inner().style.width).toBe('500px');
        act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1400 - 10 })); });
        expect(inner().style.width).toBe('500px'); // too narrow: ignored
        act(() => { window.dispatchEvent(new PointerEvent('pointerup')); });
        act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1400 - 400 })); });
        expect(inner().style.width).toBe('500px');
    });

    it('closes via the close button', async () => {
        const setIsPlotterOpen = vi.fn();
        const { container } = render({ setIsPlotterOpen });
        fireEvent.click(container.querySelector('.btn-close')!);
        expect(setIsPlotterOpen).toHaveBeenCalledWith(false);
    });

    it('shows a region histogram for images, or placeholders', () => {
        render({ tableInfo: null, imageData: { width: 1, height: 1 }, activeRegionPixels: new Float32Array([1, 2, 3]) });
        expect(lastProps()).toMatchObject({ plotType: 'histogram', numBins: 50 });
        cleanup();
        render({ tableInfo: null, imageData: { width: 1, height: 1 } });
        expect(screen.getByText('No region selected.')).toBeInTheDocument();
        cleanup();
        render({ tableInfo: null, imageData: null });
        expect(screen.getByText('No data to plot')).toBeInTheDocument();
    });
});
