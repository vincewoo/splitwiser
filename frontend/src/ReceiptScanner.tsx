import React, { useState } from 'react';
import { getApiUrl } from './api';
import AlertDialog from './components/AlertDialog';
import { useSync } from './contexts/SyncContext';

interface ReceiptScannerProps {
    onItemsDetected: (items: { description: string, price: number }[], receiptPath?: string, validationWarning?: string | null) => void;
    onClose: () => void;
}

const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ onItemsDetected, onClose }) => {
    const { isOnline } = useSync();
    const [image, setImage] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [alertDialog, setAlertDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'alert' | 'confirm' | 'success' | 'error';
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'alert'
    });

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setImage(e.target.files[0]);
        }
    };

    const processImage = async () => {
        if (!image) return;

        // Check if user is offline
        if (!isOnline) {
            setAlertDialog({
                isOpen: true,
                title: 'No Internet Connection',
                message: 'Receipt scanning requires an internet connection. Please check your connection and try again.',
                type: 'error'
            });
            return;
        }

        setLoading(true);
        setProgress(0);

        try {
            const formData = new FormData();
            formData.append('file', image);

            const token = localStorage.getItem('token');

            // Simulate progress (since backend doesn't provide real-time updates)
            const progressInterval = setInterval(() => {
                setProgress(prev => Math.min(prev + 10, 90));
            }, 300);

            const response = await fetch(getApiUrl('ocr/scan-receipt'), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            clearInterval(progressInterval);
            setProgress(100);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'OCR processing failed');
            }

            const data = await response.json();
            console.log("OCR Response:", data);

            onItemsDetected(data.items, data.receipt_image_path, data.validation_warning);

        } catch (error: any) {
            console.error(error);
            setAlertDialog({
                isOpen: true,
                title: 'Scan Failed',
                message: `Failed to scan receipt: ${error.message}`,
                type: 'error'
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl dark:shadow-gray-900/50 w-full max-w-md">
                <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Scan Receipt</h2>

                {!isOnline && (
                    <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            ⚠️ You are currently offline. Receipt scanning requires an internet connection. Please check your connection and try again.
                        </p>
                    </div>
                )}

                <div className="mb-4">
                    <label className="block w-full">
                        <span className="sr-only">Choose receipt</span>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            className="block w-full text-sm text-gray-500 dark:text-gray-400
                                file:mr-4 file:py-2 file:px-4
                                file:rounded-full file:border-0
                                file:text-sm file:font-semibold
                                file:bg-teal-50 file:text-teal-700
                                hover:file:bg-teal-100
                                dark:file:bg-teal-900/30 dark:file:text-teal-300
                                cursor-pointer file:cursor-pointer"
                        />
                    </label>
                    {image && (
                        <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">Selected: {image.name}</div>
                    )}
                </div>

                {loading && (
                    <div className="mb-4">
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                            <div className="bg-teal-600 dark:bg-teal-500 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="text-xs text-center mt-1 dark:text-gray-300">Processing... {progress}%</p>
                    </div>
                )}

                <div className="flex justify-end space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>
                    <button
                        onClick={processImage}
                        disabled={!image || loading || !isOnline}
                        className={`px-4 py-2 text-white rounded ${!image || loading || !isOnline ? 'bg-gray-300 dark:bg-gray-600' : 'bg-teal-500 hover:bg-teal-600'}`}
                    >
                        {!isOnline ? 'Offline' : 'Scan'}
                    </button>
                </div>
            </div>

            {/* Alert Dialog */}
            <AlertDialog
                isOpen={alertDialog.isOpen}
                onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
                title={alertDialog.title}
                message={alertDialog.message}
                type={alertDialog.type}
            />
        </div>
    );
};

export default ReceiptScanner;
