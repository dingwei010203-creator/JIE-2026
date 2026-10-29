export const REGIONS = ['广东', '江苏', '浙江', '北京'];
export const TYPES = ['党校', '政府科研院所', '社科院', '普通高校', '职业院校'];
export const LABELS = {open:'报名期内',rolling:'滚动招聘 · 核实名额',upcoming:'尚未开始',unknown:'日期待核验',closed:'已截止',lead:'待核验线索',review:'原文变更 · 待复核',stale:'信息需复核'};

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}

export function deadlineMs(value) {
  if (!value) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999+08:00` : value);
}

export function daysUntil(value, now = new Date()) {
  const target = value?.slice(0,10);
  return target ? Math.round((Date.parse(`${target}T00:00:00+08:00`)-Date.parse(`${shanghaiDate(now)}T00:00:00+08:00`))/86400000) : NaN;
}

export function jobStatus(job, now = new Date()) {
  if (job.closed || (job.deadline && deadlineMs(job.deadline) < +now)) return 'closed';
  if (job.verifiedLevel !== 'position') return 'lead';
  if (job.reviewNeeded) return 'review';
  if (job.startDate && Date.parse(`${job.startDate}T00:00:00+08:00`) > +now) return 'upcoming';
  if (job.verifiedAt && (+now-Date.parse(job.verifiedAt))/86400000 > 14) return 'stale';
  if (job.rolling) return 'rolling';
  if (job.deadline) return 'open';
  return 'unknown';
}

export function isCurrent(job, now = new Date()) { return ['open','rolling'].includes(jobStatus(job,now)); }

export function priority(job) {
  return (job.region==='广东'?100:0)+(job.type==='党校'?30:job.type==='政府科研院所'?28:job.type==='社科院'?20:0)+(job.kind==='postdoc'?-12:0);
}

export function matchNotes(job, profile={}) {
  const notes=[];
  const q=job.requirements||{};
  if(q.party==='required' && profile.party!=='yes') notes.push({level:profile.party==='no'?'blocked':'check',text:profile.party==='no'?'要求中共党员，当前条件不符':'要求中共党员，需确认政治面貌'});
  if(q.experience==='required' && profile.experience==='none') notes.push({level:'blocked',text:'要求工作经历，不适合无工作经历应届生'});
  if(q.seniorTitle) notes.push({level:'blocked',text:'要求高级职称或资深经历'});
  if(q.only2027 && profile.year==='2026') notes.push({level:'blocked',text:'限2027届，需确认2026届是否另有通道'});
  if(q.ageLimit) notes.push({level:'check',text:profile.age && Number(profile.age)>q.ageLimit?`当前填写年龄超过${q.ageLimit}周岁，请按公告基准日复核`:`年龄上限${q.ageLimit}周岁，以公告基准日计算`});
  if(profile.overseas!=='no') notes.push({level:'check',text:q.overseas||'港澳学历认证及专业对应关系需确认'});
  if(q.firstDegree) notes.push({level:'check',text:q.firstDegree});
  if(q.research) notes.push({level:'check',text:q.research});
  return notes;
}

export function filterJobs(jobs, f={}, saved={}, profile={}, now=new Date()) {
  const query=(f.query||'').trim().toLowerCase();
  return jobs.filter(j=>{
    const status=jobStatus(j,now);
    if(f.region && f.region!=='all' && j.region!==f.region) return false;
    if(f.type && f.type!=='all' && j.type!==f.type) return false;
    if(f.city && f.city!=='all' && !j.city?.includes(f.city)) return false;
    if(f.kind==='formal' && j.kind==='postdoc') return false;
    if(f.kind==='postdoc' && j.kind!=='postdoc') return false;
    if(f.status==='current' && !['open','rolling'].includes(status)) return false;
    if(f.status==='open' && status!=='open') return false;
    if(f.status==='review' && !['lead','unknown','review','stale'].includes(status)) return false;
    if(f.status==='closed' && status!=='closed') return false;
    if(f.saved && !saved[j.id]) return false;
    if(f.hideBlocked && matchNotes(j,profile).some(n=>n.level==='blocked')) return false;
    if(f.focus==='party' && j.type!=='党校') return false;
    if(f.focus==='research' && !['政府科研院所','社科院'].includes(j.type)) return false;
    if(f.focus==='soon' && !(isCurrent(j,now) && daysUntil(j.deadline,now)>=0 && daysUntil(j.deadline,now)<=14)) return false;
    if(query && ![j.institution,j.title,j.city,j.type,...(j.majors||[]),j.summary].join(' ').toLowerCase().includes(query)) return false;
    return true;
  }).sort((a,b)=>{
    if(f.sort==='deadline') return (deadlineMs(a.deadline)||Infinity)-(deadlineMs(b.deadline)||Infinity);
    if(f.sort==='newest') return (b.publishedAt||'').localeCompare(a.publishedAt||'');
    const statusRank=j=>isCurrent(j,now)?0:jobStatus(j,now)==='closed'?2:1;
    const statusOrder=statusRank(a)-statusRank(b);
    if(statusOrder) return statusOrder;
    return priority(b)-priority(a) || (b.publishedAt||'').localeCompare(a.publishedAt||'');
  });
}

export function statistics(jobs, now=new Date()) {
  const current=jobs.filter(j=>isCurrent(j,now));
  const formal=current.filter(j=>j.kind!=='postdoc');
  const known=formal.filter(j=>Number.isInteger(j.headcount)&&j.headcount>0);
  return {
    total:jobs.length,current:formal.length,postdoc:current.filter(j=>j.kind==='postdoc').length,
    guangdong:formal.filter(j=>j.region==='广东').length,
    focused:formal.filter(j=>['党校','政府科研院所','社科院'].includes(j.type)).length,
    leads:jobs.filter(j=>['lead','unknown','review','stale'].includes(jobStatus(j,now))).length,
    headcount:known.reduce((s,j)=>s+j.headcount,0),unknownHeadcount:formal.length-known.length,
    soon:current.filter(j=>daysUntil(j.deadline,now)>=0&&daysUntil(j.deadline,now)<=14).length,
    regions:REGIONS.map(name=>({name,count:formal.filter(j=>j.region===name).length})),
    types:TYPES.map(name=>({name,count:formal.filter(j=>j.type===name).length}))
  };
}

const csvCell=v=>`"${String(v??'').replace(/^[=+\-@]/,"'$&").replaceAll('"','""')}"`;
export function toCSV(jobs,now=new Date()) {
  const rows=[['单位','地区','城市','类型','岗位','岗位类别','招聘人数（原公告）','状态','发布日期','截止日期','专业','核验日期','官方来源']];
  for(const j of jobs) rows.push([j.institution,j.region,j.city,j.type,j.title,j.kind==='postdoc'?'博士后':'教研/科研',j.headcount??'未明确',LABELS[jobStatus(j,now)],j.publishedAt,j.deadline,j.majors?.join('、'),j.verifiedAt?.slice(0,10),j.url]);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}

const icsEscape=s=>String(s||'').replaceAll('\\','\\\\').replaceAll('\n','\\n').replaceAll(';','\\;').replaceAll(',','\\,');
function foldICS(line){
  const out=[]; let piece=''; let bytes=0;
  for(const c of line){const n=new TextEncoder().encode(c).length;if(bytes+n>73){out.push(piece);piece=' ';bytes=1;}piece+=c;bytes+=n;}
  out.push(piece);return out.join('\r\n');
}
export function toICS(jobs,now=new Date()) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Econ PhD Careers//Deadline//ZH','CALSCALE:GREGORIAN','X-WR-CALNAME:经济学博士岗位截止日'];
  const stamp=now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z');
  for(const j of jobs.filter(j=>j.deadline&&isCurrent(j,now))){
    const day=j.deadline.slice(0,10).replaceAll('-','');
    const next=new Date(Date.parse(`${j.deadline.slice(0,10)}T12:00:00Z`)+86400000).toISOString().slice(0,10).replaceAll('-','');
    lines.push('BEGIN:VEVENT',`UID:${j.id}@econ-phd-careers`, `DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${day}`,`DTEND;VALUE=DATE:${next}`,`SUMMARY:${icsEscape('报名截止｜'+j.institution+' '+j.title)}`,`DESCRIPTION:${icsEscape('请核实截止时刻及剩余名额。\n'+j.url)}`,`URL:${j.url}`,'BEGIN:VALARM','TRIGGER:-P3D','ACTION:DISPLAY','DESCRIPTION:岗位报名将截止','END:VALARM','END:VEVENT');
  }
  return [...lines,'END:VCALENDAR'].map(foldICS).join('\r\n')+'\r\n';
}
