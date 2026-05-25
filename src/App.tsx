import React, { useState, useEffect, useRef } from 'react';
import { generateOcodeData, decodeOcodeImageData, EccLevel, ECC_RATIOS } from './lib/ocode';

export default function App() {
    const [payload, setPayload] = useState('https://github.com/ys1374/Ocode');
    const [eccLevel, setEccLevel] = useState<EccLevel>('M');
    const [svgData, setSvgData] = useState<{ svg: string; totalSize: number } | null>(null);
    const [scanStatus, setScanStatus] = useState<{ text: string, type: 'info' | 'success' | 'error' | 'warning' } | null>(null);
    const [decodedResult, setDecodedResult] = useState('Waiting for image or camera input...');
    const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isScanning, setIsScanning] = useState(false);

    useEffect(() => {
        const timeout = setTimeout(() => {
            handleEncode();
        }, 300);
        return () => clearTimeout(timeout);
    }, [payload, eccLevel]);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (isScanning) {
            interval = setInterval(() => {
                scanVideoFrame();
            }, 500);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isScanning]);

    const startCamera = async () => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("Camera API not supported in this browser context (might need HTTPS or new tab).");
            }
            
            let stream: MediaStream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
            } catch (e) {
                // Fallback to default camera if environment is not available
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
                setIsScanning(true);
                setScanStatus({ text: 'Camera running...', type: 'info' });
                setDecodedResult('Scanning feed...');
            }
        } catch (err: any) {
            let msg = 'Camera access denied or unavailable.';
            if (err.name === 'NotAllowedError') msg = 'Camera access denied. Please grant permissions.';
            else if (err.name === 'NotFoundError') msg = 'No camera found on this device.';
            else if (err.name === 'NotReadableError' || err.message?.includes('Could not start video source')) {
                msg = 'Camera is in use by another app or could not start. Try closing other tabs using the camera.';
            } else {
                msg = `Camera error: ${err.message || err.name}`;
            }
            setScanStatus({ text: msg, type: 'error' });
            console.error("Camera error", err);
        }
    };

    const stopCamera = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            setIsScanning(false);
            setScanStatus({ text: 'Camera stopped.', type: 'info' });
            if (cameraCanvasRef.current) {
                const ctx = cameraCanvasRef.current.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, cameraCanvasRef.current.width, cameraCanvasRef.current.height);
            }
        }
    };

    const scanVideoFrame = () => {
         if (!videoRef.current || !cameraCanvasRef.current || !isScanning) return;
         const video = videoRef.current;
         if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

         try {
             const result = decodeOcodeImageData(video, cameraCanvasRef.current);
             if (result.success) {
                 setDecodedResult(result.text);
                 if (result.errors > 0) {
                     setScanStatus({ text: `Success: Recovered ${result.errors} byte(s).`, type: 'warning' });
                 } else {
                     setScanStatus({ text: "Success: Flawless scan.", type: 'success' });
                 }
                 
                 if (result.samplePoints) {
                     const ctx = cameraCanvasRef.current.getContext('2d');
                     if (ctx) {
                         result.samplePoints.forEach(pt => {
                             ctx.fillStyle = pt.bit === 1 ? '#ef4444' : '#22c55e';
                             ctx.beginPath(); 
                             ctx.arc(pt.px, pt.py, 2, 0, Math.PI*2); 
                             ctx.fill();
                         });
                     }
                 }
             } else {
                 setScanStatus({ text: "Scanning feed...", type: 'info' });
             }
         } catch (error: any) {
             console.error("Video scan error", error);
         }
    };

    const handleEncode = () => {
        try {
            const data = generateOcodeData(payload, eccLevel);
            setSvgData(data);
            
            if (cameraCanvasRef.current) {
                const ctx = cameraCanvasRef.current.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, cameraCanvasRef.current.width, cameraCanvasRef.current.height);
            }
            setDecodedResult('Waiting for image or camera input...');
            setScanStatus(null);
        } catch (e) {
            console.error("Encode error", e);
        }
    };

    const handleDownload = () => {
         if (!svgData) return;
         const parser = new DOMParser();
         const svgDoc = parser.parseFromString(svgData.svg, "image/svg+xml");
         const totalSize = parseInt(svgDoc.documentElement.getAttribute('width') || '300');

         const canvas = document.createElement('canvas');
         canvas.width = totalSize; 
         canvas.height = totalSize;
         const ctx = canvas.getContext('2d');
         if (!ctx) return;
         
         ctx.fillStyle = "white"; 
         ctx.fillRect(0, 0, canvas.width, canvas.height);

         const img = new Image();
         const svgBlob = new Blob([svgData.svg], {type: 'image/svg+xml;charset=utf-8'});
         const url = URL.createObjectURL(svgBlob);
         
         img.onload = () => {
             ctx.drawImage(img, 0, 0);
             const downloadLink = document.createElement("a");
             downloadLink.href = canvas.toDataURL("image/png");
             downloadLink.download = "ocode.png";
             document.body.appendChild(downloadLink); 
             downloadLink.click(); 
             document.body.removeChild(downloadLink);
             URL.revokeObjectURL(url);
         };
         img.src = url;
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setScanStatus({ text: 'Analyzing image...', type: 'info' });
        setDecodedResult('...');

        const img = new Image();
        img.onload = () => {
            if (!cameraCanvasRef.current) return;
            try {
                const result = decodeOcodeImageData(img, cameraCanvasRef.current);
                if (!result.success) {
                     setDecodedResult("Error: " + result.errorMessage);
                     setScanStatus({ text: "Scan Failed.", type: 'error' });
                     return;
                }

                setDecodedResult(result.text);
                if (result.errors > 0) {
                    setScanStatus({ text: `Success: Recovered ${result.errors} byte(s).`, type: 'warning' });
                } else {
                    setScanStatus({ text: "Success: Flawless scan.", type: 'success' });
                }
                
                if (result.samplePoints) {
                    const ctx = cameraCanvasRef.current.getContext('2d');
                    if (ctx) {
                        result.samplePoints.forEach(pt => {
                            ctx.fillStyle = pt.bit === 1 ? '#ef4444' : '#22c55e';
                            ctx.beginPath(); 
                            ctx.arc(pt.px, pt.py, 2, 0, Math.PI*2); 
                            ctx.fill();
                        });
                    }
                }
            } catch (error: any) {
                setDecodedResult("Error: " + error.message);
                setScanStatus({ text: "Scan Failed.", type: 'error' });
            }
        };
        img.src = URL.createObjectURL(file);
    };

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-4 sm:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex items-center justify-between border-b border-gray-200 pb-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Ocode - 2D Circular data encryption & decryption</h1>
                        <p className="text-sm text-gray-500 mt-1">Open-source continuous data arc generator and scanner</p>
                    </div>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* ENCODER PANEL */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                            <h2 className="font-semibold text-gray-800">Encoder</h2>
                            <button 
                                onClick={handleDownload}
                                className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                            >
                                Download PNG
                            </button>
                        </div>
                        <div className="p-6 flex-1 flex flex-col items-center justify-center min-h-[400px]">
                            {svgData && (
                                <div 
                                    className="bg-white p-2 rounded-lg shadow-sm border border-gray-100 mb-8"
                                    dangerouslySetInnerHTML={{ __html: svgData.svg }}
                                />
                            )}
                            <div className="w-full space-y-4 max-w-md">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Payload Data</label>
                                    <textarea 
                                        className="w-full border border-gray-300 rounded-md p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        rows={3}
                                        value={payload}
                                        maxLength={85}
                                        onChange={(e) => setPayload(e.target.value)}
                                        placeholder="Enter text or URL to encode..."
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Error Correction Level</label>
                                    <select 
                                        className="w-full border border-gray-300 bg-white rounded-md p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        value={eccLevel}
                                        onChange={(e) => setEccLevel(e.target.value as EccLevel)}
                                    >
                                        <option value="L">Level L (~7% restoration)</option>
                                        <option value="M">Level M (~15% restoration)</option>
                                        <option value="Q">Level Q (~25% restoration)</option>
                                        <option value="H">Level H (~30% restoration)</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* DECODER PANEL */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-3 items-center justify-between">
                            <h2 className="font-semibold text-gray-800">Decoded</h2>
                            <div className="flex gap-2">
                                {isScanning ? (
                                    <button 
                                        className="text-sm px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 font-medium rounded-md transition-colors"
                                        onClick={stopCamera}
                                    >
                                        Stop Camera
                                    </button>
                                ) : (
                                    <button 
                                        className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-md transition-colors"
                                        onClick={startCamera}
                                    >
                                        Start Camera
                                    </button>
                                )}
                                <label className="text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-md transition-colors cursor-pointer">
                                    <input 
                                        type="file" 
                                        className="hidden" 
                                        accept="image/png, image/jpeg" 
                                        onChange={handleImageUpload}
                                    />
                                    Upload Image
                                </label>
                            </div>
                        </div>
                        <div className="p-6 flex-1 flex flex-col items-center justify-center min-h-[400px]">
                            <div className="w-[300px] h-[300px] mb-8 bg-gray-100 rounded-lg flex items-center justify-center relative overflow-hidden border border-gray-200">
                                <video ref={videoRef} playsInline muted style={{ display: 'none' }}></video>
                                <canvas ref={cameraCanvasRef} width="300" height="300" className="max-w-full max-h-full object-contain block"></canvas>
                                {!isScanning && !cameraCanvasRef.current?.toDataURL().length && (
                                    <p className="text-gray-400 text-sm pointer-events-none absolute">Camera / Image View</p>
                                )}
                            </div>
                            
                            <div className="w-full max-w-md space-y-3">
                                {scanStatus && (
                                    <div className={`p-3 rounded-md text-sm flex items-center gap-2 ${
                                        scanStatus.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
                                        scanStatus.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                                        scanStatus.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                        'bg-blue-50 text-blue-700 border border-blue-200'
                                    }`}>
                                        <span className="font-medium">{scanStatus.text}</span>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Decoded Result</label>
                                    <div className="w-full min-h-[80px] bg-gray-50 border border-gray-200 rounded-md p-3 text-sm text-gray-800 break-words whitespace-pre-wrap">
                                        {decodedResult}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>

                <footer className="pt-8 pb-4 text-center">
                    <p className="text-sm text-gray-500 font-medium">by YSPSW</p>
                </footer>
            </div>
        </div>
    );
}

