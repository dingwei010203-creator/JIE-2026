"""Check the publishable snapshot and review invariants without networking."""
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]
data=ROOT/'data'
feed=json.loads((data/'feed.json').read_text())
config=json.loads((data/'sources.json').read_text())
seen=set();role_keys=set();errors=[]
for j in feed['jobs']:
    for key in ('id','institution','region','type','title','url','verifiedLevel'):
        if not j.get(key):errors.append(f'{j.get("id")}: missing {key}')
    if j.get('id') in seen:errors.append(f'Duplicate id: {j["id"]}')
    seen.add(j['id'])
    if urlsplit(j['url']).scheme not in ('http','https'):errors.append('Unsafe URL: '+j['id'])
    if j['region'] not in ['广东','江苏','浙江','北京']:errors.append('Region: '+j['id'])
    if j.get('headcount') is not None and (type(j['headcount']) is not int or j['headcount']<=0):errors.append('Invalid headcount: '+j['id'])
    if j.get('verifiedLevel')=='position':
        if not j.get('verifiedAt') or not j.get('evidence'):errors.append('Missing review evidence: '+j['id'])
        if not j.get('majors'):errors.append('Missing major scope: '+j['id'])
        key=(j['url'],j.get('positionCode') or j['title'])
        if key in role_keys:errors.append('Duplicated verified role: '+j['id'])
        role_keys.add(key)
    if j.get('deadline'):
        try:datetime.fromisoformat(j['deadline'].replace('Z','+00:00'))
        except ValueError:errors.append('Invalid deadline: '+j['id'])
ids=[s['id'] for s in config['sources']]
if len(ids)!=len(set(ids)):errors.append('Duplicate source ids')
if not set(s['region'] for s in config['sources'])=={'广东','江苏','浙江','北京'}:errors.append('Incomplete region configuration')
for name in ['index.html','styles.css','app.js','core.js','favicon.svg']:
    if not (ROOT/name).is_file():errors.append('Missing asset '+name)
for text in ['app.js','index.html','styles.css']:
    content=(ROOT/text).read_text()
    if any(term in content for term in ['xyding2021','National School of Development, Peking University','13263446876','Boya Postdoctoral']):
        errors.append('Unrelated personal information in '+text)
if errors:
    raise SystemExit('\n'.join(errors))
print(f'Validated {len(feed["jobs"])} records, {len(config["sources"])} sources, distinct reviewed roles and publication assets.')
