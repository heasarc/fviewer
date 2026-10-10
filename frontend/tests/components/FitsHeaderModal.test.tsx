import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FitsHeaderModal } from '../../src/components/FitsHeaderModal';

const card = (k: string, v: string, c = '') => `${k.padEnd(8)}= ${v}${c ? ` / ${c}` : ''}`.padEnd(80);
const plain = (k: string, text: string) => `${k.padEnd(8)}${text}`.padEnd(80);
const header = [
    card('SIMPLE', 'T', 'standard'),
    card('NAXIS', '2', 'dims'),
    card('OBJECT', "'M31     '", 'target name'),
    card('LONGSTR', "'abc&'"),
    `CONTINUE  'def'`.padEnd(80),
    plain('COMMENT', 'hello world'),
    `HIERARCH ESO DET = 5.5 / hier`.padEnd(80),
    `HIERARCH note without equals`.padEnd(80),
    card('BADQUOTE', "'unterminated"),
    'END'.padEnd(80),
].join('');

const mount = (over: any = {}) => {
    const onUpdateKeyword = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
    const r = render(<FitsHeaderModal isOpen onClose={onClose} rawHeader={header} onUpdateKeyword={onUpdateKeyword} {...over} />);
    return { ...r, onUpdateKeyword, onClose };
};

describe('FitsHeaderModal', () => {
    beforeEach(() => { vi.spyOn(window, 'alert').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it('renders nothing when closed', () => {
        expect(mount({ isOpen: false }).container).toBeEmptyDOMElement();
    });

    it('parses cards: strings, numbers, booleans, HIERARCH, CONTINUE, comments', () => {
        mount();
        expect(screen.getByText('M31')).toBeInTheDocument();
        expect(screen.getByText('target name')).toBeInTheDocument();
        expect(screen.getByText('HIERARCH ESO DET')).toBeInTheDocument();
        expect(screen.getByText('5.5')).toBeInTheDocument();
        expect(screen.getByText('abcdef')).toBeInTheDocument(); // merged CONTINUE
        expect(screen.getByText('hello world')).toBeInTheDocument();
        expect(screen.queryByText('END')).toBeNull();
        expect(screen.getByText(/keywords found/).textContent).toBe('8 keywords found');
    });

    it('also parses headers without newlines or with them', () => {
        mount({ rawHeader: header.match(/.{80}/g)!.join('\n') });
        expect(screen.getByText('M31')).toBeInTheDocument();
        cleanup();
        mount({ rawHeader: '' });
        expect(screen.getByText('No matching keywords found.')).toBeInTheDocument();
    });

    it('filters by keyword, value and comment', () => {
        mount();
        const search = screen.getAllByRole('textbox')[0];
        fireEvent.change(search, { target: { value: 'target' } });
        expect(screen.getByText('OBJECT')).toBeInTheDocument();
        expect(screen.queryByText('NAXIS')).toBeNull();
        fireEvent.change(search, { target: { value: 'zzzz' } });
        expect(screen.getByText('No matching keywords found.')).toBeInTheDocument();
    });

    it('closes via X and footer button', () => {
        const { onClose } = mount();
        fireEvent.click(screen.getByTitle('Close (Esc)'));
        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    const editValueOf = (kw: string) => {
        const row = screen.getByText(kw).parentElement!;
        return row.children[1] as HTMLElement;
    };

    it('edits a value on Enter, preserving numeric flag and comment', async () => {
        const { onUpdateKeyword } = mount();
        fireEvent.doubleClick(editValueOf('NAXIS'));
        const input = screen.getByDisplayValue('2');
        fireEvent.change(input, { target: { value: '3' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(onUpdateKeyword).toHaveBeenCalledWith('NAXIS', '3', true, 'dims'));
        await waitFor(() => expect(screen.queryByDisplayValue('3')).toBeNull());
    });

    it('does not update unchanged values, cancels on Escape, and saves on blur', async () => {
        const { onUpdateKeyword } = mount();
        fireEvent.doubleClick(editValueOf('NAXIS'));
        fireEvent.keyDown(screen.getByDisplayValue('2'), { key: 'Enter' });
        await waitFor(() => expect(screen.queryByDisplayValue('2')).toBeNull());
        expect(onUpdateKeyword).not.toHaveBeenCalled();

        fireEvent.doubleClick(editValueOf('NAXIS'));
        fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '9' } });
        fireEvent.keyDown(screen.getByDisplayValue('9'), { key: 'Escape' });
        expect(screen.queryByDisplayValue('9')).toBeNull();
        expect(onUpdateKeyword).not.toHaveBeenCalled();

        fireEvent.doubleClick(editValueOf('NAXIS'));
        fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '4' } });
        fireEvent.blur(screen.getByDisplayValue('4'));
        await waitFor(() => expect(onUpdateKeyword).toHaveBeenCalledTimes(1));
    });

    it('shows inline feedback when a value update fails', async () => {
        const { onUpdateKeyword } = mount();
        onUpdateKeyword.mockRejectedValue(new Error('bad'));
        fireEvent.doubleClick(editValueOf('NAXIS'));
        fireEvent.change(screen.getByDisplayValue('2'), { target: { value: 'x' } });
        fireEvent.keyDown(screen.getByDisplayValue('x'), { key: 'Enter' });
        await waitFor(() => expect(screen.getByText(/Failed to update NAXIS/)).toBeInTheDocument());
    });

    it('does not allow editing comment-only cards', () => {
        mount();
        fireEvent.doubleClick(editValueOf('COMMENT'));
        fireEvent.doubleClick(screen.getByText('hello world').parentElement!);
        expect(screen.getAllByRole('textbox')).toHaveLength(1); // only search
    });

    it('edits a comment, keeping the value (numeric detection)', async () => {
        const { onUpdateKeyword } = mount();
        fireEvent.doubleClick(screen.getByText('dims').parentElement!);
        const input = screen.getByDisplayValue('dims');
        fireEvent.change(input, { target: { value: 'dimensions' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(onUpdateKeyword).toHaveBeenCalledWith('NAXIS', '2', true, 'dimensions'));

        fireEvent.doubleClick(screen.getByText('target name').parentElement!);
        const i2 = screen.getByDisplayValue('target name');
        fireEvent.change(i2, { target: { value: 'new' } });
        fireEvent.blur(i2);
        await waitFor(() => expect(onUpdateKeyword).toHaveBeenLastCalledWith('OBJECT', 'M31', false, 'new'));
    });

    it('leaves comments unchanged or cancels on Escape without updating', async () => {
        const { onUpdateKeyword } = mount();
        fireEvent.doubleClick(screen.getByText('dims').parentElement!);
        fireEvent.keyDown(screen.getByDisplayValue('dims'), { key: 'Enter' });
        await waitFor(() => expect(screen.queryByDisplayValue('dims')).toBeNull());
        fireEvent.doubleClick(screen.getByText('dims').parentElement!);
        fireEvent.keyDown(screen.getByDisplayValue('dims'), { key: 'Escape' });
        expect(onUpdateKeyword).not.toHaveBeenCalled();
    });

    describe('add keyword form', () => {
        const open = () => {
            const r = mount();
            fireEvent.click(screen.getByText('New Keyword'));
            return r;
        };

        it('toggles the form', () => {
            open();
            expect(screen.getByPlaceholderText('KEYWORD')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByPlaceholderText('KEYWORD')).toBeNull();
        });

        it('disables Add without a name', () => {
            open();
            expect(screen.getByText('Add')).toBeDisabled();
        });

        it('adds a keyword (uppercased) and clears the form', async () => {
            const { onUpdateKeyword } = open();
            fireEvent.change(screen.getByPlaceholderText('KEYWORD'), { target: { value: 'mykey' } });
            fireEvent.change(screen.getByPlaceholderText('Value'), { target: { value: '12' } });
            fireEvent.change(screen.getByPlaceholderText('Comment (optional)'), { target: { value: 'hi' } });
            fireEvent.click(screen.getByLabelText('Numeric'));
            fireEvent.click(screen.getByText('Add'));
            await waitFor(() => expect(onUpdateKeyword).toHaveBeenCalledWith('MYKEY', '12', true, 'hi'));
            await waitFor(() => expect(screen.getByPlaceholderText('KEYWORD')).toHaveValue(''));
            expect(screen.getByPlaceholderText('Value')).toHaveValue('');
        });

        it('uses HIERARCH for names longer than 8 characters', async () => {
            const { onUpdateKeyword } = open();
            fireEvent.change(screen.getByPlaceholderText('KEYWORD'), { target: { value: 'verylongname' } });
            fireEvent.click(screen.getByText('Add'));
            await waitFor(() => expect(onUpdateKeyword).toHaveBeenCalledWith('HIERARCH VERYLONGNAME', '', false, ''));
        });

        it('shows inline feedback on failure and keeps the form values', async () => {
            const { onUpdateKeyword } = open();
            onUpdateKeyword.mockRejectedValue(new Error('x'));
            fireEvent.change(screen.getByPlaceholderText('KEYWORD'), { target: { value: 'k' } });
            fireEvent.click(screen.getByText('Add'));
            await waitFor(() => expect(screen.getByText('Failed to add keyword.')).toBeInTheDocument());
            expect(screen.getByPlaceholderText('KEYWORD')).toHaveValue('K');
        });
    });
});
