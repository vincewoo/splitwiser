import React, { useState } from 'react';

interface ImageEditToolbarProps {
  onRotate: (degrees: 90 | 180 | 270) => void;
  onAutoEnhance: () => void;
  onAdjust: (brightness: number, contrast: number) => void;
  onSharpen: () => void;
  onGrayscale: () => void;
  onPerspective: () => void;
  onReset: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
}

const ImageEditToolbar: React.FC<ImageEditToolbarProps> = ({
  onRotate,
  onAutoEnhance,
  onAdjust,
  onSharpen,
  onGrayscale,
  onPerspective,
  onReset,
  disabled = false,
  isProcessing = false
}) => {
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);

  const handleApplyAdjustments = () => {
    onAdjust(brightness, contrast);
    setShowAdjustPanel(false);
  };

  const handleResetSliders = () => {
    setBrightness(0);
    setContrast(0);
  };

  const buttonClass = `p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium
    ${disabled || isProcessing
      ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
    }`;

  const primaryButtonClass = `p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium
    ${disabled || isProcessing
      ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-300 dark:text-teal-700 cursor-not-allowed'
      : 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-800/40'
    }`;

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Auto Enhance - Primary action */}
        <button
          onClick={onAutoEnhance}
          disabled={disabled || isProcessing}
          className={primaryButtonClass}
          title="Automatically improve image quality for better OCR"
        >
          {isProcessing ? (
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          )}
          <span className="hidden sm:inline">Auto-Enhance</span>
        </button>

        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 hidden sm:block" />

        {/* Rotation buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onRotate(270)}
            disabled={disabled || isProcessing}
            className={buttonClass}
            title="Rotate left 90 degrees"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={() => onRotate(90)}
            disabled={disabled || isProcessing}
            className={buttonClass}
            title="Rotate right 90 degrees"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>

        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 hidden sm:block" />

        {/* Adjustment tools */}
        <button
          onClick={() => setShowAdjustPanel(!showAdjustPanel)}
          disabled={disabled || isProcessing}
          className={`${buttonClass} ${showAdjustPanel ? 'ring-2 ring-teal-500 dark:ring-teal-400' : ''}`}
          title="Adjust brightness and contrast"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <span className="hidden sm:inline">Adjust</span>
        </button>

        <button
          onClick={onSharpen}
          disabled={disabled || isProcessing}
          className={buttonClass}
          title="Sharpen blurry text"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="hidden sm:inline">Sharpen</span>
        </button>

        <button
          onClick={onGrayscale}
          disabled={disabled || isProcessing}
          className={buttonClass}
          title="Convert to grayscale (good for faded receipts)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
          <span className="hidden sm:inline">B&W</span>
        </button>

        <button
          onClick={onPerspective}
          disabled={disabled || isProcessing}
          className={buttonClass}
          title="Fix perspective for angled photos"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <span className="hidden sm:inline">Perspective</span>
        </button>

        <div className="flex-grow" />

        {/* Reset button */}
        <button
          onClick={onReset}
          disabled={disabled || isProcessing}
          className={`${buttonClass} text-orange-600 dark:text-orange-400`}
          title="Reset to original image"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="hidden sm:inline">Reset</span>
        </button>
      </div>

      {/* Brightness/Contrast adjustment panel */}
      {showAdjustPanel && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="space-y-3">
            <div>
              <label className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                <span>Brightness</span>
                <span className="font-mono">{brightness > 0 ? '+' : ''}{brightness}</span>
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                value={brightness}
                onChange={(e) => setBrightness(parseInt(e.target.value))}
                disabled={disabled || isProcessing}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
              />
            </div>
            <div>
              <label className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                <span>Contrast</span>
                <span className="font-mono">{contrast > 0 ? '+' : ''}{contrast}</span>
              </label>
              <input
                type="range"
                min="-50"
                max="50"
                value={contrast}
                onChange={(e) => setContrast(parseInt(e.target.value))}
                disabled={disabled || isProcessing}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-teal-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleResetSliders}
                disabled={disabled || isProcessing}
                className="flex-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Reset Sliders
              </button>
              <button
                onClick={handleApplyAdjustments}
                disabled={disabled || isProcessing || (brightness === 0 && contrast === 0)}
                className="flex-1 px-3 py-1.5 text-sm text-white bg-teal-500 rounded hover:bg-teal-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageEditToolbar;
