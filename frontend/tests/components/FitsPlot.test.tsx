import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { FitsPlot } from '../../src/components/FitsPlot';

afterEach(cleanup);

const seq = (n: number, f = (i: number) => i) => Array.from({ length: n }, (_, i) => f(i));
const title = (c: HTMLElement) => c.querySelector('.u-title')?.textContent;
const hasCanvas = (c: HTMLElement) => !!c.querySelector('canvas');
const legend = (c: HTMLElement) => c.querySelector('.u-legend')?.textContent ?? '';

describe('FitsPlot', () => {
    it('renders a scatter plot with a default title', () => {
        const { container } = render(<FitsPlot xData={seq(20)} yData={seq(20, i => i * i)} xLabel="T" yLabel="R" pointColor="#f00" />);
        expect(hasCanvas(container)).toBe(true);
        expect(title(container)).toBe('R vs T');
        expect(legend(container)).toContain('R');
    });

    it('uses a custom title and falls back to "Counts" as the y label', () => {
        const { container } = render(<FitsPlot xData={seq(5)} yData={seq(5)} xLabel="X" title="Mine" />);
        expect(title(container)).toBe('Mine');
        cleanup();
        const r = render(<FitsPlot xData={seq(5)} yData={seq(5)} xLabel="X" />);
        expect(title(r.container)).toBe('Counts vs X');
    });

    it('renders nothing for empty data or missing Y in scatter mode', () => {
        expect(hasCanvas(render(<FitsPlot xData={[]} yData={[]} xLabel="X" />).container)).toBe(false);
        cleanup();
        expect(hasCanvas(render(<FitsPlot xData={seq(5)} xLabel="X" />).container)).toBe(false);
    });

    it('renders nothing when every point is invalid', () => {
        const { container } = render(<FitsPlot xData={[NaN, NaN]} yData={[1, 2]} xLabel="X" />);
        expect(hasCanvas(container)).toBe(false);
    });

    it('draws X and Y error bars and adds hidden error series', () => {
        const { container } = render(<FitsPlot xData={seq(10)} yData={seq(10)} xErrData={seq(10, () => 0.5)} yErrData={seq(10, () => 1)} xLabel="X" yLabel="Y" />);
        expect(hasCanvas(container)).toBe(true);
        expect(legend(container)).toContain('Y-Err');
        expect(legend(container)).toContain('X-Err');
    });

    it('ignores error arrays whose length mismatches', () => {
        const { container } = render(<FitsPlot xData={seq(10)} yData={seq(10)} yErrData={[1]} xErrData={[1]} xLabel="X" yLabel="Y" />);
        expect(legend(container)).not.toContain('Y-Err');
    });

    it('renders only X error bars', () => {
        const { container } = render(<FitsPlot xData={seq(10)} yData={seq(10)} xErrData={seq(10, () => 1)} xLabel="X" yLabel="Y" />);
        expect(legend(container)).toContain('X-Err');
        expect(legend(container)).not.toContain('Y-Err');
    });

    it('renders a histogram with a derived title', () => {
        const { container } = render(<FitsPlot xData={seq(100, i => i % 10)} xLabel="Flux" plotType="histogram" numBins={10} />);
        expect(title(container)).toBe('Flux Distribution');
        expect(legend(container)).toContain('Count');
    });

    it('handles constant-valued histograms and log-scale histograms', () => {
        expect(hasCanvas(render(<FitsPlot xData={[3, 3, 3]} xLabel="X" plotType="histogram" />).container)).toBe(true);
        cleanup();
        expect(hasCanvas(render(<FitsPlot xData={seq(50, i => i + 1)} xLabel="X" plotType="histogram" logY numBins={5} />).container)).toBe(true);
    });

    it('supports log axes, dropping non-positive values', () => {
        const { container } = render(<FitsPlot xData={[-1, 0, 1, 10, 100]} yData={[1, 2, 0, 10, 100]} xLabel="X" yLabel="Y" logX logY />);
        expect(hasCanvas(container)).toBe(true);
        cleanup();
        expect(hasCanvas(render(<FitsPlot xData={[-1, 0]} yData={[1, 2]} xLabel="X" logX />).container)).toBe(false);
    });

    it('accepts typed arrays and BigInt data', () => {
        expect(hasCanvas(render(<FitsPlot xData={new Float32Array([1, 2, 3])} yData={new Float64Array([1, 2, 3])} xLabel="X" />).container)).toBe(true);
        cleanup();
        expect(hasCanvas(render(<FitsPlot xData={new BigInt64Array([1n, 2n, 3n])} yData={new BigInt64Array([4n, 5n, 6n])} xLabel="X" />).container)).toBe(true);
    });

    it('applies row-range subsets, including reversed and out-of-bounds ranges', () => {
        const props = { xData: seq(100), yData: seq(100), xLabel: 'X', subsetMode: 'range' as const };
        expect(hasCanvas(render(<FitsPlot {...props} subsetRange={[10, 20]} />).container)).toBe(true);
        cleanup();
        expect(hasCanvas(render(<FitsPlot {...props} subsetRange={[50, 10]} />).container)).toBe(true);
        cleanup();
        expect(hasCanvas(render(<FitsPlot {...props} subsetRange={[500, 600]} />).container)).toBe(false);
    });

    it('applies random sampling only when the data exceeds the sample size', () => {
        const props = { xData: seq(100), yData: seq(100), xLabel: 'X', subsetMode: 'random' as const };
        const rnd = vi.spyOn(Math, 'random');
        render(<FitsPlot {...props} subsetRandomN={10} />);
        expect(rnd).toHaveBeenCalledTimes(10);
        rnd.mockClear();
        render(<FitsPlot {...props} subsetRandomN={1000} />);
        expect(rnd).not.toHaveBeenCalled();
        rnd.mockRestore();
    });

    it('handles massive datasets', () => {
        const n = 12000;
        expect(hasCanvas(render(<FitsPlot xData={seq(n)} yData={seq(n)} xLabel="X" />).container)).toBe(true);
    });

    it('re-renders on prop changes without leaking plots, and cleans up on unmount', () => {
        const { container, rerender, unmount } = render(<FitsPlot xData={seq(10)} yData={seq(10)} xLabel="X" />);
        rerender(<FitsPlot xData={seq(10)} yData={seq(10)} xLabel="X2" />);
        expect(container.querySelectorAll('.uplot')).toHaveLength(1);
        expect(title(container)).toBe('Counts vs X2');
        unmount();
        expect(container.querySelector('.uplot')).toBeNull();
    });

    it('resizes with the window', () => {
        const { container } = render(<FitsPlot xData={seq(10)} yData={seq(10)} xLabel="X" />);
        act(() => { window.dispatchEvent(new Event('resize')); });
        expect(hasCanvas(container)).toBe(true);
    });
});
