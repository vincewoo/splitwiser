import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePageTitle } from './hooks/usePageTitle';
import { api } from './services/api';

const VerifyEmailPage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  usePageTitle('Verify Email');

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setError('Invalid verification link');
        setIsLoading(false);
        return;
      }

      try {
        await api.profile.verifyEmail(token);
        setIsSuccess(true);

        // Redirect to account settings after 3 seconds
        setTimeout(() => {
          navigate('/account');
        }, 3000);
      } catch (err: any) {
        setError(err.message || 'Failed to verify email. The link may have expired.');
      } finally {
        setIsLoading(false);
      }
    };

    verifyEmail();
  }, [token, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-gray-800 rounded shadow dark:shadow-gray-900/50">
          <div className="text-center">
            <svg
              className="animate-spin mx-auto h-12 w-12 text-indigo-600 dark:text-indigo-400"
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
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
              Verifying your email...
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Please wait while we verify your email address.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-gray-800 rounded shadow dark:shadow-gray-900/50">
          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
              Email verified successfully
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Your email address has been updated.
            </p>
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              Redirecting to account settings...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-gray-800 rounded shadow dark:shadow-gray-900/50">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            Verification failed
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {error}
          </p>
          <div className="mt-8">
            <button
              onClick={() => navigate('/account')}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800"
            >
              Go to account settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
