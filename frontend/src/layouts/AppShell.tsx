import React, { useCallback, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import DesktopRail from './DesktopRail';
import MobileTabBar from './MobileTabBar';
import FabSheet from './FabSheet';
import type { ResumeTarget } from './FabSheet';
import AddExpenseModal from '../AddExpenseModal';
import ReceiptScanner from '../ReceiptScanner';
import ProfileSheet from '../components/ProfileSheet';
import OpenTabSheet from '../components/tab/OpenTabSheet';
import type { OpenTabDetails, PendingTab } from '../components/tab/OpenTabSheet';
import { tabsApi } from '../services/api';
import { useIsDesktop } from '../hooks/useMediaQuery';
import { useAppData } from '../contexts/AppDataContext';
import { pinnedGroups } from '../utils/groupBalances';
import type { ShellActions } from './shellActions';

/**
 * The persistent frame around every authenticated screen.
 *
 * "One app, two postures": on desktop a rail sits beside a workspace that fills
 * the rest of the viewport; on mobile the same routes render full-bleed above a
 * bottom tab bar with the FAB. Which one mounts is decided in JS rather than by
 * CSS, because the two postures render structurally different components.
 */
const AppShell: React.FC = () => {
    const isDesktop = useIsDesktop();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { friends, groups, balances, pendingRequests, refreshAll } = useAppData();

    /**
     * The group you are looking at, if any. Adding an expense from the FAB
     * while a group is on screen should land in that group rather than making
     * you pick it again; the id is read from the route because the shell
     * mounts the modal above the routed screen and never sees its state.
     */
    const activeGroupId = useMemo(() => {
        const match = /^\/groups\/(\d+)(?:\/|$)/.exec(pathname);
        return match ? Number(match[1]) : null;
    }, [pathname]);

    const [fabOpen, setFabOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [expenseModal, setExpenseModal] = useState<{
        open: boolean;
        scanner: boolean;
        groupId: number | null;
    }>({ open: false, scanner: false, groupId: null });

    // "Split a bill at the table": scan the receipt, name the place, open a tab.
    const [tabScannerOpen, setTabScannerOpen] = useState(false);
    const [pendingTab, setPendingTab] = useState<PendingTab | null>(null);
    const [openingTab, setOpeningTab] = useState(false);
    const [tabError, setTabError] = useState<string | null>(null);

    const handleScannedForTab = useCallback(
        (
            items: { description: string; price: number }[],
            receiptPath?: string,
            _warning?: string | null,
            tax?: number | null,
            tip?: number | null,
            total?: number | null
        ) => {
            setTabScannerOpen(false);
            setPendingTab({
                items,
                tax: tax ?? 0,
                tip: tip ?? 0,
                total: total ?? null,
                receiptPath,
            });
            setTabError(null);
        },
        []
    );

    const openTab = useCallback(
        async ({ name, tip, total }: OpenTabDetails) => {
            if (!pendingTab) return;
            setOpeningTab(true);
            setTabError(null);
            try {
                const tab = await tabsApi.create({
                    name,
                    items: pendingTab.items,
                    tax: pendingTab.tax ?? 0,
                    tip,
                    total,
                    receipt_image_path: pendingTab.receiptPath ?? null,
                });
                setPendingTab(null);
                navigate(`/tabs/${tab.id}`);
            } catch (error) {
                setTabError(
                    error instanceof Error
                        ? error.message
                        : 'Could not open the tab. Please try again.'
                );
            } finally {
                setOpeningTab(false);
            }
        },
        [pendingTab, navigate]
    );

    const pinned = useMemo(
        () =>
            pinnedGroups(groups, balances).map(({ group, net }) => ({
                group,
                balance: net ? net.amount : null,
                currency: net ? net.currency : 'USD',
            })),
        [groups, balances]
    );

    // "Pick up where you left off" — the groups you have most at stake in.
    // Open tabs will join this strip once the tab flow exists.
    //
    // The caption is the group's standing balance rather than a member count:
    // /groups returns groups without their members, so a count here would
    // always read "0 people".
    const resumeTargets: ResumeTarget[] = useMemo(
        () =>
            pinnedGroups(groups, balances, 2).map(({ group, net }) => ({
                key: `group-${group.id}`,
                label: group.name,
                caption:
                    net && net.amount !== 0
                        ? net.amount > 0
                            ? 'you are owed'
                            : 'you owe'
                        : 'all square',
                icon: group.icon || '👥',
                onSelect: () => navigate(`/groups/${group.id}`),
            })),
        [groups, balances, navigate]
    );

    const openAddExpense = useCallback(
        () => setExpenseModal({ open: true, scanner: false, groupId: activeGroupId }),
        [activeGroupId]
    );
    const openSettleUp = useCallback(() => navigate('/settle'), [navigate]);
    const openProfile = useCallback(() => setProfileOpen(true), []);
    const shellActions = useMemo<ShellActions>(
        () => ({ openAddExpense, openSettleUp, openProfile }),
        [openAddExpense, openSettleUp, openProfile]
    );

    const tabFlow = (
        <>
            {tabScannerOpen && (
                <ReceiptScanner
                    onItemsDetected={handleScannedForTab}
                    onClose={() => setTabScannerOpen(false)}
                />
            )}

            {/*
              * Name the place and settle the tip. The receipt gives us the
              * lines, not the venue — and rarely the tip, which is written on
              * it after it prints.
              */}
            {pendingTab && (
                <OpenTabSheet
                    pending={pendingTab}
                    onClose={() => setPendingTab(null)}
                    onOpen={openTab}
                    busy={openingTab}
                    error={tabError}
                />
            )}
        </>
    );

    const content = (
        <>
            <Outlet context={shellActions} />
            {tabFlow}

            <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} />

            <AddExpenseModal
                isOpen={expenseModal.open}
                openScanner={expenseModal.scanner}
                preselectedGroupId={expenseModal.groupId}
                onClose={() =>
                    setExpenseModal({ open: false, scanner: false, groupId: null })
                }
                onExpenseAdded={refreshAll}
                friends={friends}
                groups={groups}
            />
        </>
    );

    if (isDesktop) {
        return (
            <div className="flex h-screen bg-sw-bg text-sw-text font-sans overflow-hidden">
                <DesktopRail
                    groupCount={groups.length}
                    peopleCount={friends.length}
                    pinned={pinned}
                    onOpenProfile={openProfile}
                    pendingRequests={pendingRequests}
                />
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    {content}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-screen bg-sw-bg text-sw-text font-sans overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{content}</div>

            <MobileTabBar onFabPress={() => setFabOpen(true)} />

            <FabSheet
                open={fabOpen}
                onClose={() => setFabOpen(false)}
                onAddExpense={openAddExpense}
                onSplitBill={() => setTabScannerOpen(true)}
                onSettleUp={openSettleUp}
                resumeTargets={resumeTargets}
            />
        </div>
    );
};

export default AppShell;
