"""Build a self-contained static deployment directory; no network or bundler."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
for name in ['index.html', 'styles.css', 'app.js', 'core.js', 'favicon.svg']:
    shutil.copy2(ROOT / name, DIST / name)
shutil.copytree(ROOT / 'data', DIST / 'data', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('curated.json', 'candidates.json', 'query_plan.json'))
(DIST / '.nojekyll').touch()
print(f'Static site ready: {DIST}')
