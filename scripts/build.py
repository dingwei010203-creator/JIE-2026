"""Build a self-contained static deployment directory; no network or bundler."""
from pathlib import Path
import hashlib
import shutil

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
for name in ['index.html', 'styles.css', 'app.js', 'core.js', 'favicon.svg']:
    shutil.copy2(ROOT / name, DIST / name)
# A changed module must get a new URL even when an importing module is cached.
revision = hashlib.sha256(b'\0'.join((ROOT / name).read_bytes()
                                  for name in ['app.js', 'core.js', 'styles.css'])).hexdigest()[:12]
index = (DIST / 'index.html').read_text()
for name in ['styles.css', 'app.js']:
    index = index.replace(f'"./{name}"', f'"./{name}?v={revision}"')
(DIST / 'index.html').write_text(index)
app = (DIST / 'app.js').read_text().replace("'./core.js'", f"'./core.js?v={revision}'")
(DIST / 'app.js').write_text(app)
shutil.copytree(ROOT / 'data', DIST / 'data', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('curated.json', 'candidates.json', 'query_plan.json'))
(DIST / '.nojekyll').touch()
print(f'Static site ready: {DIST}')
