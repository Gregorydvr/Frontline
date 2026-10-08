"""Builds the one-file page from src.html by putting the font, the logo paths and the film layer in."""
import hashlib
from pathlib import Path

here = Path(__file__).resolve().parent
src = (here / 'src.html').read_text(encoding='utf-8')
logo = (here / 'logo-paths.txt').read_text(encoding='utf-8')
assert logo.count('#20273E') == 1 and logo.count('#2B7E85') == 1
parts = {
    '/*@@FONT@@*/': (here / 'font-face.css').read_text(encoding='utf-8'),
    '<!--@@LOGO@@-->': logo,
    # the same wordmark for the film's dark stage: cream letters, cyan hyphen
    '<!--@@LOGO_LIGHT@@-->': logo.replace('#20273E', '#FBF4EB').replace('#2B7E85', '#66D8E8'),
    '/*@@FILM_CSS@@*/': (here / 'film.css').read_text(encoding='utf-8'),
    '/*@@FILM_JS@@*/': (here / 'film.js').read_text(encoding='utf-8'),
}
out = src
for mark, text in parts.items():
    assert src.count(mark) == 1, mark
    out = out.replace(mark, text)
data = out.encode('utf-8')
(here / 'frontline-client-app.html').write_bytes(data)
print('built', len(data), 'bytes, sha256', hashlib.sha256(data).hexdigest())
