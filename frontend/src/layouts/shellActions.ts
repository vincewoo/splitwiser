import { useOutletContext } from 'react-router-dom';

/**
 * Actions the shell owns and its routed screens can trigger. The add-expense
 * and settle-up surfaces are mounted once by AppShell rather than by each
 * screen, so they survive navigation.
 *
 * Kept out of AppShell.tsx so that file only exports its component.
 */
export interface ShellActions {
    openAddExpense: () => void;
    /** The add-expense modal pre-toggled to "Money received". */
    openAddIncome: () => void;
    openSettleUp: () => void;
    /** Account, help, theme and sign-out. */
    openProfile: () => void;
}

export function useShellActions(): ShellActions {
    return useOutletContext<ShellActions>();
}
