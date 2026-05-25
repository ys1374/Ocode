import { RS } from './reed-solomon';

export type EccLevel = 'L' | 'M' | 'Q' | 'H';

export const ECC_RATIOS = {
    'L': 0.14, // 7% capacity
    'M': 0.30, // 15% capacity
    'Q': 0.50, // 25% capacity
    'H': 0.60  // 30% capacity
};

export function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

export function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
    let start = polarToCartesian(x, y, radius, startAngle);
    let end = polarToCartesian(x, y, radius, endAngle);
    let largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

export function generateOcodeData(text: string, eccLevel: EccLevel = 'M') {
    const bytes = Array.from(new TextEncoder().encode(text));
    const ratio = ECC_RATIOS[eccLevel];
    
    let r = 85;
    let capacityBits = 0;
    const requiredDataBytes = bytes.length + 3; // 2 byte len + 1 byte magic + text
    const minRequiredTotalBytes = Math.ceil(requiredDataBytes / (1 - ratio));
    const minRequiredBits = minRequiredTotalBytes * 8;

    // Minimum size restriction lowered to r <= 117 to prevent huge gaps for short text (creates up to 3 rings minimum)
    while (capacityBits < minRequiredBits || r <= 117) {
        capacityBits += Math.floor((2 * Math.PI * r) / 14);
        r += 16;
    }
    
    const maxDataRadius = r - 16;
    const totalSize = (maxDataRadius + 50) * 2;
    const center = totalSize / 2;

    const totalSymbolBytes = Math.floor(capacityBits / 8);
    const eccLen = Math.floor(totalSymbolBytes * ratio);
    const dataLen = totalSymbolBytes - eccLen;

    let dataBytes = new Uint8Array(dataLen);
    dataBytes[0] = bytes.length >> 8;
    dataBytes[1] = bytes.length & 255;
    dataBytes[2] = 0x4F; // 'O' magic byte to help scanner identify the correct ECC ratio
    dataBytes.set(bytes, 3);

    // --- GAP FILLING ---
    // Fill remaining data bytes with QR-style alternating padding to prevent empty 0x00 spaces
    // between the inner data rings and the outer ECC rings. (0xEC = 11101100, 0x11 = 00010001)
    const padPairs = [0xEC, 0x11];
    for (let i = 3 + bytes.length; i < dataLen; i++) {
        dataBytes[i] = padPairs[(i - (3 + bytes.length)) % 2];
    }

    const eccBytes = RS.encode(dataBytes, eccLen);
    const fullPayload = [...dataBytes, ...eccBytes];

    let bits: number[] = [];
    for (let b of fullPayload) {
        for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    }

    let svgContent = '';
    
    // Zone 1: Bullseye
    svgContent += `<circle cx="${center}" cy="${center}" r="45" fill="black" />`;
    svgContent += `<circle cx="${center}" cy="${center}" r="32" fill="white" />`;
    svgContent += `<circle cx="${center}" cy="${center}" r="18" fill="black" />`;

    // Zone 2: Timing Ring (Clean Dashed)
    for (let i = 0; i < 36; i++) {
        if (i % 2 === 0) {
            const angle = (i * 2 * Math.PI) / 36;
            const pt = polarToCartesian(center, center, 65, angle);
            svgContent += `<circle cx="${pt.x}" cy="${pt.y}" r="5" fill="black" />`;
        }
    }

    // Zone 3: Continuous Data Arcs
    let bitIndex = 0;
    let currentR = 85; 
    
    while (currentR <= maxDataRadius) {
        const maxDots = Math.floor((2 * Math.PI * currentR) / 14);
        let ringBits: number[] = [];
        for (let i = 0; i < maxDots; i++) {
            ringBits.push(bitIndex < bits.length ? bits[bitIndex] : i % 2);
            bitIndex++;
        }

        let allOnes = ringBits.every(b => b === 1);
        if (allOnes) {
            svgContent += `<circle cx="${center}" cy="${center}" r="${currentR}" fill="none" stroke="black" stroke-width="10" />`;
        } else {
            let offset = ringBits.indexOf(0); 
            if(offset === -1) offset = 0;
            let inSegment = false;
            let startIdx = 0;

            for (let i = 0; i <= maxDots; i++) {
                let actualIdx = (i + offset) % maxDots;
                let bit = (i === maxDots) ? 0 : ringBits[actualIdx]; 

                if (bit === 1 && !inSegment) {
                    inSegment = true;
                    startIdx = i;
                } else if (bit === 0 && inSegment) {
                    inSegment = false;
                    let endIdx = i - 1;
                    let sweepCount = endIdx - startIdx;
                    let actualStartAngle = ((startIdx + offset) % maxDots) * (2 * Math.PI) / maxDots;
                    let actualEndAngle = actualStartAngle + (sweepCount * (2 * Math.PI) / maxDots);

                    if (sweepCount === 0) {
                        let pt = polarToCartesian(center, center, currentR, actualStartAngle);
                        svgContent += `<circle cx="${pt.x}" cy="${pt.y}" r="5" fill="black" />`;
                    } else {
                        svgContent += `<path d="${describeArc(center, center, currentR, actualStartAngle, actualEndAngle)}" fill="none" stroke="black" stroke-width="10" stroke-linecap="round" />`;
                    }
                }
            }
        }
        currentR += 16;
    }

    const containerR = maxDataRadius + 16;
    const gapAngle = 32 / containerR; // Increased gap for camera visibility
    const arcStart = -Math.PI / 2 + gapAngle;
    const arcEnd = 3 * Math.PI / 2 - gapAngle;
    svgContent += `<path d="${describeArc(center, center, containerR, arcStart, arcEnd)}" fill="none" stroke="black" stroke-width="10" stroke-linecap="round" />`;
    svgContent += `<circle cx="${center}" cy="${center - containerR}" r="5" fill="black" />`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}" style="background: white; max-width: 100%; max-height: 100%; display: block;">
        ${svgContent}
    </svg>`;
    
    return { svg, totalSize };
}

export function decodeOcodeImageData(source: HTMLImageElement | HTMLVideoElement, canvas: HTMLCanvasElement): { text: string, errors: number, success: boolean, samplePoints?: {px: number, py: number, bit: number}[], errorMessage?: string } {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { text: "", errors: 0, success: false, errorMessage: "No canvas context" };
    
    if (source instanceof HTMLImageElement) {
        canvas.width = source.width || source.naturalWidth;
        canvas.height = source.height || source.naturalHeight;
        if (canvas.width === 0 || canvas.height === 0) return { text: "", errors: 0, success: false, errorMessage: "Invalid source dimensions" };
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    } else {
        const size = Math.min(source.videoWidth, source.videoHeight);
        if (size === 0) return { text: "", errors: 0, success: false, errorMessage: "Invalid source dimensions" };
        const processSize = Math.min(size, 600); // Scale down video for performance
        canvas.width = processSize;
        canvas.height = processSize;
        const sx = (source.videoWidth - size) / 2;
        const sy = (source.videoHeight - size) / 2;
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, processSize, processSize);
        ctx.drawImage(source, sx, sy, size, size, 0, 0, processSize, processSize);
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    let cx = canvas.width / 2;
    let cy = canvas.height / 2;
    let searchRadius = Math.min(canvas.width, canvas.height) / 2.5;

    // Iterative center refinement using the bullseye
    for (let iter = 0; iter < 4; iter++) {
        let sumX = 0, sumY = 0, count = 0;
        for (let y = 0; y < canvas.height; y += 4) {
            for (let x = 0; x < canvas.width; x += 4) {
                const dx = x - cx;
                const dy = y - cy;
                if (dx*dx + dy*dy < searchRadius*searchRadius) {
                    const i = (y * canvas.width + x) * 4;
                    const bright = 0.299 * imgData.data[i] + 0.587 * imgData.data[i+1] + 0.114 * imgData.data[i+2];
                    if (bright < 128) {
                        sumX += x;
                        sumY += y;
                        count++;
                    }
                }
            }
        }
        if (count > 0) {
            cx = sumX / count;
            cy = sumY / count;
        }
        searchRadius *= 0.6; // tighten search to lock onto the central black dot
    }

    // Radial histogram of dark pixels to find rings
    const radialProfile = new Float32Array(1000);
    const radialCount = new Float32Array(1000);
    for (let i = 0; i < 360; i += 2) {
        const a = i * Math.PI / 180;
        for (let r = 0; r < Math.min(800, canvas.width/2); r++) {
            const px = Math.floor(cx + r * Math.cos(a));
            const py = Math.floor(cy + r * Math.sin(a));
            if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) continue;
            const idx = (py * canvas.width + px) * 4;
            const bright = 0.299 * imgData.data[idx] + 0.587 * imgData.data[idx+1] + 0.114 * imgData.data[idx+2];
            if (bright < 128) radialProfile[r]++;
            radialCount[r]++;
        }
    }

    let containerR = 0;
    let maxDataRadius = 0;
    
    for (let n = 0; n < 30; n++) {
        const dataR = 85 + n * 16;
        const testContainerR = dataR + 16;
        if (testContainerR >= Math.min(canvas.width, canvas.height) / 2) break;
        
        if (radialCount[testContainerR] > 0) {
            const score = radialProfile[testContainerR] / radialCount[testContainerR];
            if (score > 0.70) {
                containerR = testContainerR;
                maxDataRadius = dataR;
            }
        }
    }

    if (maxDataRadius === 0 || containerR === 0) {
        return { text: "", errors: 0, success: false, errorMessage: "Could not locate Ocode geometry rings" };
    }

    let sumSin = 0, sumCos = 0;
    for(let i = 0; i < 720; i++) {
        let a = i * 2 * Math.PI / 720;
        let px = cx + containerR * Math.cos(a);
        let py = cy + containerR * Math.sin(a);
        let idx = (Math.floor(py) * canvas.width + Math.floor(px)) * 4;
        if (idx >= 0 && idx < imgData.data.length - 2) {
             let bright = 0.299 * imgData.data[idx] + 0.587 * imgData.data[idx+1] + 0.114 * imgData.data[idx+2];
             if (bright > 128) { // The gap is white, finding the centroid of the gap
                 sumSin += Math.sin(a);
                 sumCos += Math.cos(a);
             }
        }
    }
    const notchAngle = Math.atan2(sumSin, sumCos);
    const angleOffset = notchAngle + (Math.PI / 2);
    
    let extractedBits: number[] = [];
    let samplePoints: {px: number, py: number, bit: number}[] = [];
    let r = 85; 

    while(r <= maxDataRadius) {
        const maxDots = Math.floor((2 * Math.PI * r) / 14);
        for(let i = 0; i < maxDots; i++) {
            const angle = (i * 2 * Math.PI / maxDots) + angleOffset;
            const px = cx + r * Math.cos(angle);
            const py = cy + r * Math.sin(angle);
            
            const idx = (Math.floor(py) * canvas.width + Math.floor(px)) * 4;
            if (idx >= 0 && idx < imgData.data.length - 2) {
                 const bright = 0.299 * imgData.data[idx] + 0.587 * imgData.data[idx+1] + 0.114 * imgData.data[idx+2];
                 const bit = bright < 128 ? 1 : 0;
                 extractedBits.push(bit);
                 samplePoints.push({px, py, bit});
            } else {
                 extractedBits.push(0); 
            }
        }
        r += 16;
    }

    const totalSymbolBytes = Math.floor(extractedBits.length / 8);

    let receivedBytes: number[] = [];
    for (let i = 0; i < totalSymbolBytes * 8; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | extractedBits[i + j];
        receivedBytes.push(byte);
    }

    let decodedText = "";
    let found = false;
    let errorsFound = 0;

    const ratios = Object.values(ECC_RATIOS).sort((a, b) => b - a); // Try highest ECC first

    for (let ratio of ratios) {
        const eccLen = Math.floor(totalSymbolBytes * ratio);
        try {
            const result = RS.decode(receivedBytes, eccLen);
            const repairedBytes = result.repaired;
            
            if (repairedBytes[2] === 0x4F) {
                const textLength = (repairedBytes[0] << 8) | repairedBytes[1];
                if (textLength <= repairedBytes.length - 3 && textLength > 0) {
                     const textBytes = new Uint8Array(repairedBytes.slice(3, 3 + textLength));
                     decodedText = new TextDecoder().decode(textBytes);
                     errorsFound = result.errors;
                     found = true;
                     break;
                }
            }
        } catch (e) {
            // Error is expected for wrong ECC ratios, attempt next
        }
    }

    if (!found) {
        return { text: "", errors: 0, success: false, errorMessage: "Failed to decode (checksum mismatch or too corrupted)" };
    }

    return {
       text: decodedText,
       errors: errorsFound,
       success: true,
       samplePoints
    };
}
