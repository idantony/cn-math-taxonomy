# Local browser OCR

Pinned distributions from the official npm registry:

- Tesseract.js 6.0.1 (Apache-2.0).
- tesseract.js-core 6.0.0 (Apache-2.0), including SIMD and non-SIMD LSTM runtimes.
- `@tesseract.js-data/chi_sim` and `@tesseract.js-data/eng` 1.0.0,
  using `4.0.0_best_int`. Their npm package metadata says MIT;
  the upstream naptha/tessdata repository distributes the trained data under Apache-2.0.

Upstream licenses are retained in this directory. `manifest.json` records exact
package URLs, npm integrity and SHA-256 of each local file. Reproduce with
`python scripts/vendor_ocr.py` (no npm installation or lifecycle scripts).

The learning page loads the runtime lazily, from this site's own paths. Images
are processed in a browser worker; no image or recognized text is sent to an OCR
service. The ordinary learning flow does not download the OCR runtime until the
student chooses to recognize an image. The service worker caches requested OCR
files for subsequent offline use; first use requires these files to be available.

This is text recognition, not a mathematical reasoning or handwriting model.
Students must confirm and correct formulas, symbols and recognized text before
selecting practice topics.

Upstream documentation: https://github.com/naptha/tesseract.js/tree/v6.0.1/docs
and https://github.com/naptha/tessdata.
