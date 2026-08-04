import React, { useEffect, useState } from 'react';
import { Check, Eye, EyeSlash, X } from '@phosphor-icons/react';
import { Avatar, Button, Card, Field, Notice } from '../components/ui';
import PageHeader from './PageHeader';
import { usePageTitle } from '../hooks/usePageTitle';
import { useCurrencyPreferences } from '../hooks/useCurrencyPreferences';
import { useAppData } from '../contexts/AppDataContext';
import { formatCurrencyDisplay } from '../utils/currencyHelpers';
import { normalizeVenmoUsername, venmoUsernameError } from '../utils/venmo';
import { api } from '../services/api';

interface UserProfile {
    id: number;
    email: string;
    full_name: string;
    is_active: boolean;
    email_verified: boolean;
    password_changed_at: string | null;
    last_login_at: string | null;
    default_currency: string;
    venmo_username: string | null;
}

interface FriendRequest {
    id: number;
    from_user_id: number;
    from_user_name: string;
    from_user_email: string;
    to_user_id: number;
    to_user_name: string;
    to_user_email: string;
    status: string;
    created_at: string;
}

/** One feedback slot per card, rather than a success and an error state each. */
type Feedback = { tone: 'success' | 'error'; message: string } | null;

function formatDate(value: string | null): string {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
}

/**
 * Account settings.
 *
 * Simplified from four cards to three: "Security information" was two dates and
 * an email-verification control, so the control moved next to the email field
 * it concerns and the dates became a quiet footer under the password card.
 * Each card carries one feedback slot instead of a separate success and error
 * banner.
 */
const AccountSettingsPage: React.FC = () => {
    usePageTitle('Account settings');
    const { sortedCurrencies } = useCurrencyPreferences();
    // Answering a request here is what clears the badge in the shell.
    const { refreshFriends, refreshPendingRequests } = useAppData();

    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [defaultCurrency, setDefaultCurrency] = useState('USD');
    const [venmoUsername, setVenmoUsername] = useState('');
    const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
    const [savingProfile, setSavingProfile] = useState(false);
    const [resending, setResending] = useState(false);

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
    const [savingPassword, setSavingPassword] = useState(false);

    const [incoming, setIncoming] = useState<FriendRequest[]>([]);
    const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
    const [requestFeedback, setRequestFeedback] = useState<Feedback>(null);

    const loadProfile = async () => {
        try {
            const data: UserProfile = await api.profile.getProfile();
            setProfile(data);
            setFullName(data.full_name || '');
            setEmail(data.email);
            setDefaultCurrency(data.default_currency || 'USD');
            setVenmoUsername(data.venmo_username || '');
        } catch (error) {
            console.error('Failed to load profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadFriendRequests = async () => {
        try {
            const [inbound, outbound] = await Promise.all([
                api.friends.getIncomingRequests(),
                api.friends.getOutgoingRequests(),
            ]);
            setIncoming(inbound);
            setOutgoing(outbound);
        } catch (error) {
            console.error('Failed to load friend requests:', error);
        }
    };

    useEffect(() => {
        loadProfile();
        loadFriendRequests();
        // The badge is polled, so it can be up to a poll stale by the time you
        // arrive here. This is the one screen that shows the requests, so it
        // should be the screen that gets the count right.
        refreshPendingRequests();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleProfileUpdate = async (event: React.FormEvent) => {
        event.preventDefault();
        setProfileFeedback(null);
        setSavingProfile(true);

        try {
            const venmoProblem = venmoUsernameError(venmoUsername);
            if (venmoProblem) {
                setProfileFeedback({ tone: 'error', message: venmoProblem });
                return;
            }
            const venmo = normalizeVenmoUsername(venmoUsername);

            const updates: {
                full_name?: string;
                email?: string;
                default_currency?: string;
                venmo_username?: string;
            } = {};
            if (fullName !== profile?.full_name) updates.full_name = fullName;
            if (email !== profile?.email) updates.email = email;
            if (defaultCurrency !== profile?.default_currency) {
                updates.default_currency = defaultCurrency;
            }
            // An empty string is meaningful here: it asks the server to remove
            // the handle. Omitting the key leaves the stored one alone.
            if (venmo !== (profile?.venmo_username ?? '')) {
                updates.venmo_username = venmo;
            }

            if (Object.keys(updates).length === 0) {
                setProfileFeedback({ tone: 'error', message: 'Nothing to save.' });
                return;
            }

            await api.profile.updateProfile(updates);
            setProfileFeedback({
                tone: 'success',
                message: updates.email
                    ? 'Saved. Check your new address to confirm the change.'
                    : 'Saved.',
            });
            await loadProfile();
        } catch (error) {
            setProfileFeedback({
                tone: 'error',
                message:
                    error instanceof Error ? error.message : 'Could not save your profile.',
            });
        } finally {
            setSavingProfile(false);
        }
    };

    const handlePasswordChange = async (event: React.FormEvent) => {
        event.preventDefault();
        setPasswordFeedback(null);

        if (newPassword.length < 8) {
            setPasswordFeedback({
                tone: 'error',
                message: 'Your new password needs at least 8 characters.',
            });
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordFeedback({
                tone: 'error',
                message: "Those two passwords don't match.",
            });
            return;
        }

        setSavingPassword(true);
        try {
            await api.profile.changePassword(currentPassword, newPassword);
            setPasswordFeedback({
                tone: 'success',
                message: 'Password changed. Other sessions have been signed out.',
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            await loadProfile();
        } catch (error) {
            setPasswordFeedback({
                tone: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Could not change your password.',
            });
        } finally {
            setSavingPassword(false);
        }
    };

    const handleResend = async () => {
        setProfileFeedback(null);
        setResending(true);
        try {
            const response = await api.profile.resendVerificationEmail();
            setProfileFeedback({
                tone: 'success',
                message: response.message || 'Verification email sent — check your inbox.',
            });
        } catch (error) {
            setProfileFeedback({
                tone: 'error',
                message:
                    error instanceof Error
                        ? error.message
                        : 'Could not resend the verification email.',
            });
        } finally {
            setResending(false);
        }
    };

    /** Accept / reject / cancel all follow the same shape. */
    const respondToRequest = async (
        action: (id: number) => Promise<Response>,
        requestId: number,
        successMessage: string,
        failureMessage: string
    ) => {
        setRequestFeedback(null);
        try {
            const response = await action(requestId);
            if (response.ok) {
                setRequestFeedback({ tone: 'success', message: successMessage });
                loadFriendRequests();
                refreshPendingRequests();
                // Accepting one adds a friend; the rest of the app should know.
                refreshFriends();
            } else {
                const detail = await response.json().catch(() => ({}));
                setRequestFeedback({
                    tone: 'error',
                    message: detail.detail || failureMessage,
                });
            }
        } catch {
            setRequestFeedback({ tone: 'error', message: failureMessage });
        }
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-sw-muted">Loading…</p>
            </div>
        );
    }

    const hasRequests = incoming.length > 0 || outgoing.length > 0;

    return (
        <>
            <PageHeader
                title="Account"
                caption="Your profile, password and requests"
                mobileInset
            />

            <div className="flex-1 overflow-auto px-4 lg:px-[22px] py-4 flex flex-col gap-4 max-w-2xl w-full">
                {/* -------------------------------------------------- profile */}
                <Card radius="lg" className="p-[18px]">
                    <h2 className="text-[15px] font-medium mb-3.5">Profile</h2>

                    <form onSubmit={handleProfileUpdate} className="flex flex-col gap-3.5">
                        <Field
                            label="Name"
                            value={fullName}
                            onChange={(event) => setFullName(event.target.value)}
                            placeholder="Your name"
                        />

                        <Field
                            label="Email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            hint={
                                profile?.email_verified
                                    ? 'Verified.'
                                    : 'Not verified yet — some features stay locked until it is.'
                            }
                        />

                        {!profile?.email_verified && (
                            <Button
                                variant="secondary"
                                onClick={handleResend}
                                disabled={resending}
                                className="self-start"
                            >
                                {resending ? 'Sending…' : 'Resend verification email'}
                            </Button>
                        )}

                        <div className="flex flex-col gap-1.5">
                            <label
                                className="text-[12.5px] text-sw-muted"
                                htmlFor="default-currency"
                            >
                                Default currency
                            </label>
                            <select
                                id="default-currency"
                                value={defaultCurrency}
                                onChange={(event) => setDefaultCurrency(event.target.value)}
                                className="px-3 py-2.5 rounded-sw-row bg-sw-sunk text-sw-text border border-sw-line focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                            >
                                {sortedCurrencies.map((currency) => (
                                    <option key={currency.code} value={currency.code}>
                                        {formatCurrencyDisplay(currency.code)}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[11.5px] text-sw-dim">
                                Used for new expenses and for the “in my currency” totals.
                            </p>
                        </div>

                        <Field
                            label="Venmo username"
                            value={venmoUsername}
                            onChange={(event) => setVenmoUsername(event.target.value)}
                            placeholder="your-handle"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            hint="Optional. Anyone settling up with you gets a Venmo button with the amount already filled in. Seen by your friends, by people you share a group with, and — when you host a tab — by whoever holds that tab's link, so they can pay you without knowing you."
                        />

                        {profileFeedback && (
                            <Notice tone={profileFeedback.tone}>
                                {profileFeedback.message}
                            </Notice>
                        )}

                        <Button
                            type="submit"
                            variant="primary"
                            disabled={savingProfile}
                            className="self-start min-h-[42px]"
                        >
                            {savingProfile ? 'Saving…' : 'Save changes'}
                        </Button>
                    </form>
                </Card>

                {/* ------------------------------------------ friend requests */}
                {hasRequests && (
                    <Card radius="lg" className="p-[18px]">
                        <h2 className="text-[15px] font-medium mb-3.5">Friend requests</h2>

                        {requestFeedback && (
                            <Notice tone={requestFeedback.tone} className="mb-3">
                                {requestFeedback.message}
                            </Notice>
                        )}

                        {incoming.length > 0 && (
                            <>
                                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim mb-2">
                                    Waiting on you
                                </div>
                                <div className="flex flex-col gap-2 mb-4">
                                    {incoming.map((request) => (
                                        <div
                                            key={request.id}
                                            className="flex items-center gap-3 p-3 rounded-sw-row bg-sw-sunk"
                                        >
                                            <Avatar name={request.from_user_name} size={32} />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm truncate">
                                                    {request.from_user_name}
                                                </div>
                                                <div className="text-[11.5px] text-sw-dim truncate">
                                                    {request.from_user_email}
                                                </div>
                                            </div>
                                            <Button
                                                variant="primary"
                                                icon={<Check size={14} />}
                                                onClick={() =>
                                                    respondToRequest(
                                                        api.friends.acceptRequest,
                                                        request.id,
                                                        'Friend request accepted.',
                                                        'Could not accept that request.'
                                                    )
                                                }
                                            >
                                                Accept
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                aria-label={`Decline ${request.from_user_name}`}
                                                onClick={() =>
                                                    respondToRequest(
                                                        api.friends.rejectRequest,
                                                        request.id,
                                                        'Friend request declined.',
                                                        'Could not decline that request.'
                                                    )
                                                }
                                                className="text-sw-neg"
                                            >
                                                <X size={14} />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {outgoing.length > 0 && (
                            <>
                                <div className="text-[11px] uppercase tracking-[0.09em] text-sw-dim mb-2">
                                    Sent by you
                                </div>
                                <div className="flex flex-col gap-2">
                                    {outgoing.map((request) => (
                                        <div
                                            key={request.id}
                                            className="flex items-center gap-3 p-3 rounded-sw-row bg-sw-sunk"
                                        >
                                            <Avatar name={request.to_user_name} size={32} />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm truncate">
                                                    {request.to_user_name}
                                                </div>
                                                <div className="text-[11.5px] text-sw-dim truncate">
                                                    Waiting for a reply
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                onClick={() =>
                                                    respondToRequest(
                                                        api.friends.cancelRequest,
                                                        request.id,
                                                        'Friend request cancelled.',
                                                        'Could not cancel that request.'
                                                    )
                                                }
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </Card>
                )}

                {/* ------------------------------------------------- password */}
                <Card radius="lg" className="p-[18px]">
                    <h2 className="text-[15px] font-medium mb-3.5">Password</h2>

                    <form onSubmit={handlePasswordChange} className="flex flex-col gap-3.5">
                        <Field
                            label="Current password"
                            type={showPasswords ? 'text' : 'password'}
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                            trailing={
                                <button
                                    type="button"
                                    onClick={() => setShowPasswords((shown) => !shown)}
                                    aria-label={
                                        showPasswords ? 'Hide passwords' : 'Show passwords'
                                    }
                                    className="p-1 text-sw-dim hover:text-sw-text focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2"
                                >
                                    {showPasswords ? (
                                        <EyeSlash size={16} />
                                    ) : (
                                        <Eye size={16} />
                                    )}
                                </button>
                            }
                        />
                        <Field
                            label="New password"
                            type={showPasswords ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                            required
                            hint="At least 8 characters."
                        />
                        <Field
                            label="Confirm new password"
                            type={showPasswords ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            autoComplete="new-password"
                            required
                        />

                        {passwordFeedback && (
                            <Notice tone={passwordFeedback.tone}>
                                {passwordFeedback.message}
                            </Notice>
                        )}

                        <Button
                            type="submit"
                            variant="primary"
                            disabled={savingPassword}
                            className="self-start min-h-[42px]"
                        >
                            {savingPassword ? 'Changing…' : 'Change password'}
                        </Button>
                    </form>

                    {/*
                      * What used to be a whole "Security information" card. Two
                      * read-only dates do not need their own heading.
                      */}
                    <div className="mt-4 pt-3.5 border-t border-sw-line flex flex-col gap-1">
                        <div className="flex justify-between text-[12px] text-sw-dim">
                            <span>Last signed in</span>
                            <span>{formatDate(profile?.last_login_at ?? null)}</span>
                        </div>
                        <div className="flex justify-between text-[12px] text-sw-dim">
                            <span>Password last changed</span>
                            <span>{formatDate(profile?.password_changed_at ?? null)}</span>
                        </div>
                    </div>
                </Card>
            </div>
        </>
    );
};

export default AccountSettingsPage;
