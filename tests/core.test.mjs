import test from 'node:test';
import assert from 'node:assert/strict';
import {shanghaiDate,jobStatus,statistics,filterJobs,matchNotes,toCSV,toICS,daysUntil} from '../core.js';
const now=new Date('2026-10-29T12:00:00+08:00');
const base={id:'one',institution:'测试研究院',region:'广东',city:'广州',type:'政府科研院所',title:'经济学研究岗',kind:'faculty',url:'https://example.gov.cn/notice',majors:['应用经济学'],verifiedLevel:'position',verifiedAt:'2026-10-29T09:00:00+08:00',deadline:'2026-11-10',requirements:{}};

test('Deadline closes in Shanghai time; date-only deadlines include the whole day',()=>{
 assert.equal(shanghaiDate(new Date('2026-10-29T18:00:00Z')),'2026-10-30');
 assert.equal(jobStatus({...base,deadline:'2026-10-29'},new Date('2026-10-29T23:59:00+08:00')),'open');
 assert.equal(jobStatus({...base,deadline:'2026-10-29'},new Date('2026-10-30T00:00:00+08:00')),'closed');
 assert.equal(jobStatus({...base,deadline:'2026-10-29T17:00:00+08:00'},new Date('2026-10-29T17:01:00+08:00')),'closed');
});
test('Yearly and unreviewed announcements never become confirmed open positions',()=>{
 assert.equal(jobStatus({...base,deadline:null},now),'unknown');
 assert.equal(jobStatus({...base,verifiedLevel:'lead'},now),'lead');
 assert.equal(jobStatus({...base,reviewNeeded:true},now),'review');
 assert.equal(jobStatus({...base,verifiedAt:'2026-09-01T10:00:00+08:00'},now),'stale');
 assert.equal(jobStatus({...base,rolling:true},now),'rolling');
});
test('Stats separate headcounts, positions, postdocs, unknowns and expired records',()=>{
 const s=statistics([base,{...base,id:'two',headcount:4},{...base,id:'three',kind:'postdoc',headcount:8},{...base,id:'four',verifiedLevel:'lead',headcount:99},{...base,id:'five',deadline:'2026-04-30',headcount:2}],now);
 assert.equal(s.current,2);assert.equal(s.headcount,4);assert.equal(s.unknownHeadcount,1);assert.equal(s.postdoc,1);assert.equal(s.leads,1);
});
test('Undated rolling jobs are not falsely reported as expiring in fourteen days',()=>{
 const j={...base,deadline:null,rolling:true};assert.ok(Number.isNaN(daysUntil(null,now)));
 assert.equal(filterJobs([j],{focus:'soon'}, {}, {},now).length,0);
 assert.equal(statistics([j],now).soon,0);
});
test('Party membership is checked only against an explicitly supplied profile',()=>{
 const j={...base,type:'党校',requirements:{party:'required'}};
 assert.ok(matchNotes(j,{party:'unknown'}).some(n=>n.level==='check'));
 assert.ok(!matchNotes(j,{party:'unknown'}).some(n=>n.level==='blocked'));
 assert.equal(filterJobs([j],{hideBlocked:true},{},{party:'no'},now).length,0);
 assert.equal(filterJobs([j],{hideBlocked:true},{},{party:'yes'},now).length,1);
});
test('Regional, institution, saved and postdoc filters compose correctly',()=>{
 const jobs=[base,{...base,id:'two',region:'江苏',type:'党校'},{...base,id:'three',kind:'postdoc'}];
 assert.equal(filterJobs(jobs,{region:'广东',kind:'formal'}, {},{},now).length,1);
 assert.equal(filterJobs(jobs,{focus:'party'}, {},{},now)[0].id,'two');
 assert.equal(filterJobs(jobs,{saved:true},{three:{stage:'applied'}},{},now)[0].id,'three');
});
test('CSV is UTF-8 BOM, quotes embedded separators and neutralizes formulas',()=>{
 const csv=toCSV([{...base,institution:'=HYPERLINK("x")',title:'研究,教学'}],now);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));assert.ok(csv.includes('"研究,教学"'));
});
test('Party overview puts current opportunities before leads and closed records, with Guangdong first within each group',()=>{
 const jobs=[{...base,id:'closed-gd',type:'党校',closed:true},{...base,id:'lead-gd',type:'党校',verifiedLevel:'lead'},{...base,id:'open-zj',type:'党校',region:'浙江'},{...base,id:'postdoc-gd',type:'党校',kind:'postdoc'}];
 assert.deepEqual(filterJobs(jobs,{focus:'party',status:'all',kind:'all',sort:'priority'},{},{},now).map(j=>j.id),['postdoc-gd','open-zj','lead-gd','closed-gd']);
});
test('Calendar includes current deadlines only and folds UTF-8 safely',()=>{
 const ics=toICS([base,{...base,id:'old',deadline:'2026-04-30'},{...base,id:'lead',verifiedLevel:'lead'}],now);
 assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,1);assert.ok(ics.includes('DTSTART;VALUE=DATE:20261110'));assert.ok(ics.includes('DTEND;VALUE=DATE:20261111'));
 for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
