import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VectorModal } from '../../src/components/VectorModal';

afterEach(cleanup);

describe('VectorModal', () => {
    it('shows column metadata and a virtualized window of rows', () => {
        render(<VectorModal colName="FLUX" rowIndex={4} data={new Float32Array(1000).map((_, i) => i)} onClose={vi.fn()} />);
        expect(screen.getByText('FLUX')).toBeInTheDocument();
        expect(screen.getByText('Float32Array')).toBeInTheDocument();
        expect(screen.getByText('1000')).toBeInTheDocument();
        expect(screen.getByText('Array Viewer')).toBeInTheDocument();
        expect(screen.queryByText('999')).toBeNull();
    });

    it('renders further rows after scrolling', () => {
        const { container } = render(<VectorModal colName="c" rowIndex={0} data={Array.from({ length: 1000 }, (_, i) => i * 2)} onClose={vi.fn()} />);
        const area = container.querySelector('.overflow-auto') as HTMLElement;
        area.scrollTop = 24 * 500;
        fireEvent.scroll(area);
        expect(screen.getByText('1000')).toBeInTheDocument(); // value at index 500
    });

    it('closes via backdrop and X, but not via panel clicks', () => {
        const onClose = vi.fn();
        const { container } = render(<VectorModal colName="c" rowIndex={0} data={[1]} onClose={onClose} />);
        fireEvent.click(screen.getByText('Array Viewer'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(container.querySelector('.btn-close')!);
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(container.firstChild as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('is read-only without onEditElement', () => {
        render(<VectorModal colName="c" rowIndex={0} data={[7, 8]} onClose={vi.fn()} />);
        fireEvent.doubleClick(screen.getByText('7'));
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('edits an element with Enter and updates the local value', () => {
        const onEdit = vi.fn();
        const data = [7, 8];
        render(<VectorModal colName="c" rowIndex={0} data={data} onClose={vi.fn()} onEditElement={onEdit} />);
        fireEvent.doubleClick(screen.getByText('8'));
        const input = screen.getByRole('textbox');
        expect(input).toHaveValue('8');
        fireEvent.change(input, { target: { value: '42' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onEdit).toHaveBeenCalledWith(1, '42');
        expect(data[1]).toBe(42);
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('cancels editing on Escape and blur', () => {
        const onEdit = vi.fn();
        render(<VectorModal colName="c" rowIndex={0} data={[7]} onClose={vi.fn()} onEditElement={onEdit} />);
        fireEvent.doubleClick(screen.getByText('7'));
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.doubleClick(screen.getByText('7'));
        fireEvent.blur(screen.getByRole('textbox'));
        expect(screen.queryByRole('textbox')).toBeNull();
        expect(onEdit).not.toHaveBeenCalled();
    });
});
