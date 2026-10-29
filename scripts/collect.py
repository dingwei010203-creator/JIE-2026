"""Daily, conservative official-source intake. New items remain reviewable leads.

HTML/RSS need only the standard library. PDF/XLS/XLSX readers are optional.
No inferred vacancy is promoted to a verified position. Existing human-reviewed
records survive HTTP failures, content changes, and partial runs.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
import ipaddress
import json
from pathlib import Path
import re
import threading
import time
from urllib import error, parse, request, robotparser
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
CACHE = ROOT / '.cache'
TZ = timezone(timedelta(hours=8))
UA = 'EconPhDCareersBot/1.0 (+https://github.com/dingwei010203-creator/JIE-2026)'
RECRUIT = re.compile(r'招聘|招收.*博士后|博士后.*招收|人才引进|引进.*人才|人才.*引进|公开选聘')
FOLLOWUP = re.compile(r'拟聘|录用|成绩|结果公示|面试名单|面试公告|考核名单|业务考核公告|资格.*结果|资格复审|资格复核|递补|体检|考察|报名情况|延期|延长|补充公告|更正公告|取消|核减|终止')
ECON = re.compile(r'经济学|理论经济|应用经济|政治经济|国民经济|产业经济|区域经济|国际贸易|金融学|财政学|数量经济|劳动经济|数字经济|经济研究|农林经济|0201|0202')
BLOCK = re.compile(r'验证码|人机验证|安全验证|访问过于频繁|访问被拒绝|verify you are human|access denied|captcha|checking your browser', re.I)
CHANNEL = re.compile(r'招聘|人才引进|通知公告|人事信息|诚聘|诚邀|事业单位|人才招聘')
DATE = re.compile(r'(?P<y>20\d{2})[年./-]\s*(?P<m>1[0-2]|0?[1-9])[月./-]\s*(?P<d>3[01]|[12]\d|0?[1-9])日?')
EXTRA_DOMAINS: set[str] = set()
_host_locks: dict[str, threading.Lock] = {}
_host_times: dict[str, float] = {}
_robot_cache: dict[str, robotparser.RobotFileParser | None] = {}
_global_lock = threading.Lock()


def now_iso():
    return datetime.now(TZ).isoformat(timespec='seconds')


def load(path, default):
    try:
        return json.loads(path.read_text('utf-8'))
    except FileNotFoundError:
        return default


def write_json(path, payload):
    """Atomic replacements prevent a cancelled run from truncating the feed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    temp.replace(path)


def canonical_url(url):
    p = parse.urlsplit(url.strip())
    params = [(k, v) for k, v in parse.parse_qsl(p.query, keep_blank_values=True)
              if not k.lower().startswith('utm_') and k.lower() not in ['from', 'spm', 'share', 'fbclid']]
    # Retain id/article query parameters: they often distinguish official notices.
    return parse.urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or '/', parse.urlencode(sorted(params)), ''))


def url_key(url):
    p=parse.urlsplit(canonical_url(url))
    return parse.urlunsplit(('',p.netloc,p.path,p.query,''))


def official_url(url):
    try:
        p = parse.urlsplit(url)
        host = (p.hostname or '').lower()
        return p.scheme in ('http', 'https') and not p.username and not p.password and (
            host.endswith('.gov.cn') or host.endswith('.edu.cn') or host.endswith('.ac.cn') or
            any(host == d or host.endswith('.'+d) for d in EXTRA_DOMAINS))
    except ValueError:
        return False


def public_url(url):
    p = parse.urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Only public HTTP(S) URLs are allowed')
    # The host runtime may provide an HTTP proxy with remote DNS resolution.
    # Restrict destination names to the official allowlist at call sites, and
    # reject literal private addresses without requiring local DNS to work.
    if p.hostname.lower() in ('localhost','localhost.localdomain') or p.hostname.lower().endswith('.localhost'):
        raise ValueError('Local network address rejected')
    try:
        address=ipaddress.ip_address(p.hostname)
    except ValueError:
        address=None
    if address is not None and not address.is_global:
        raise ValueError('Private or reserved network address rejected')


class PublicRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_url(newurl)
        if parse.urlsplit(req.full_url).hostname != 'www.bing.com' and not official_url(newurl):
            raise ValueError('Redirect left configured official domains')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def raw_fetch(url, timeout=12):
    public_url(url)
    opener = request.build_opener(PublicRedirect())
    with opener.open(request.Request(url, headers={'User-Agent': UA, 'Accept':'text/html,application/xml;q=0.9,*/*;q=0.8'}), timeout=timeout) as response:
        body = response.read(8_000_001)
        if len(body) > 8_000_000:
            raise ValueError('Document exceeds 8 MB limit')
        return body, response.headers, response.geturl()


def robots_allowed(url, timeout):
    origin = '{0.scheme}://{0.netloc}'.format(parse.urlsplit(url))
    if origin not in _robot_cache:
        try:
            raw, _, _ = raw_fetch(origin+'/robots.txt', min(timeout, 7))
            rp = robotparser.RobotFileParser()
            rp.parse(raw.decode('utf-8', 'replace').splitlines())
            _robot_cache[origin] = rp
        except error.HTTPError as e:
            if e.code in (401, 403, 429):
                raise ValueError(f'robots.txt access restriction: HTTP {e.code}')
            _robot_cache[origin] = None
        except (TimeoutError, OSError, ValueError):
            _robot_cache[origin] = None
    rp = _robot_cache[origin]
    return not rp or rp.can_fetch(UA, url)


def fetch(url, timeout=12):
    host = parse.urlsplit(url).hostname
    with _global_lock:
        lock = _host_locks.setdefault(host, threading.Lock())
    with lock:
        if not robots_allowed(url, timeout):
            raise ValueError('robots.txt disallows this URL')
        pause = 0.6 - (time.monotonic() - _host_times.get(host, 0))
        if pause > 0:
            time.sleep(pause)
        try:
            return raw_fetch(url, timeout)
        finally:
            _host_times[host] = time.monotonic()


def decode(raw, headers=None):
    encoding = headers.get_content_charset() if headers else None
    if not encoding:
        match = re.search(br'charset\s*=\s*[\"\x27]?([\w-]+)', raw[:6000], re.I)
        encoding = match.group(1).decode('ascii', 'ignore') if match else 'utf-8'
    for enc in [encoding, 'utf-8', 'gb18030']:
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('utf-8', 'replace')


class Page(HTMLParser):
    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url, self.links, self.fragments, self.headers = url, [], [], []
        self._skip, self._anchor, self._heading = 0, None, False
        self._row, self.rows = None, []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript', 'svg'):
            self._skip += 1
        if self._skip:
            return
        if tag in ('h1', 'h2', 'h3'):
            self._heading = True
        if tag == 'a' and attrs.get('href'):
            self._anchor = {'url':parse.urljoin(self.url, attrs['href'].strip()), 'parts':[], 'title':attrs.get('title','')}
        if tag == 'tr':
            self._row = []
        if tag in ('p','div','br','tr','li','h1','h2','h3'):
            self.fragments.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script','style','noscript','svg') and self._skip:
            self._skip -= 1
            return
        if self._skip:
            return
        if tag in ('h1','h2','h3'):
            self._heading = False
        if tag == 'a' and self._anchor:
            a = self._anchor
            a['text'] = re.sub(r'\s+', ' ', ''.join(a.pop('parts'))).strip() or a['title']
            self.links.append(a)
            self._anchor = None
        if tag == 'tr' and self._row is not None:
            self.rows.append(' | '.join(self._row))
            self._row = None
        if tag in ('p','div','tr','li'):
            self.fragments.append('\n')

    def handle_data(self, data):
        if self._skip:
            return
        self.fragments.append(data)
        if self._anchor:
            self._anchor['parts'].append(data)
        if self._heading:
            self.headers.append(data.strip())
        if self._row is not None and data.strip():
            self._row.append(data.strip())

    @property
    def text(self):
        return re.sub(r'\n\s*\n+', '\n', re.sub(r'[\t\r \u3000]+', ' ', ''.join(self.fragments))).strip()


def read_page(url, timeout):
    raw, headers, final = fetch(url, timeout)
    p = Page(final)
    p.feed(decode(raw, headers))
    if len(p.text) < 80:
        raise ValueError('Empty page or client-rendered content')
    if BLOCK.search(p.text[:1800]):
        raise ValueError('Site access/verification restriction; not retried')
    return p


def document_rows(raw, url):
    suffix = parse.urlsplit(url).path.lower().split('.')[-1]
    if suffix == 'xlsx':
        import openpyxl
        book = openpyxl.load_workbook(BytesIO(raw), read_only=True, data_only=True)
        return [' | '.join(str(x or '') for x in row) for sheet in book for row in sheet.iter_rows(values_only=True)]
    if suffix == 'xls':
        import xlrd
        book = xlrd.open_workbook(file_contents=raw)
        return [' | '.join(str(c.value) for c in row) for sheet in book.sheets() for row in sheet.get_rows()]
    if suffix == 'pdf':
        from pypdf import PdfReader
        return '\n'.join(p.extract_text() or '' for p in PdfReader(BytesIO(raw)).pages[:40]).splitlines()
    return []


def signals(text):
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    return [x[:260] for x in lines if ECON.search(x) or ('报名' in x and ('截止' in x or '时间' in x))][:8]


def make_candidate(url, title, page, source, timeout):
    text = page.text
    if not RECRUIT.search(title) or FOLLOWUP.search(title):
        return None
    # Publication year is a relevance signal only. Never infer a deadline from it.
    current_year = datetime.now(TZ).year
    title_years = re.findall(r'20\d{2}', title)
    if title_years and max(map(int, title_years)) < current_year and not re.search(r'长期|常年|滚动',title):
        return None
    econ_rows = [r for r in page.rows if ECON.search(r)]
    attachment_links = [a for a in page.links if re.search(r'岗位.*表|需求.*表|职位.*表',a['text']) and re.search(r'\.(xlsx?|pdf)(?:\?|$)',a['url'],re.I) and official_url(a['url'])][:2]
    issues = []
    for a in attachment_links:
        try:
            raw, _, final = fetch(a['url'], timeout)
            econ_rows += [r for r in document_rows(raw, final) if ECON.search(r)][:8]
        except Exception as e:
            issues.append('岗位附件未解析：'+str(e)[:90])
    if not ECON.search(text) and not econ_rows:
        # PhD-specific announcements with unreadable job tables remain attachment leads.
        if not ('博士' in text and attachment_links and issues):
            return None
    if '博士' not in text and not any('博士' in r for r in econ_rows):
        return None
    kind = 'postdoc' if '博士后' in title else 'faculty'
    canonical = canonical_url(url)
    return {
        'id':'auto-'+sha256(canonical.encode()).hexdigest()[:14], 'sourceId':source['id'],
        'institution':source['institution'] if source['type']!='综合招聘平台' else '单位详见原公告',
        'region':source['region'], 'city':source.get('city','待核验'), 'type':source['type'],
        'kind':kind, 'title':title[:160], 'url':canonical, 'publishedAt':None,
        'deadline':None, 'rolling':False, 'headcount':None, 'majors':[],
        'verifiedLevel':'lead', 'verifiedAt':None, 'firstSeenAt':now_iso(), 'lastSeenAt':now_iso(),
        'summary':'官方公告已发现；经济学对应岗位、应届与港澳学历条件须逐项核验。',
        'requirements':{}, 'evidenceHints':(econ_rows[:4] or signals(text)),
        'attachments':[{'label':a['text'][:80], 'url':a['url']} for a in attachment_links],
        'verificationIssues':issues, 'contentHash':sha256(text.encode()).hexdigest(),
        'sourceAuthority':'official', 'remainingVacancies':'未核实',
    }


def scan_source(source, timeout, limit):
    status = {k:source.get(k) for k in ('id','institution','region','city','type','url','priority','mode')}
    status.update({'checkedAt':now_iso(),'status':'error','announcementsRead':0,'leadsFound':0,'errors':[]})
    found, changes = [], []
    try:
        page = read_page(source['url'], timeout)
        pages = [page]
        status['finalUrl'] = page.url
        if source.get('mode')=='homepage':
            channels = [a for a in page.links if CHANNEL.search(a['text']) and 2<=len(a['text'])<=30 and official_url(a['url']) and parse.urlsplit(a['url']).hostname==parse.urlsplit(page.url).hostname]
            seen_channels = {canonical_url(page.url)}
            for a in channels:
                u = canonical_url(a['url'])
                if u in seen_channels:
                    continue
                seen_channels.add(u)
                try:
                    pages.append(read_page(u, timeout))
                except Exception as e:
                    status['errors'].append(str(e)[:140])
                if len(pages)>=3:
                    break
        links = {}
        for p in pages:
            for a in p.links:
                if RECRUIT.search(a['text']) and len(a['text'])>10 and official_url(a['url']):
                    if FOLLOWUP.search(a['text']):
                        changes.append({'title':a['text'][:160],'url':canonical_url(a['url']),'sourceId':source['id'],'region':source['region'],'detectedAt':now_iso()})
                    elif re.search(r'20(2[5-9]|[3-9]\d)',a['text']) or '博士' in a['text']:
                        links.setdefault(canonical_url(a['url']), a['text'])
        for url, title in list(links.items())[:limit]:
            try:
                p = read_page(url, timeout)
                status['announcementsRead'] += 1
                candidate = make_candidate(url,title,p,source,timeout)
                if candidate:
                    found.append(candidate)
            except Exception as e:
                status['errors'].append(f'{title[:32]}: {str(e)[:110]}')
        status['leadsFound'] = len(found)
        status['status'] = 'partial' if status['errors'] else 'ok'
        status['scope'] = f'访问{len(pages)}个入口，读取{status["announcementsRead"]}则公告；入口扫描不代表该单位已穷尽'
        if not links and re.search(r'\{\{|ng-repeat|v-for|__NEXT_DATA__',page.text):
            status['status']='needs_js'
            status['errors'].append('栏目可能依赖浏览器渲染，需要联网复查')
    except Exception as e:
        status['errors'].append(str(e)[:200])
        status['scope']='本次未完成；不能据此判断无招聘'
    return status, found, changes


def search_query(query, sources, timeout):
    log={'query':query['q'],'region':query['region'],'status':'error','checkedAt':now_iso(),'results':0}
    candidates=[]
    try:
        url='https://www.bing.com/search?'+parse.urlencode({'q':query['q'],'format':'rss','count':10})
        # Public RSS discovery is best-effort; it is never treated as verified coverage.
        raw, _, _ = fetch(url,timeout)
        root=ET.fromstring(raw)
        for item in root.findall('.//item'):
            link=item.findtext('link','')
            title=item.findtext('title','')
            if not official_url(link) or not RECRUIT.search(title) or FOLLOWUP.search(title):
                continue
            if not any(x in title for x in ['2026','2027','博士']):
                continue
            source=next((s for s in sources if parse.urlsplit(s['url']).hostname==parse.urlsplit(link).hostname),None)
            if source is None:
                source={'id':'web-search','institution':'单位详见原公告','region':query['region'],'type':'综合招聘平台','city':'待核验'}
            try:
                p=read_page(link,timeout)
                c=make_candidate(link,title,p,source,timeout)
                if c:candidates.append(c)
            except Exception:
                continue
        log.update({'status':'ok','results':len(candidates),'scope':'公开搜索补查；搜索引擎索引并非完整招聘名录'})
    except Exception as e:
        log['error']=str(e)[:180]
    return log,candidates


def merge_records(curated, previous, incoming, excluded=()):
    """Curated rows override crawled leads. URL dedupe keeps role-level children."""
    curated_urls={url_key(u) for j in curated for u in [j['url']]+j.get('alternateUrls',[])}
    curated_urls.update(url_key(u) for u in excluded)
    result={j['id']:j.copy() for j in previous if url_key(j['url']) not in curated_urls and not FOLLOWUP.search(j['title']) and
            not (re.findall(r'20\d{2}',j['title']) and max(map(int,re.findall(r'20\d{2}',j['title'])))<datetime.now(TZ).year and not re.search(r'长期|常年|滚动',j['title']))}
    for item in incoming:
        if url_key(item['url']) in curated_urls:
            continue
        old=next((j for j in result.values() if url_key(j['url'])==url_key(item['url']) or
                 (j['institution']==item['institution'] and j['region']==item['region'] and
                  re.sub(r'\s','',j['title'])==re.sub(r'\s','',item['title']))),{})
        if old:
            item['firstSeenAt']=old.get('firstSeenAt',item['firstSeenAt'])
            item['alternateUrls']=sorted(set(old.get('alternateUrls',[])+[old['url']])-set([item['url']]))
            result.pop(old['id'],None)
        result[item['id']]=item
    return list(result.values())


def recheck_reviewed(curated, previous_checks, timeout):
    checks={}
    active_urls={j['url'] for j in curated if not j.get('closed') and
                 (not j.get('deadline') or j['deadline'][:10]>=datetime.now(TZ).date().isoformat())}
    def one(url):
        old=previous_checks.get(url,{})
        check={**old,'url':url,'checkedAt':now_iso()}
        try:
            p=read_page(url,timeout)
            digest=sha256(p.text.encode()).hexdigest()
            if old.get('contentHash') and old['contentHash']!=digest:
                check['changedAt']=now_iso()
            check.update({'status':'reachable','contentHash':digest})
        except Exception as e:
            check.update({'status':'unreachable','error':str(e)[:160]})
        return url,check
    with ThreadPoolExecutor(max_workers=5) as pool:
        for url,check in pool.map(one,active_urls):
            checks[url]=check
    rows=[]
    for record in curated:
        item=record.copy();check=checks.get(item['url'],{})
        if check.get('changedAt') and (not item.get('verifiedAt') or item['verifiedAt']<check['changedAt']):
            item['reviewNeeded']=True
        item['originalCheck']=check or None
        rows.append(item)
    return rows,checks


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--limit-sources',type=int,default=0)
    parser.add_argument('--max-announcements',type=int,default=5)
    parser.add_argument('--workers',type=int,default=8)
    parser.add_argument('--timeout',type=int,default=10)
    parser.add_argument('--skip-search',action='store_true')
    parser.add_argument('--offline',action='store_true',help='Rebuild from retained data without network requests')
    args=parser.parse_args()
    started=now_iso()
    config=load(DATA/'sources.json',{})
    EXTRA_DOMAINS.update(config.get('officialDomains',[]))
    sources=sorted(config['sources'],key=lambda s:s['priority'],reverse=True)
    if args.limit_sources:
        sources=sources[:args.limit_sources]
    curated_doc=load(DATA/'curated.json',{'jobs':[]})
    curated=curated_doc['jobs']
    old_feed=load(DATA/'feed.json',{})
    previous=load(DATA/'candidates.json',old_feed.get('candidates',[]))
    logs,incoming,changes=[],[],[]
    search_logs=[]
    if not args.offline:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures={pool.submit(scan_source,s,args.timeout,args.max_announcements):s for s in sources}
            for future in as_completed(futures):
                log,items,followups=future.result()
                logs.append(log);incoming.extend(items);changes.extend(followups)
                print(f'{log["status"]:8} {log["institution"]}: {log["announcementsRead"]} announcements, {len(items)} leads',flush=True)
        if not args.skip_search:
            queries=load(DATA/'query_plan.json',{'queries':[]})['queries']
            # Keep search requests serial and modest; no retries around restrictions.
            for q in queries:
                log,items=search_query(q,config['sources'],args.timeout)
                search_logs.append(log);incoming.extend(items)
                print(f'SEARCH {log["status"]}: {q["q"]}',flush=True)
    else:
        logs=old_feed.get('sourceHealth',[])
        search_logs=old_feed.get('searchHealth',[])
        changes=old_feed.get('relatedUpdates',[])
    excluded=[x['url'] for x in load(DATA/'exclusions.json',[])]
    merged=merge_records(curated,previous,incoming,excluded)
    if args.offline:
        # Carry change flags through deployment-only runs until an actual review
        # has a newer verifiedAt. A successful GET is not a new review.
        checks=old_feed.get('reviewedChecks',{})
        for j in curated:
            check=checks.get(j['url'],{})
            if check.get('changedAt') and (not j.get('verifiedAt') or j['verifiedAt']<check['changedAt']):
                j['reviewNeeded']=True
    else:
        curated,checks=recheck_reviewed(curated,old_feed.get('reviewedChecks',{}),args.timeout)
    write_json(DATA/'candidates.json',merged)
    success=sum(s['status']=='ok' for s in logs)
    partial=sum(s['status']=='partial' for s in logs)
    total=len(config['sources'])
    unique_changes={x['url']:x for x in changes}
    feed={
        'schemaVersion':1, 'generatedAt':now_iso(),
        'lastScanStartedAt':old_feed.get('lastScanStartedAt') if args.offline else started,
        'lastScanCompletedAt':old_feed.get('lastScanCompletedAt') if args.offline else now_iso(),
        'lastVerifiedAt':curated_doc.get('lastVerifiedAt'),
        'scanMode':'offline-rebuild' if args.offline else 'official-source-scan',
        'scanSummary':{'configured':total,'attempted':len(logs),'ok':success,'partial':partial,'failed':sum(s['status'] in ('error','needs_js') for s in logs),'unattempted':total-len(logs)},
        'coverageNote':'来源状态只反映本次已配置入口扫描；不代表四地所有单位或所有历史页已穷尽。自动线索不计入已核验岗位。',
        'jobs':curated+merged, 'sourceHealth':sorted(logs,key=lambda s:-(s.get('priority') or 0)),
        'searchHealth':search_logs, 'relatedUpdates':list(unique_changes.values())[:100], 'reviewedChecks':checks,
    }
    write_json(DATA/'feed.json',feed)
    if not args.offline:
        hist=load(DATA/'history.json',[])
        # One end-of-day scan point; retries do not inflate the daily series.
        day=datetime.now(TZ).date().isoformat()
        hist=[h for h in hist if h['date']!=day]
        hist.append({'date':day,'reviewedPositions':len([j for j in curated if j.get('verifiedLevel')=='position']),'leads':len(merged),'sourcesOk':success,'sourcesAttempted':len(logs)})
        write_json(DATA/'history.json',hist[-180:])
    if not args.offline and not (success or partial):
        print('All source scans failed. Retained prior jobs; failure is visible in feed.',flush=True)
        return 2
    print(f'Feed saved: {len(curated)} reviewed records + {len(merged)} leads',flush=True)
    return 0


if __name__=='__main__':
    raise SystemExit(main())
