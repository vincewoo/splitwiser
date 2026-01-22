import type { Participant, ItemAssignment } from '../types/expense';

/**
 * Generate a unique key for a participant (user or guest)
 */
export const getParticipantKey = (participant: Participant): string => {
    return participant.isGuest ? `guest_${participant.id}` : `user_${participant.id}`;
};

/**
 * Get display name for a participant
 */
export const getParticipantName = (participant: Participant, currentUserId?: number): string => {
    if (!participant.isGuest && currentUserId && participant.id === currentUserId) {
        return "You";
    }
    return participant.name;
};

/**
 * Determine if compact mode should be used based on participant count
 */
export const shouldUseCompactMode = (participants: Participant[]): boolean => {
    return participants.length > 5;
};

/**
 * Sort participants with current user first, then alphabetically by name
 */
export const sortParticipants = (participants: Participant[], currentUserId?: number): Participant[] => {
    return [...participants].sort((a, b) => {
        // Current user always comes first
        const aIsCurrentUser = !a.isGuest && currentUserId && a.id === currentUserId;
        const bIsCurrentUser = !b.isGuest && currentUserId && b.id === currentUserId;

        if (aIsCurrentUser && !bIsCurrentUser) return -1;
        if (!aIsCurrentUser && bIsCurrentUser) return 1;

        // Otherwise, sort alphabetically by name
        return a.name.localeCompare(b.name);
    });
};

/**
 * Get display text for item assignments
 */
export const getAssignmentDisplayText = (
    assignments: ItemAssignment[],
    allParticipants: Participant[],
    currentUserId?: number
): string => {
    if (assignments.length === 0) {
        return '⚠️ Unclaimed';
    }

    if (assignments.length === allParticipants.length) {
        return `All ${allParticipants.length} people`;
    }

    const names = assignments.map(a => {
        const p = allParticipants.find(p => p.id === a.user_id && p.isGuest === a.is_guest);
        return p ? getParticipantName(p, currentUserId) : '';
    }).filter(n => n);

    if (names.length <= 2) {
        return names.join(', ');
    }

    return `${names[0]}, ${names[1]} +${names.length - 2} more`;
};
