"""Download the pinned browser OCR runtime from the official npm registry.

Only allowlisted files are extracted; npm's SHA-512 integrity is verified first.
No package lifecycle scripts or package installation are run.
"""
import base64
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'vendor' / 'ocr'
PACKAGES = [
    ('tesseract.js', '6.0.1', {
        'package/dist/tesseract.min.js': 'tesseract.min.js',
        'package/dist/worker.min.js': 'worker.min.js',
    }),
    ('tesseract.js-core', '6.0.0', {
        'package/' + name: 'core/' + name for name in [
            'tesseract-core.wasm.js', 'tesseract-core-simd.wasm.js',
            'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js',
        ]
    }),
    ('@tesseract.js-data/chi_sim', '1.0.0', {
        'package/4.0.0_best_int/chi_sim.traineddata.gz': 'lang/chi_sim.traineddata.gz',
    }),
    ('@tesseract.js-data/eng', '1.0.0', {
        'package/4.0.0_best_int/eng.traineddata.gz': 'lang/eng.traineddata.gz',
    }),
]


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def main():
    manifest = []
    for name, version, files in PACKAGES:
        metadata = json.loads(fetch('https://registry.npmjs.org/' + name + '/' + version))
        dist = metadata['dist']
        archive = fetch(dist['tarball'])
        algorithm, expected = dist['integrity'].split('-', 1)
        actual = base64.b64encode(hashlib.new(algorithm, archive).digest()).decode()
        if actual != expected:
            raise RuntimeError('Integrity mismatch: ' + name)
        outputs = []
        with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as package:
            # Copy upstream licenses when the npm package includes them.
            for member in package.getmembers():
                if member.isfile() and member.name.count('/') == 1 and member.name.split('/')[-1].lower().startswith('license'):
                    files[member.name] = name.replace('@', '').replace('/', '-') + '-' + member.name.split('/')[-1]
            for source, target in files.items():
                data = package.extractfile(source).read()
                path = DEST / target
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                outputs.append({'path': target, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        manifest.append({'package': name, 'version': version, 'source': dist['tarball'],
                         'integrity': dist['integrity'], 'license': metadata.get('license'), 'files': outputs})
        print(name + '@' + version + ': verified and saved', flush=True)
    license_url = 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/LICENSE'
    license_data = fetch(license_url)
    (DEST / 'tessdata-LICENSE').write_bytes(license_data)
    manifest.append({'upstream': 'naptha/tessdata', 'source': license_url,
                     'files': [{'path': 'tessdata-LICENSE', 'bytes': len(license_data),
                                'sha256': hashlib.sha256(license_data).hexdigest()}]})
    (DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
