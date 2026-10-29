import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect import Page,canonical_url,merge_records,official_url,public_url,EXTRA_DOMAINS,decode

class CollectorTests(unittest.TestCase):
    def test_relative_links_and_hidden_scripts(self):
        p=Page('https://school.edu.cn/jobs/list.htm')
        p.feed('<script>伪造经济学招聘</script><p>2026年公开招聘</p><a href="../notice?id=1&amp;utm_source=x">经济学博士岗位</a><table><tr><td>博士</td><td>区域经济学</td></tr></table>')
        self.assertNotIn('伪造',p.text)
        self.assertEqual(p.links[0]['url'],'https://school.edu.cn/notice?id=1&utm_source=x')
        self.assertIn('区域经济学',p.rows[0])
    def test_canonical_keeps_job_ids(self):
        self.assertEqual(canonical_url('https://school.edu.cn/a?id=2&utm_source=x#top'),'https://school.edu.cn/a?id=2')
        self.assertNotEqual(canonical_url('https://school.edu.cn/a?id=2'),canonical_url('https://school.edu.cn/a?id=3'))
    def test_gb18030(self):
        self.assertEqual(decode('经济学招聘'.encode('gb18030')),'经济学招聘')
    def test_official_domains_and_private_addresses(self):
        self.assertTrue(official_url('https://hrss.gd.gov.cn/a'))
        self.assertFalse(official_url('https://school.edu.cn.evil.com/a'))
        with self.assertRaises(ValueError):public_url('http://127.0.0.1/a')
        with self.assertRaises(ValueError):public_url('file:///etc/passwd')
        EXTRA_DOMAINS.add('gdass.org');self.assertTrue(official_url('https://www.gdass.org/'))
    def test_reviewed_rows_override_leads_without_collapsing_distinct_positions(self):
        common={'url':'https://school.edu.cn/a','institution':'大学','region':'广东','title':'招聘','firstSeenAt':'yesterday'}
        reviewed=[{**common,'id':'r1','positionCode':'01'},{**common,'id':'r2','positionCode':'02'}]
        self.assertEqual(merge_records(reviewed,[],[{**common,'id':'auto'}]),[])
    def test_unchanged_first_seen_and_cross_source_dedupe(self):
        old={'id':'old','url':'https://school.edu.cn/a','institution':'大学','region':'广东','title':'长期招聘','firstSeenAt':'yesterday'}
        new={**old,'id':'new','url':'https://other.edu.cn/a','firstSeenAt':'today'}
        rows=merge_records([], [old],[new]);self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['firstSeenAt'],'yesterday');self.assertIn(old['url'],rows[0]['alternateUrls'])
    def test_confirmed_irrelevant_announcements_stay_excluded(self):
        j={'id':'x','url':'https://school.edu.cn/a','institution':'大学','region':'广东','title':'招聘'}
        self.assertEqual(merge_records([], [j],[j],excluded=[j['url']]),[])

if __name__=='__main__':unittest.main()
