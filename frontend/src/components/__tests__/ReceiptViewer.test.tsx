import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReceiptViewer from '../ReceiptViewer';
import { getApiUrl } from '../../api';

const IMAGE = '/static/receipts/bar-sol.jpg';
const PDF = '/static/receipts/bar-sol.pdf';

describe('ReceiptViewer', () => {
    it('shows the receipt inline rather than linking away from the page', () => {
        render(<ReceiptViewer path={IMAGE} />);

        const thumbnail = screen.getByRole('img', { name: 'Receipt' });
        expect(thumbnail).toHaveAttribute('src', getApiUrl(IMAGE));
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('expands to full size when the thumbnail is clicked', () => {
        render(<ReceiptViewer path={IMAGE} />);
        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(
            screen.getByRole('button', { name: 'View the receipt full size' })
        );

        expect(screen.getByRole('dialog', { name: 'Receipt' })).toBeInTheDocument();
        expect(screen.getAllByRole('img', { name: 'Receipt' })).toHaveLength(2);
    });

    it('closes on Escape', () => {
        render(<ReceiptViewer path={IMAGE} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'View the receipt full size' })
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('toggles between fitted and actual size', () => {
        render(<ReceiptViewer path={IMAGE} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'View the receipt full size' })
        );

        const full = screen.getAllByRole('img', { name: 'Receipt' })[1];
        expect(full.className).toContain('max-w-full');

        fireEvent.click(full);
        expect(full.className).toContain('max-w-none');

        fireEvent.click(full);
        expect(full.className).toContain('max-w-full');
    });

    it('offers a PDF receipt as a link, since it cannot be an image', () => {
        render(<ReceiptViewer path={PDF} />);

        const link = screen.getByRole('link', { name: /Open the receipt PDF/ });
        expect(link).toHaveAttribute('href', getApiUrl(PDF));
        expect(link).toHaveAttribute('target', '_blank');
        expect(screen.queryByRole('img')).toBeNull();
    });

    it('falls back to a link when the image will not load', () => {
        render(<ReceiptViewer path={IMAGE} />);

        fireEvent.error(screen.getByRole('img', { name: 'Receipt' }));

        expect(
            screen.getByRole('link', { name: /Open the receipt/ })
        ).toHaveAttribute('href', getApiUrl(IMAGE));
    });
});
