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
 * Get display text for item assignments
 */
export const getAssignmentDisplayText = (
    assignments: ItemAssignment[],
    allParticipants: Participant[],
    currentUserId?: number
): string => {
    if (assignments.length === 0) {
        return 'Unassigned';
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
