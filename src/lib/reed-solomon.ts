export const RS = {
    exp: new Uint8Array(512), 
    log: new Uint8Array(256),
    init() {
        let x = 1;
        for (let i = 0; i < 255; i++) {
            this.exp[i] = x; this.exp[i + 255] = x;
            this.log[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11D;
        }
        this.log[0] = 0;
    },
    mul(x: number, y: number) { return (x === 0 || y === 0) ? 0 : this.exp[this.log[x] + this.log[y]]; },
    div(x: number, y: number) { return x === 0 ? 0 : this.exp[((this.log[x] - this.log[y]) + 255) % 255]; },
    polyMul(p1: Uint8Array, p2: Uint8Array) {
        let r = new Uint8Array(p1.length + p2.length - 1);
        for (let i = 0; i < p1.length; i++) for (let j = 0; j < p2.length; j++) r[i + j] ^= this.mul(p1[i], p2[j]);
        return r;
    },
    polyEval(p: Uint8Array, x: number) {
        let y = p[0];
        for (let i = 1; i < p.length; i++) y = this.mul(y, x) ^ p[i];
        return y;
    },
    polyEvalReverse(p: Uint8Array, x: number) {
        let y = 0;
        for (let i = p.length - 1; i >= 0; i--) y = this.mul(y, x) ^ p[i];
        return y;
    },
    encode(msgBytes: Uint8Array, eccLen: number) {
        let g = new Uint8Array([1]);
        for (let i = 0; i < eccLen; i++) g = this.polyMul(g, new Uint8Array([1, this.exp[i]]));
        let padded = new Uint8Array(msgBytes.length + eccLen);
        padded.set(msgBytes);
        for (let i = 0; i < msgBytes.length; i++) {
            let coef = padded[i];
            if (coef !== 0) for (let j = 1; j < g.length; j++) padded[i + j] ^= this.mul(g[j], coef);
        }
        return padded.slice(msgBytes.length); 
    },
    decode(msgWithEcc: number[], eccLen: number) {
        let syn = new Uint8Array(eccLen);
        let hasError = false;
        let msgWithEccU = new Uint8Array(msgWithEcc);
        for (let i = 0; i < eccLen; i++) {
            syn[i] = this.polyEval(msgWithEccU, this.exp[i]);
            if (syn[i] !== 0) hasError = true;
        }
        if (!hasError) return { repaired: msgWithEccU.slice(0, msgWithEcc.length - eccLen), errors: 0 };

        let L = 0, m = 1, b = 1;
        let sigma = new Uint8Array([1]), oldSigma = new Uint8Array([1]);
        for (let i = 0; i < eccLen; i++) {
            let d = syn[i];
            for (let j = 1; j <= L; j++) d ^= this.mul(sigma[j] || 0, syn[i - j]);
            if (d !== 0) {
                let shift = new Uint8Array(oldSigma.length + m);
                let factor = this.mul(d, this.div(1, b));
                for(let j=0; j<oldSigma.length; j++) shift[j+m] = this.mul(oldSigma[j], factor);
                let temp = new Uint8Array(Math.max(sigma.length, shift.length));
                temp.set(sigma);
                for(let j=0; j<shift.length; j++) temp[j] ^= shift[j];
                if (2 * L <= i) { L = i + 1 - L; oldSigma = sigma; b = d; m = 1; } else m++;
                sigma = temp;
            } else m++;
        }

        let errPos: number[] = [];
        for (let i = 1; i < 256; i++) {
            if (this.polyEvalReverse(sigma, i) === 0) {
                let posRight = this.log[this.div(1, i)];
                if (posRight < msgWithEcc.length) {
                     errPos.push(msgWithEcc.length - 1 - posRight);
                }
            }
        }
        
        if (errPos.length !== L) throw new Error("Uncorrectable");

        let omega = this.polyMul(syn, sigma).slice(0, eccLen);
        let sigmaDeriv = new Uint8Array(sigma.length - 1);
        for (let i = 1; i < sigma.length; i += 2) sigmaDeriv[(i - 1)] = sigma[i];
        
        let corrected = new Uint8Array(msgWithEcc);
        for (let pos of errPos) {
            let posRight = msgWithEcc.length - 1 - pos;
            let xInv = this.exp[255 - posRight];
            let num = this.polyEvalReverse(omega, xInv);
            let den = this.polyEvalReverse(sigmaDeriv, xInv);
            let mag = this.mul(num, this.div(1, den));
            mag = this.mul(mag, this.exp[posRight]); // Multiply by X_k
            corrected[pos] ^= mag; 
        }
        return { repaired: corrected.slice(0, msgWithEcc.length - eccLen), errors: errPos.length };
    }
};

RS.init();
