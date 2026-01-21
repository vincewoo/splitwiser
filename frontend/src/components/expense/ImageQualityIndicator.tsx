import React from 'react';

interface ImageQualityIndicatorProps {
  score: number; // 0-100
  issues: string[];
  recommendations: string[];
  isAnalyzing?: boolean;
}

const ImageQualityIndicator: React.FC<ImageQualityIndicatorProps> = ({
  score,
  issues,
  recommendations,
  isAnalyzing = false
}) => {
  const getScoreColor = () => {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreBgColor = () => {
    if (score >= 80) return 'bg-green-100 dark:bg-green-900/30';
    if (score >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  };

  const getScoreLabel = () => {
    if (score >= 80) return 'Good';
    if (score >= 50) return 'Fair';
    return 'Poor';
  };

  const getProgressColor = () => {
    if (score >= 80) return 'bg-green-500 dark:bg-green-400';
    if (score >= 50) return 'bg-yellow-500 dark:bg-yellow-400';
    return 'bg-red-500 dark:bg-red-400';
  };

  if (isAnalyzing) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 mb-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span className="text-sm">Analyzing image quality...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg p-3 mb-4 ${getScoreBgColor()}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Image Quality:</span>
          <span className={`text-sm font-bold ${getScoreColor()}`}>
            {getScoreLabel()} ({score}%)
          </span>
        </div>
        {score >= 80 && (
          <svg className="w-5 h-5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-2">
        <div
          className={`h-1.5 rounded-full transition-all ${getProgressColor()}`}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="mt-2">
          {issues.map((issue, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 text-yellow-500 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{issue}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="mt-2">
          {recommendations.map((rec, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400">
              <svg className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{rec}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ImageQualityIndicator;
