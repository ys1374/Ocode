# Ocode - 2D Circular Data Encryption

Ocode is an open-source, continuous data arc generator and scanner. It uses pure 2D circular "arcs" rather than rigid square pixels, creating aesthetically pleasing, robust data codes that encode URLs, text, and binary data.

## Features

- **Circular Arc Generation**: Encodes data into scalable SVG-based concentric rings.
- **Configurable ECC**: Employs Reed-Solomon error correction to recover from substantial damage.
- **Fast Client-Side Scanning**: Decodes instantly in the browser from uploaded images or live camera feed without sending your data to any external backend.
- **Zero Core Dependencies**: Custom implementation of Reed-Solomon polynomial math and Galois Fields, offering maximum performance and minimum bloat.

## How It Works

1. **Message Encoding**: The payload is converted into bytes.
2. **Error Correction Framing**: The bytes are divided into fixed-size blocks. We calculate parity checks using a systematic Reed-Solomon encoder operating on Galois Field $GF(2^8)$ with prime polynomial $0x11D$. 
3. **Radial Mapping**: The combined data and ECC symbols are mapped sequentially onto polar coordinates. Starting from an inner radius, we place arcs. A `1` bit is drawn as a dark arc; a `0` bit is transparent.
4. **Scanning**: The scanner identifies the center and iteratively samples pixels along circular trajectories corresponding to the target radii, reconstructing the original bitstream.

### The Algorithm (LaTeX)

If you are writing an academic paper or technical document, you can use the following LaTeX to describe the Reed-Solomon error correction used by Ocode:

```latex
\documentclass{article}
\usepackage{amsmath}

\begin{document}

\section*{Ocode Error Correction Algorithm}

Ocode relies on systematic block coding over Galois Field $GF(2^8)$. Let the message polynomial of length $k$ be:
$$ M(x) = m_{k-1}x^{k-1} + m_{k-2}x^{k-2} + \dots + m_0 $$

We compute the generator polynomial $g(x)$ of degree $2t$ (where $t$ is the error capacity):
$$ g(x) = \prod_{i=1}^{2t} (x - \alpha^i) $$

The transmission polynomial $T(x)$ is constructed such that $T(x) \equiv 0 \pmod{g(x)}$:
$$ T(x) = M(x)x^{2t} - (M(x)x^{2t} \pmod{g(x)}) $$

During decoding, if the received polynomial $R(x)$ contains errors, we calculate the syndromes:
$$ S_i = R(\alpha^i) \quad \text{for } i \in [1, 2t] $$

If all $S_i = 0$, the payload is intact. Otherwise, the error locator polynomial is solved via the Berlekamp-Massey algorithm, and the error magnitudes are computed using the Forney algorithm after finding roots with Chien search.

\end{document}
```

## Getting Started

1. Clone the repository.
2. Run `npm install`
3. Run `npm run dev`

Visit the local server to start generating and scanning Ocodes!

## License

MIT License
