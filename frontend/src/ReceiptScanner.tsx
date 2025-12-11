import React, { useState } from 'react';

interface ReceiptScannerProps {
    onItemsDetected: (items: { description: string, price: number }[]) => void;
    onClose: () => void;
}

const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ onItemsDetected, onClose }) => {
    const [image, setImage] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setImage(e.target.files[0]);
        }
    };

    const processImage = async () => {
        if (!image) return;

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

            const response = await fetch('http://localhost:8000/ocr/scan-receipt', {
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

            onItemsDetected(data.items);

        } catch (error: any) {
            console.error(error);
            alert(`Failed to scan receipt: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white p-5 rounded-lg shadow-xl w-96">
                <h2 className="text-xl font-bold mb-4">Scan Receipt</h2>

                <div className="mb-4">
                    <input type="file" accept="image/*" onChange={handleImageChange} className="mb-2 w-full" />
                    {image && (
                        <div className="text-sm text-gray-500 mb-2">Selected: {image.name}</div>
                    )}
                </div>

                {loading && (
                    <div className="mb-4">
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div className="bg-teal-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="text-xs text-center mt-1">Processing... {progress}%</p>
                    </div>
                )}

                <div className="flex justify-end space-x-3">
                     <button onClick={onClose} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded">Cancel</button>
                     <button
                        onClick={processImage}
                        disabled={!image || loading}
                        className={`px-4 py-2 text-white rounded ${!image || loading ? 'bg-gray-300' : 'bg-teal-500 hover:bg-teal-600'}`}
                    >
                        Scan
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReceiptScanner;
