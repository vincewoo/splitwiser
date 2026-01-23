import { GoogleLogin, type CredentialResponse } from '@react-oauth/google';
import { useState } from 'react';
import { getApiUrl } from '../../api';

interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  is_new_user: boolean;
  claimed_group_id?: number;
  account_linked: boolean;
}

interface GoogleSignInButtonProps {
  onSuccess: (response: GoogleAuthResponse) => void;
  onError: (error: string) => void;
  claimGuestId?: number;
  shareLinkId?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onSuccess,
  onError,
  claimGuestId,
  shareLinkId,
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      onError('No credential received from Google');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(getApiUrl('auth/google/authenticate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id_token: credentialResponse.credential,
          claim_guest_id: claimGuestId,
          share_link_id: shareLinkId,
        }),
      });

      if (!response.ok) {
        // Try to parse error as JSON, fall back to status text
        let errorMessage = 'Google authentication failed';
        try {
          const error = await response.json();
          errorMessage = error.detail || errorMessage;
        } catch {
          // Response wasn't JSON (e.g., HTML error page from proxy)
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const text = await response.text();
      let data: GoogleAuthResponse;
      try {
        data = JSON.parse(text);
      } catch {
        console.error('Failed to parse response as JSON:', text.substring(0, 500));
        throw new Error('Invalid response from server');
      }
      onSuccess(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Google authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full flex justify-center py-2">
        <svg
          className="animate-spin h-6 w-6 text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
    );
  }

  return (
    <div className="w-full flex justify-center">
      <GoogleLogin
        onSuccess={handleGoogleSuccess}
        onError={() => onError('Google Sign-In was cancelled')}
        text="continue_with"
        shape="rectangular"
        theme="outline"
        size="large"
        width="300"
      />
    </div>
  );
};
