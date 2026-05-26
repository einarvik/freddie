<script lang="ts">
	import {
		processImage,
		renderToCanvas,
		buildExportCanvas,
		type ProcessedGrid
	} from '$lib/imageProcessing';
	import favicon from '$lib/assets/favicon.webp';

	// ─── State ───────────────────────────────────────────────────────────────

	let sourceImg = $state<HTMLImageElement | null>(null);
	let sourcePreviewUrl = $state<string | null>(null);

	let widthCm = $state(20);
	let heightCm = $state(20);
	let gaugeSts = $state(10); // stitches per 10cm
	let gaugeRows = $state(10); // rows per 10cm

	let blockSize = $state(1);
	let mode = $state<'bw' | 'color'>('bw');

	let threshold = $state(128);
	let edgeStrength = $state(0.3);
	let numColors = $state(8);

	// ─── Derived grid dimensions ─────────────────────────────────────────────

	let gridCols = $derived(Math.max(1, Math.round((widthCm / 10) * gaugeSts)));
	let gridRows = $derived(Math.max(1, Math.round((heightCm / 10) * gaugeRows)));

	let totalStitches = $derived(gridCols * gridRows);
	let stitchWCm = $derived((10 / gaugeSts).toFixed(2));
	let stitchHCm = $derived((10 / gaugeRows).toFixed(2));

	// Bidirectional: user edits gridCols/Rows directly → update cm
	function setGridCols(e: Event) {
		const v = parseInt((e.target as HTMLInputElement).value);
		if (v > 0) widthCm = parseFloat(((v / gaugeSts) * 10).toFixed(1));
	}
	function setGridRows(e: Event) {
		const v = parseInt((e.target as HTMLInputElement).value);
		if (v > 0) heightCm = parseFloat(((v / gaugeRows) * 10).toFixed(1));
	}

	// ─── Processing ──────────────────────────────────────────────────────────

	let processedGrid = $state<ProcessedGrid | null>(null);
	let processing = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const img = sourceImg;
		const cols = gridCols;
		const rows = gridRows;
		const bs = blockSize;
		const m = mode;
		const thr = threshold;
		const es = edgeStrength;
		const nc = numColors;

		clearTimeout(debounceTimer);
		if (!img) return;

		processing = true;
		debounceTimer = setTimeout(() => {
			processedGrid = processImage(img, {
				cols,
				rows,
				blockSize: bs,
				mode: m,
				threshold: thr,
				edgeStrength: es,
				numColors: nc
			});
			processing = false;
		}, 120);

		return () => clearTimeout(debounceTimer);
	});

	// ─── Canvas rendering ────────────────────────────────────────────────────

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let containerEl = $state<HTMLElement | null>(null);
	let containerW = $state(800);
	let containerH = $state(600);

	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver((entries) => {
			containerW = entries[0].contentRect.width;
			containerH = entries[0].contentRect.height;
		});
		ro.observe(containerEl);
		containerW = containerEl.clientWidth;
		containerH = containerEl.clientHeight;
		return () => ro.disconnect();
	});

	$effect(() => {
		const grid = processedGrid;
		const el = canvasEl;
		const cw = containerW;
		const ch = containerH;

		if (!el || !grid) return;

		const paletteH = grid.mode === 'color' ? 64 : 0;
		const avW = Math.max(1, cw - 32);
		const avH = Math.max(1, ch - 32 - paletteH);
		const cellPx = Math.max(1, Math.floor(Math.min(avW / grid.cols, avH / grid.rows)));

		el.width = cellPx * grid.cols;
		el.height = cellPx * grid.rows;
		renderToCanvas(el, grid);
	});

	// ─── File handling ───────────────────────────────────────────────────────

	let dragOver = $state(false);

	function loadFile(file: File) {
		if (!file.type.startsWith('image/')) return;
		if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
		const url = URL.createObjectURL(file);
		sourcePreviewUrl = url;
		const img = new Image();
		img.onload = () => {
			sourceImg = img;
			// Preserve image aspect ratio in height
			const aspect = img.naturalWidth / img.naturalHeight;
			heightCm = parseFloat((widthCm / aspect).toFixed(1));
		};
		img.src = url;
	}

	function onFileInput(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) loadFile(file);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files[0];
		if (file) loadFile(file);
	}

	// ─── Reset ───────────────────────────────────────────────────────────────

	function reset() {
		if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
		sourceImg = null;
		sourcePreviewUrl = null;
		widthCm = 20;
		heightCm = 20;
		gaugeSts = 10;
		gaugeRows = 10;
		blockSize = 1;
		mode = 'bw';
		threshold = 128;
		edgeStrength = 0.3;
		numColors = 8;
		processedGrid = null;
		const fi = document.getElementById('file-input') as HTMLInputElement;
		if (fi) fi.value = '';
	}

	// ─── Export ──────────────────────────────────────────────────────────────

	function exportPNG() {
		if (!processedGrid) return;
		const canvas = buildExportCanvas(processedGrid);
		const a = document.createElement('a');
		a.download = 'tapestry-pattern.png';
		a.href = canvas.toDataURL('image/png');
		a.click();
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	function rgbCss(r: number, g: number, b: number) {
		return `rgb(${r},${g},${b})`;
	}

	function hexFromRgb(r: number, g: number, b: number) {
		return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
	}

	function pct(count: number) {
		if (!processedGrid || processedGrid.mode !== 'color') return '';
		return ((count / (gridCols * gridRows)) * 100).toFixed(1) + '%';
	}
</script>

<div class="app">
	<!-- ── Sidebar ─────────────────────────────────────────────────────────── -->
	<aside class="sidebar">
		<div class="sidebar-scroll">
			<header class="app-header">
				<img src={favicon} alt="Freddy" class="app-logo" />
				<div>
					<h1>Freddy</h1>
					<p>Tapestry Designer | Crochet pattern from photo</p>
				</div>
			</header>

			<!-- Upload -->
			<section class="section">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="drop-zone"
					class:drag-over={dragOver}
					class:has-image={!!sourceImg}
					ondragover={(e) => {
						e.preventDefault();
						dragOver = true;
					}}
					ondragleave={() => (dragOver = false)}
					ondrop={onDrop}
					onclick={() => document.getElementById('file-input')?.click()}
					onkeydown={(e) => e.key === 'Enter' && document.getElementById('file-input')?.click()}
				>
					{#if sourcePreviewUrl}
						<img src={sourcePreviewUrl} alt="Source" class="thumb" />
						<span class="drop-hint">Click to change</span>
					{:else}
						<span class="drop-icon">↑</span>
						<span class="drop-label">Drop photo or click to upload</span>
					{/if}
				</div>
				<input
					id="file-input"
					type="file"
					accept="image/*"
					style="display:none"
					onchange={onFileInput}
				/>
				{#if sourceImg}
					<button class="reset-btn" onclick={reset}>Reset</button>
				{/if}
			</section>

			<!-- Mode -->
			<section class="section">
				<div class="mode-toggle">
					<button class="mode-btn" class:active={mode === 'bw'} onclick={() => (mode = 'bw')}>
						B&amp;W
					</button>
					<button class="mode-btn" class:active={mode === 'color'} onclick={() => (mode = 'color')}>
						Color
					</button>
				</div>
			</section>

			<!-- Size & Gauge -->
			<section class="section">
				<div class="section-label">Size &amp; Gauge</div>

				<div class="two-col">
					<label class="field">
						<span>Width cm</span>
						<input type="number" bind:value={widthCm} min="1" max="500" step="0.5" />
					</label>
					<label class="field">
						<span>Height cm</span>
						<input type="number" bind:value={heightCm} min="1" max="500" step="0.5" />
					</label>
				</div>

				<div class="two-col" style="margin-top:8px">
					<label class="field">
						<span>Sts / 10 cm</span>
						<input type="number" bind:value={gaugeSts} min="1" max="100" />
					</label>
					<label class="field">
						<span>Rows / 10 cm</span>
						<input type="number" bind:value={gaugeRows} min="1" max="100" />
					</label>
				</div>

				<div class="two-col" style="margin-top:8px">
					<label class="field">
						<span>Grid cols</span>
						<input type="number" value={gridCols} min="1" max="1000" onchange={setGridCols} />
					</label>
					<label class="field">
						<span>Grid rows</span>
						<input type="number" value={gridRows} min="1" max="1000" onchange={setGridRows} />
					</label>
				</div>
			</section>

			<!-- Block size -->
			<section class="section">
				<div class="section-label">Block size</div>
				<div class="slider-row">
					<input type="range" bind:value={blockSize} min="1" max="8" step="1" />
					<span class="slider-val">{blockSize} st{blockSize > 1 ? 's' : ''}</span>
				</div>
			</section>

			<!-- B&W controls -->
			{#if mode === 'bw'}
				<section class="section">
					<div class="section-label">B&amp;W settings</div>
					<label class="field" style="margin-bottom:10px">
						<div class="label-row">
							<span>Threshold</span><span class="val">{threshold}</span>
						</div>
						<input type="range" bind:value={threshold} min="0" max="255" />
					</label>
					<label class="field">
						<div class="label-row">
							<span>Edge strength</span>
							<span class="val">{Math.round(edgeStrength * 100)}%</span>
						</div>
						<input type="range" bind:value={edgeStrength} min="0" max="1" step="0.01" />
					</label>
				</section>
			{/if}

			<!-- Color controls -->
			{#if mode === 'color'}
				<section class="section">
					<div class="section-label">Color settings</div>
					<label class="field">
						<div class="label-row">
							<span>Number of colors</span><span class="val">{numColors}</span>
						</div>
						<input type="range" bind:value={numColors} min="2" max="24" step="1" />
					</label>
				</section>
			{/if}

			<!-- Grid info -->
			<section class="section info-section">
				<div class="info-row">
					<span>Grid</span>
					<strong>{gridCols} × {gridRows}</strong>
				</div>
				<div class="info-row">
					<span>Total stitches</span>
					<strong>{totalStitches.toLocaleString()}</strong>
				</div>
				<div class="info-row">
					<span>Stitch size</span>
					<strong>{stitchWCm} × {stitchHCm} cm</strong>
				</div>
			</section>

			<!-- Export -->
			<section class="section">
				<button class="export-btn" onclick={exportPNG} disabled={!processedGrid || processing}>
					Export PNG
				</button>
			</section>
		</div>
	</aside>

	<!-- ── Preview ─────────────────────────────────────────────────────────── -->
	<main class="preview-area" bind:this={containerEl}>
		{#if !sourceImg}
			<div class="empty-state">
				<div class="empty-icon">🧶</div>
				<p>Upload a photo to generate a crochet pattern</p>
			</div>
		{:else if processing && !processedGrid}
			<div class="empty-state">
				<p>Processing…</p>
			</div>
		{:else if processedGrid}
			<div class="canvas-wrap">
				<canvas bind:this={canvasEl}></canvas>
				{#if processing}
					<div class="processing-overlay">Processing…</div>
				{/if}
			</div>

			{#if processedGrid.mode === 'color'}
				<div class="palette-strip">
					{#each processedGrid.palette as [r, g, b], i}
						<div
							class="swatch"
							title={`${hexFromRgb(r, g, b)} — ${processedGrid.counts[i].toLocaleString()} sts (${pct(processedGrid.counts[i])})`}
						>
							<div class="swatch-color" style="background:{rgbCss(r, g, b)}"></div>
							<span class="swatch-count">{processedGrid.counts[i].toLocaleString()}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</main>
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	/* ── Sidebar ──────────────────────────────────────────────────────────── */

	.sidebar {
		width: 280px;
		flex-shrink: 0;
		background: var(--surface);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.sidebar-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.app-header {
		display: flex;
		align-items: top;
		gap: 10px;
		margin-bottom: 20px;
	}

	.app-logo {
		width: 56px;
		height: 56px;
		border-radius: 6px;
		flex-shrink: 0;
	}

	.app-header h1 {
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
		margin: 0 0 2px;
		letter-spacing: -0.01em;
	}

	.app-header p {
		font-size: 11px;
		color: var(--text-muted);
		margin: 0;
	}

	.section {
		margin-bottom: 20px;
	}

	.section-label {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin-bottom: 8px;
	}

	/* ── Upload ───────────────────────────────────────────────────────────── */

	.drop-zone {
		border: 1px dashed var(--border);
		border-radius: 6px;
		padding: 16px;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
		position: relative;
		overflow: hidden;
		min-height: 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}

	.drop-zone:hover,
	.drop-zone.drag-over {
		border-color: var(--accent);
		background: var(--accent-dim);
	}

	.drop-icon {
		font-size: 20px;
		color: var(--text-muted);
	}

	.drop-label {
		font-size: 12px;
		color: var(--text-muted);
	}

	.thumb {
		width: 100%;
		max-height: 120px;
		object-fit: contain;
		border-radius: 3px;
	}

	.drop-hint {
		font-size: 11px;
		color: var(--text-muted);
	}

	/* ── Reset ───────────────────────────────────────────────────────────── */

	.reset-btn {
		background: transparent;
		color: var(--text-muted);
		font-size: 11px;
		padding: 4px 0;
		width: 100%;
	}

	.reset-btn:hover {
		color: var(--text);
	}

	/* ── Mode toggle ──────────────────────────────────────────────────────── */

	.mode-toggle {
		display: flex;
		gap: 4px;
		background: var(--surface-2);
		padding: 3px;
		border-radius: 6px;
	}

	.mode-btn {
		flex: 1;
		padding: 6px 0;
		background: transparent;
		color: var(--text-muted);
		border-radius: 4px;
		font-weight: 500;
		font-size: 12px;
	}

	.mode-btn.active {
		background: var(--accent);
		color: #fff;
	}

	.mode-btn:hover:not(.active) {
		color: var(--text);
		background: var(--border);
	}

	/* ── Controls ─────────────────────────────────────────────────────────── */

	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.field > span,
	.field .label-row span:first-child {
		font-size: 11px;
		color: var(--text-dim);
	}

	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.val {
		font-size: 11px;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.slider-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.slider-row input[type='range'] {
		flex: 1;
	}

	.slider-val {
		font-size: 11px;
		color: var(--text);
		min-width: 36px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	/* ── Info ─────────────────────────────────────────────────────────────── */

	.info-section {
		background: var(--surface-2);
		border-radius: 6px;
		padding: 10px 12px;
	}

	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 12px;
		padding: 2px 0;
	}

	.info-row span {
		color: var(--text-dim);
	}

	.info-row strong {
		font-weight: 500;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	/* ── Export ───────────────────────────────────────────────────────────── */

	.export-btn {
		width: 100%;
		padding: 9px;
		background: var(--accent);
		color: #fff;
		font-weight: 500;
		font-size: 13px;
	}

	.export-btn:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	/* ── Preview ──────────────────────────────────────────────────────────── */

	.preview-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 16px;
		gap: 12px;
	}

	.canvas-wrap {
		position: relative;
		line-height: 0;
	}

	.canvas-wrap canvas {
		display: block;
		image-rendering: pixelated;
	}

	.processing-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 13px;
		color: var(--text-muted);
		border-radius: 2px;
	}

	/* ── Palette strip ────────────────────────────────────────────────────── */

	.palette-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
		max-width: 100%;
	}

	.swatch {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		cursor: default;
	}

	.swatch-color {
		width: 28px;
		height: 28px;
		border-radius: 3px;
		border: 1px solid rgba(255, 255, 255, 0.08);
	}

	.swatch-count {
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* ── Empty state ──────────────────────────────────────────────────────── */

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: var(--text-muted);
	}

	.empty-icon {
		font-size: 40px;
		opacity: 0.4;
	}

	.empty-state p {
		font-size: 13px;
		margin: 0;
	}
</style>
