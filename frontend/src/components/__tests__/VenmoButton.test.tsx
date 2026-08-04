import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VenmoButton from '../VenmoButton';

const cancel = vi.fn();
const openVenmo = vi.fn((...args: unknown[]) => {
    void args;
    return cancel;
});

vi.mock('../../utils/venmo', async () => {
    const actual = await vi.importActual<typeof import('../../utils/venmo')>(
        '../../utils/venmo'
    );
    return { ...actual, openVenmo: (...args: unknown[]) => openVenmo(...args) };
});

const links = {
    app: 'venmo://paycharge?txn=pay&amount=42.35',
    web: 'https://venmo.com/?txn=pay&amount=42.35',
};

afterEach(() => {
    openVenmo.mockClear();
    cancel.mockClear();
});

describe('VenmoButton', () => {
    it('is a real link to the web form, so it can be copied or opened in a tab', () => {
        render(<VenmoButton links={links} action="pay" />);
        const link = screen.getByRole('link', { name: 'Pay with Venmo' });
        expect(link).toHaveAttribute('href', links.web);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('says who is being paid when it knows', () => {
        render(<VenmoButton links={links} action="pay" counterparty="Maya Lin" />);
        screen.getByRole('link', { name: 'Pay Maya Lin with Venmo' });
    });

    it('asks rather than pays when the debt runs the other way', () => {
        render(<VenmoButton links={links} action="request" counterparty="Maya Lin" />);
        const link = screen.getByRole('link', { name: 'Ask Maya Lin on Venmo' });
        expect(link).toHaveTextContent('Ask on Venmo');
    });

    it('shortens to just "Venmo" in a tight row, keeping the full label for screen readers', () => {
        render(
            <VenmoButton links={links} action="pay" counterparty="Maya Lin" compact />
        );
        const link = screen.getByRole('link', { name: 'Pay Maya Lin with Venmo' });
        expect(link).toHaveTextContent('Venmo');
    });

    it('upgrades a plain click to try the installed app first', () => {
        render(<VenmoButton links={links} action="pay" />);
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        fireEvent(screen.getByRole('link'), click);
        expect(openVenmo).toHaveBeenCalledWith(links);
        expect(click.defaultPrevented).toBe(true);
    });

    it('leaves a modified click to the browser — that is a request for a new tab', () => {
        render(<VenmoButton links={links} action="pay" />);
        const click = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            metaKey: true,
        });
        fireEvent(screen.getByRole('link'), click);
        expect(openVenmo).not.toHaveBeenCalled();
        expect(click.defaultPrevented).toBe(false);
    });

    it('cancels a pending hand-off on unmount, so a dismissed modal cannot navigate behind you', () => {
        const view = render(<VenmoButton links={links} action="pay" />);
        fireEvent.click(screen.getByRole('link'));
        expect(cancel).not.toHaveBeenCalled();
        view.unmount();
        expect(cancel).toHaveBeenCalledTimes(1);
    });
});
