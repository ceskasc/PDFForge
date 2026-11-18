# PDFForge

**PDFForge** is a private-by-design PDF workspace from [ceskacan](https://ceskacan.com/), built with the same typography, color system, responsive layout, and light/dark modes as the portfolio.

## Phase-based implementation

| Phase | Scope | Status |
| --- | --- | --- |
| 01 | Brand-matched responsive design, TR/EN, theme, client-only file import | Implemented |
| 02 | Merge PDFs, organize pages (reorder / rotate / remove), split into PDF/ZIP | Implemented |
| 03 | Images → PDF, text watermark, opt-in rasterized size reduction | Implemented |
| 04 | Tests, accessibility, deployment pipeline, performance safeguards | Initial implementation |
| 05 | OCR, digital signatures, font embedding, richer compression | Future — not advertised as working |

## Privacy and technical notes

- All PDF/image content is read and processed in the browser. **No PDFForge backend** or tracking.
- Includes **pdf-lib 1.17.1** for PDF creation/modification and **Mozilla PDF.js 4.10.38** for local previews. Matching PDF.js worker is bundled in the deployed site.
- Splitting accepts `1-3,5;6-8`, where commas combine pages and semicolons produce separate PDFs packaged as a ZIP.
- Compression is **lossy and opt-in**: pages become JPEG images, so text selection, links, and forms may be lost. It may make an already optimized PDF larger.
- Password-protected PDFs are currently unsupported. Editing digitally signed PDFs may invalidate signatures.
- Limits: 20 files, 50 MB per file, 160 MB total and 220 pages per workspace; high-resolution conversions depend on device memory.
- No registered account or payment is required.

## Run locally

```sh
npm install
npm run dev
npm run check
npm run build
```

`Vite` uses the base `/PDFForge/`, suitable for GitHub Pages. The build has no server-side image or PDF processing.

## License

MIT — © 2026 Sadık Can Çeşka. Dependencies retain their original open-source licenses.

## GitHub Pages activation

This repository is set up to **build and deploy automatically**, but the owner must activate GitHub Pages once: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The repository's workflow token cannot enable Pages on its own. Until activation, CI verifies and builds without attempting a deployment; after activation, use **Actions → PDFForge · Verify & Publish → Run workflow**.

## Verification

`npm run check` runs page-range unit tests, UI/translation contracts, real `pdf-lib` and ZIP integration tests, syntax checks and a Vite production build. The document-processing engine is browser-side; the browser receives its PDF.js worker and libraries from the packaged site. The two most memory-sensitive operations (thumbnails and document import) use safeguards.

## Release tracking

Version 0.2.0 is the first verified implementation. Automated checks cover real merge/split PDF operations, UI contracts, bilingual content and the optimized static build. GitHub Pages publishes from the `main` branch via Actions when the repository's Pages source is set to **GitHub Actions**.
