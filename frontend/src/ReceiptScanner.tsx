import React, { useState } from 'react';
import Tesseract from 'tesseract.js';

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
        try {
            const result = await Tesseract.recognize(
                image,
                'eng',
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            setProgress(Math.floor(m.progress * 100));
                        }
                    }
                }
            );

            const text = result.data.text;
            console.log("OCR Text:", text);
            const items = parseReceiptText(text);
            onItemsDetected(items);
        } catch (error) {
            console.error(error);
            alert("Failed to scan receipt");
        } finally {
            setLoading(false);
        }
    };

    const parseReceiptText = (text: string) => {
        // Very basic parser. Looks for lines with a price at the end.
        // E.g. "Burger 10.99"
        const lines = text.split('\n');
        const items: { description: string, price: number }[] = [];

        const priceRegex = /(\d+\.\d{2})/; // Simple regex for prices

        for (const line of lines) {
            const match = line.match(priceRegex);
            if (match) {
                const priceVal = parseFloat(match[0]);
                // Basic cleanup of description
                const description = line.replace(match[0], '').trim();
                if (description && priceVal > 0) {
                     items.push({ description, price: priceVal * 100 }); // Store in cents
                }
            }
        }
        return items;
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
