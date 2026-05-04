/**
 * Pseudonymize a user ID using SHA-256 for DSGVO-compliant analytics.
 * The hash is deterministic (same user = same hash) but non-reversible.
 * VITE_ANON_SALT must be set per deployment to prevent hash reversal if source is exposed.
 */
const SALT = import.meta.env.VITE_ANON_SALT || 'learnstation-analytics-2026';

export async function pseudonymizeId(userId: string): Promise<string> {
    const data = new TextEncoder().encode(SALT + userId);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
