export interface BwGrid {
	mode: 'bw';
	cols: number;
	rows: number;
	pixels: Uint8Array; // 0=black, 255=white
}

export interface ColorGrid {
	mode: 'color';
	cols: number;
	rows: number;
	pixels: Uint8Array; // palette indices
	palette: readonly [number, number, number][];
	counts: number[];
}

export type ProcessedGrid = BwGrid | ColorGrid;

export interface ProcessOptions {
	cols: number;
	rows: number;
	blockSize: number;
	mode: 'bw' | 'color';
	threshold?: number; // 0–255
	edgeStrength?: number; // 0–1
	numColors?: number; // 2–24
	brightness?: number; // -100..100, default 0
	contrast?: number;   // -100..100, default 0
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function applyBlockAvg(
	src: Uint8ClampedArray,
	w: number,
	h: number,
	bs: number
): Uint8ClampedArray {
	const dst = new Uint8ClampedArray(src.length);
	for (let by = 0; by < h; by += bs) {
		for (let bx = 0; bx < w; bx += bs) {
			let r = 0,
				g = 0,
				b = 0,
				n = 0;
			for (let dy = 0; dy < bs && by + dy < h; dy++) {
				for (let dx = 0; dx < bs && bx + dx < w; dx++) {
					const i = ((by + dy) * w + (bx + dx)) * 4;
					r += src[i];
					g += src[i + 1];
					b += src[i + 2];
					n++;
				}
			}
			r = (r / n) | 0;
			g = (g / n) | 0;
			b = (b / n) | 0;
			for (let dy = 0; dy < bs && by + dy < h; dy++) {
				for (let dx = 0; dx < bs && bx + dx < w; dx++) {
					const i = ((by + dy) * w + (bx + dx)) * 4;
					dst[i] = r;
					dst[i + 1] = g;
					dst[i + 2] = b;
					dst[i + 3] = 255;
				}
			}
		}
	}
	return dst;
}

function toGray(src: Uint8ClampedArray, n: number): Float32Array {
	const gray = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * 4;
		gray[i] = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
	}
	return gray;
}

function sobel(gray: Float32Array, w: number, h: number): Float32Array {
	const out = new Float32Array(gray.length);
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const tl = gray[(y - 1) * w + (x - 1)],
				tc = gray[(y - 1) * w + x],
				tr = gray[(y - 1) * w + (x + 1)];
			const ml = gray[y * w + (x - 1)],
				mr = gray[y * w + (x + 1)];
			const bl = gray[(y + 1) * w + (x - 1)],
				bc = gray[(y + 1) * w + x],
				br = gray[(y + 1) * w + (x + 1)];
			const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
			const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
			out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
		}
	}
	return out;
}

function colorDist(
	a: [number, number, number],
	b: [number, number, number]
): number {
	const dr = a[0] - b[0],
		dg = a[1] - b[1],
		db = a[2] - b[2];
	return dr * dr + dg * dg + db * db;
}

function kmeansQuantize(
	src: Uint8ClampedArray,
	n: number,
	k: number
): { labels: Uint8Array; centers: [number, number, number][]; counts: number[] } {
	const sampleN = Math.min(n, 8000);
	const step = n / sampleN;
	const sample: [number, number, number][] = [];
	for (let i = 0; i < sampleN; i++) {
		const o = ((i * step) | 0) * 4;
		sample.push([src[o], src[o + 1], src[o + 2]]);
	}

	// k-means++ init
	const centers: [number, number, number][] = [];
	centers.push([...sample[Math.floor(Math.random() * sampleN)]] as [
		number,
		number,
		number
	]);
	for (let c = 1; c < k; c++) {
		const dists = sample.map((p) => {
			let md = Infinity;
			for (const cen of centers) {
				const d = colorDist(p, cen);
				if (d < md) md = d;
			}
			return md;
		});
		const total = dists.reduce((a, b) => a + b, 0);
		let r = Math.random() * total,
			sel = 0;
		for (let i = 0; i < sampleN; i++) {
			r -= dists[i];
			if (r <= 0) {
				sel = i;
				break;
			}
		}
		centers.push([...sample[sel]] as [number, number, number]);
	}

	// Iterate on sample
	const sl = new Uint8Array(sampleN);
	for (let iter = 0; iter < 25; iter++) {
		let changed = false;
		for (let i = 0; i < sampleN; i++) {
			let md = Infinity,
				lbl = 0;
			for (let c = 0; c < k; c++) {
				const d = colorDist(sample[i], centers[c]);
				if (d < md) {
					md = d;
					lbl = c;
				}
			}
			if (sl[i] !== lbl) {
				sl[i] = lbl;
				changed = true;
			}
		}
		if (!changed) break;
		for (let c = 0; c < k; c++) {
			let sr = 0,
				sg = 0,
				sb = 0,
				cnt = 0;
			for (let i = 0; i < sampleN; i++) {
				if (sl[i] === c) {
					sr += sample[i][0];
					sg += sample[i][1];
					sb += sample[i][2];
					cnt++;
				}
			}
			if (cnt > 0) centers[c] = [(sr / cnt) | 0, (sg / cnt) | 0, (sb / cnt) | 0];
		}
	}

	// Assign all pixels
	const labels = new Uint8Array(n);
	const counts = new Array<number>(k).fill(0);
	for (let i = 0; i < n; i++) {
		const o = i * 4;
		const p: [number, number, number] = [src[o], src[o + 1], src[o + 2]];
		let md = Infinity,
			lbl = 0;
		for (let c = 0; c < k; c++) {
			const d = colorDist(p, centers[c]);
			if (d < md) {
				md = d;
				lbl = c;
			}
		}
		labels[i] = lbl;
		counts[lbl]++;
	}

	return { labels, centers, counts };
}

function applyBrightnessContrast(
	src: Uint8ClampedArray,
	n: number,
	brightness: number,
	contrast: number
): Uint8ClampedArray {
	if (brightness === 0 && contrast === 0) return src;
	const dst = new Uint8ClampedArray(src.length);
	const cv = contrast * 2.55;
	const factor = (259 * (cv + 255)) / (255 * (259 - cv));
	for (let i = 0; i < n * 4; i += 4) {
		for (let ch = 0; ch < 3; ch++) {
			let v = src[i + ch] + brightness;
			v = factor * (v - 128) + 128;
			dst[i + ch] = Math.max(0, Math.min(255, v)) | 0;
		}
		dst[i + 3] = src[i + 3];
	}
	return dst;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function processImage(img: HTMLImageElement, opts: ProcessOptions): ProcessedGrid {
	const { cols, rows, blockSize, mode } = opts;

	const off = document.createElement('canvas');
	off.width = cols;
	off.height = rows;
	const ctx = off.getContext('2d', { willReadFrequently: true })!;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(img, 0, 0, cols, rows);
	const id = ctx.getImageData(0, 0, cols, rows);

	const src = blockSize > 1 ? applyBlockAvg(id.data, cols, rows, blockSize) : id.data;
	const n = cols * rows;
	const bri = opts.brightness ?? 0;
	const con = opts.contrast ?? 0;
	const adjusted = applyBrightnessContrast(src, n, bri, con);

	if (mode === 'bw') {
		const thr = opts.threshold ?? 128;
		const es = opts.edgeStrength ?? 0;
		const gray = toGray(adjusted, n);
		const edges = sobel(gray, cols, rows);

		let maxEdge = 0;
		for (let i = 0; i < n; i++) if (edges[i] > maxEdge) maxEdge = edges[i];

		const edgeThrNorm = (1 - es) * 255;
		const pixels = new Uint8Array(n);
		for (let i = 0; i < n; i++) {
			const ne = maxEdge > 0 ? (edges[i] / maxEdge) * 255 : 0;
			pixels[i] = es > 0 && ne >= edgeThrNorm ? 0 : gray[i] < thr ? 0 : 255;
		}
		return { mode: 'bw', cols, rows, pixels };
	} else {
		const k = Math.max(2, Math.min(24, opts.numColors ?? 8));
		const { labels, centers, counts } = kmeansQuantize(adjusted, n, k);
		return { mode: 'color', cols, rows, pixels: labels, palette: centers, counts };
	}
}

export function renderToCanvas(canvas: HTMLCanvasElement, grid: ProcessedGrid): void {
	const { cols, rows } = grid;

	// Build 1px-per-cell image then scale up (fast + pixelated)
	const small = document.createElement('canvas');
	small.width = cols;
	small.height = rows;
	const sCtx = small.getContext('2d')!;
	const id = sCtx.createImageData(cols, rows);
	const d = id.data;

	for (let i = 0; i < cols * rows; i++) {
		let r: number, g: number, b: number;
		if (grid.mode === 'bw') {
			r = g = b = grid.pixels[i];
		} else {
			[r, g, b] = grid.palette[grid.pixels[i]];
		}
		d[i * 4] = r;
		d[i * 4 + 1] = g;
		d[i * 4 + 2] = b;
		d[i * 4 + 3] = 255;
	}
	sCtx.putImageData(id, 0, 0);

	const ctx = canvas.getContext('2d')!;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(small, 0, 0, canvas.width, canvas.height);

	// Grid lines when cells are large enough
	const cellW = canvas.width / cols;
	const cellH = canvas.height / rows;
	if (cellW >= 5 && cellH >= 5) {
		ctx.strokeStyle = 'rgba(128,128,128,0.22)';
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		for (let c = 0; c <= cols; c++) {
			const x = Math.round(c * cellW) + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, canvas.height);
		}
		for (let r = 0; r <= rows; r++) {
			const y = Math.round(r * cellH) + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(canvas.width, y);
		}
		ctx.stroke();
	}
}

/** Render grid to a new canvas at a suitable export resolution. */
export function buildExportCanvas(grid: ProcessedGrid): HTMLCanvasElement {
	const { cols, rows } = grid;
	const cellPx = Math.max(4, Math.min(16, Math.floor(1600 / Math.max(cols, rows))));
	const canvas = document.createElement('canvas');
	canvas.width = cols * cellPx;
	canvas.height = rows * cellPx;
	renderToCanvas(canvas, grid);
	return canvas;
}
