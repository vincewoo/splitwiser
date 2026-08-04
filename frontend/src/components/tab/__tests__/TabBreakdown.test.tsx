import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TabBreakdown from '../TabBreakdown';
import type { TabItem, TabParticipant } from '../../../types/tab';

const items: TabItem[] = [
    {
        id: 1,
        description: 'Pizza margherita',
        price: 2800,
        added_manually: false,
        claimed_by: [10, 20],
    },
    {
        id: 2,
        description: 'Negroni',
        price: 1400,
        added_manually: false,
        claimed_by: [10],
    },
    // Nobody's: falls to the whole table.
    { id: 3, description: 'Olives', price: 600, added_manually: false, claimed_by: [] },
];

const participants: TabParticipant[] = [
    { id: 10, display_name: 'Maya', user_id: 9 },
    { id: 20, display_name: 'Dani', user_id: null },
];

function renderBreakdown(props: Partial<React.ComponentProps<typeof TabBreakdown>> = {}) {
    return render(
        <TabBreakdown
            items={items}
            participants={participants}
            currency="USD"
            tax={400}
            tip={600}
            {...props}
        />
    );
}

/**
 * The expandable region for one person, by the name on its disclosure.
 *
 * Resolved through `aria-controls` rather than by walking up the DOM: the
 * button no longer contains the region it opens, because the paid tick has to
 * sit beside it (a button cannot hold another button).
 */
function rowFor(name: string): HTMLElement {
    const button = screen.getByRole('button', { name: new RegExp(name) });
    const id = button.getAttribute('aria-controls');
    const region = id ? document.getElementById(id) : null;
    if (!region) throw new Error(`No open region for ${name}`);
    return region;
}

describe('TabBreakdown', () => {
    it('shows everyone with the total they would owe', () => {
        renderBreakdown();

        // Maya: 1400 + 1400 + 300 = 3100 of items, Dani: 1400 + 300 = 1700.
        // Tax and tip (1000) follow that split: 646 / 354.
        expect(screen.getByRole('button', { name: /Maya/ })).toHaveTextContent('$37.46');
        expect(screen.getByRole('button', { name: /Dani/ })).toHaveTextContent('$20.54');
    });

    it('opens the viewer\'s own row first, and calls them "You"', () => {
        renderBreakdown({ meId: 10 });

        expect(screen.getByRole('button', { name: /You/ })).toHaveAttribute(
            'aria-expanded',
            'true'
        );
        expect(screen.getByRole('button', { name: /Dani/ })).toHaveAttribute(
            'aria-expanded',
            'false'
        );
    });

    it('reveals the lines behind a total on demand', () => {
        renderBreakdown();

        // Nothing opens by default when the viewer has no row of their own.
        expect(screen.queryByText('Pizza margherita')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Dani/ }));

        // Their half of the pizza and their third of the olives — not the
        // Negroni, which they had nothing to do with.
        const dani = rowFor('Dani');
        expect(within(dani).getByText('Pizza margherita')).toBeInTheDocument();
        expect(within(dani).getByText('Olives')).toBeInTheDocument();
        expect(within(dani).queryByText('Negroni')).not.toBeInTheDocument();
    });

    it('says how a shared line was split, and flags one nobody claimed', () => {
        renderBreakdown({ meId: 20 });

        const dani = rowFor('You');
        expect(within(dani).getByText(/Split 2 ways/)).toBeInTheDocument();
        expect(within(dani).getByText(/Nobody claimed it/)).toBeInTheDocument();
    });

    it('breaks the tax and the tip out separately', () => {
        renderBreakdown({ meId: 10 });

        const maya = rowFor('You');
        expect(within(maya).getByText('Your share of the tax')).toBeInTheDocument();
        expect(within(maya).getByText('Your share of the tip')).toBeInTheDocument();
    });

    it('leaves out a tax or tip line the bill does not have', () => {
        renderBreakdown({ meId: 10, tax: 0, tip: 500 });

        const maya = rowFor('You');
        expect(within(maya).queryByText(/share of the tax/)).not.toBeInTheDocument();
        expect(within(maya).getByText('Your share of the tip')).toBeInTheDocument();
    });

    it('marks the payer and what they are up', () => {
        renderBreakdown({ payerId: 10, openBy: 'none' });

        const maya = screen.getByRole('button', { name: /Maya/ });
        expect(maya).toHaveTextContent('Paid the bill');
        // The bill is $58.00; their own share is $37.46.
        expect(maya).toHaveTextContent('$20.54');
    });

    it('draws only the rows asked for, still costed against the whole table', () => {
        renderBreakdown({ showOnly: [20], meId: 20, collapsible: false });

        expect(screen.queryByText('Maya')).not.toBeInTheDocument();
        // Unchanged by Maya's absence from the list: she is still at the table,
        // so Dani still carries only half the pizza. Once in the heading, once
        // as the total of the working below it.
        expect(screen.getAllByText('$20.54')).toHaveLength(2);
    });

    it('renders nothing before anyone has joined', () => {
        const { container } = renderBreakdown({ participants: [] });
        expect(container).toBeEmptyDOMElement();
    });
});

describe('TabBreakdown paid ticks', () => {
    it('shows no ticks unless a handler is given', () => {
        // The claim page and the close screen render this too, and neither is
        // a place to assert that somebody has settled.
        renderBreakdown();
        expect(screen.queryByRole('switch')).toBeNull();
    });

    it('offers a tick for everyone who owes', () => {
        renderBreakdown({ onTogglePaid: () => {} });
        expect(screen.getAllByRole('switch')).toHaveLength(2);
    });

    it('offers none to the payer, who is owed rather than owing', () => {
        renderBreakdown({ onTogglePaid: () => {}, payerId: 10 });

        const ticks = screen.getAllByRole('switch');
        expect(ticks).toHaveLength(1);
        expect(ticks[0]).toHaveAccessibleName('Dani has paid');
    });

    it('reports who was ticked, and which way', () => {
        const onTogglePaid = vi.fn();
        renderBreakdown({ onTogglePaid });

        fireEvent.click(screen.getByRole('switch', { name: 'Dani has paid' }));
        expect(onTogglePaid).toHaveBeenCalledWith(20, true);
    });

    it('takes a tick back rather than setting it again', () => {
        const onTogglePaid = vi.fn();
        renderBreakdown({
            onTogglePaid,
            participants: [
                { id: 10, display_name: 'Maya', user_id: 9 },
                { id: 20, display_name: 'Dani', user_id: null, paid: true },
            ],
        });

        const tick = screen.getByRole('switch', { name: 'Dani has paid' });
        expect(tick).toBeChecked();
        fireEvent.click(tick);
        expect(onTogglePaid).toHaveBeenCalledWith(20, false);
    });

    it('says so in the row of somebody who has settled', () => {
        renderBreakdown({
            participants: [
                { id: 10, display_name: 'Maya', user_id: 9 },
                { id: 20, display_name: 'Dani', user_id: null, paid: true },
            ],
        });

        expect(screen.getByRole('button', { name: /Dani/ })).toHaveTextContent(
            'Settled up'
        );
    });

    it('does not tick off the payer just because their seat says paid', () => {
        // "Paid the bill" and "paid me back" are different claims; the payer's
        // caption must keep saying the first.
        renderBreakdown({
            payerId: 20,
            participants: [
                { id: 10, display_name: 'Maya', user_id: 9 },
                { id: 20, display_name: 'Dani', user_id: null, paid: true },
            ],
        });

        expect(screen.getByRole('button', { name: /Dani/ })).toHaveTextContent(
            'Paid the bill'
        );
    });
});
