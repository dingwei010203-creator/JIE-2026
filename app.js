import {REGIONS,TYPES,LABELS,shanghaiDate,daysUntil,jobStatus,isCurrent,matchNotes,filterJobs,statistics,toCSV,toICS} from './core.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=v=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}};
const icons={
  radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l7-7"/><circle cx="12" cy="12" r="1"/>',
  bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>',
  chart:'<path d="M4 4v16h17M8 16v-5m5 5V7m5 9V4"/>',
  layers:'<path d="M12 3l10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM9 3h6l.8 3 2.7-.2 3 5-2 2 1 2-3 5-3-.7-1.5 2h-5l-1-2.5-3 .1-3-5 1.5-2-1-2 3-5 3 .5z"/>',
  github:'<path d="M9 19c-4 1-4-2-6-2m12 5v-4a3.5 3.5 0 0 0-1-2.5c3-.3 6-1.5 6-6a4.7 4.7 0 0 0-1.3-3.3 4.3 4.3 0 0 0-.1-3.2S17.5 2.6 15 4a12 12 0 0 0-6 0C6.5 2.6 5.4 3 5.4 3a4.3 4.3 0 0 0-.1 3.2A4.7 4.7 0 0 0 4 9.5c0 4.5 3 5.7 6 6A3.5 3.5 0 0 0 9 18v4"/>',
  refresh:'<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 4h2"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  sort:'<path d="M4 6h15M4 12h10M4 18h5m9-7v9m-3-3 3 3 3-3"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  'check-square':'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  location:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
  arrow:'<path d="M7 17 18 6M7 6h11v11"/>',
  briefcase:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c5 3 13 3 18 0m-9 0v4"/>',
  building:'<path d="M4 21V7l8-4 8 4v14H4M9 21v-5h6v5M8 9h1m6 0h1m-8 3h1m6 0h1"/>',
  warning:'<path d="m12 3 10 18H2zM12 9v5m0 3v.1"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  empty:'<path d="M4 9h16l2 12H2zM4 9l4-6h8l4 6M8 13v4h8v-4"/>',
};
const icon=(name)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.info}</svg>`;
for(const node of $$('[data-icon]')) node.innerHTML=icon(node.dataset.icon);

const storage={get(k,fallback){try{return JSON.parse(localStorage.getItem(k))??fallback;}catch{return fallback;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{toast('浏览器未允许保存，当前设置仅本次有效');return false;}}};
const defaultFilters={region:'广东',type:'all',kind:'formal',status:'current',sort:'priority',query:'',focus:'all'};
const viewFilters={jobs:{...defaultFilters},saved:{...defaultFilters,region:'all',kind:'all',status:'all'}};
const state={feed:null,sources:[],config:{},view:'jobs',filters:viewFilters.jobs,saved:storage.get('econ-sister:saved',{}),profile:storage.get('econ-sister:profile',{year:'2026',party:'unknown',age:'',experience:'none',overseas:'yes',hideBlocked:false}),visible:[],detailId:null};
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2600);}
const formatTime=iso=>iso?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)):'尚未运行';
const formatDate=iso=>iso?iso.slice(0,10).replaceAll('-','.'): '未明确';
const sourceLabel=job=>job.urlType==='listing'?'单位官网':job.sourceAuthority==='university-repost'?'高校转载':'官方公告';

function renderHeader(){
  $('#today').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());
  $('#verified-date').textContent=state.feed.lastVerifiedAt?formatDate(state.feed.lastVerifiedAt):'尚未核验';
  $('#scan-status').textContent=state.feed.lastScanCompletedAt?`最近扫描 ${formatTime(state.feed.lastScanCompletedAt)}`:'官方扫描尚未完成';
  $('#configured-count').textContent=state.sources.length;
  if(state.config.repositoryUrl){
    $('#github-link').hidden=false;$('#github-link').href=safeURL(state.config.repositoryUrl);
    $('#actions-link').hidden=false;$('#actions-link').href=safeURL(state.config.repositoryUrl+'/actions');
  }
  $('#schedule-note').textContent=state.config.workflowEnabled?'GitHub 每日定时触发，也可手动运行。平台调度可能有延迟，实际完成时间以运行记录为准。':'每日采集与部署流程已准备；新 GitHub 仓库启用后开始定时运行。当前仅展示已完成的核验和扫描。';
  const age=state.feed.lastScanCompletedAt?(Date.now()-Date.parse(state.feed.lastScanCompletedAt))/3600000:Infinity;
  const s=state.feed.scanSummary||{};
  const text=[];
  if(!state.config.workflowEnabled) text.push('首次部署准备中：每日更新尚未启用。');
  if(age>30) text.push('最近扫描已超过30小时或尚未完成，请核对来源页的运行状态。');
  if(s.failed) text.push(`${s.failed} 个来源本次未能完成扫描，仍保留此前记录。`);
  if(s.unattempted) text.push(`${s.unattempted} 个配置来源尚未完成本轮扫描。`);
  $('#feed-notice').hidden=!text.length;$('#feed-notice').textContent=text.join(' ');
}

function renderMetrics(){
  const s=statistics(state.feed.jobs);
  const items=[
    {name:'报名期内 / 滚动岗位',value:s.current,unit:'条',note:`${s.postdoc} 条博士后单独展示`,ico:'briefcase'},
    {name:'广东教研 / 科研',value:s.guangdong,unit:'条',note:'优先关注 · 不含博士后',ico:'location'},
    {name:'党校与科研 · 报名期内',value:s.focused,unit:'条',note:'已核验教研岗位 · 博士后另列',ico:'building'},
    {name:'待核验 / 待复核',value:s.leads,unit:'条',note:'未计入报名期内岗位',ico:'layers'},
  ];
  $('#metrics').innerHTML=items.map(m=>`<div class="metric"><div class="metric-icon">${icon(m.ico)}</div><p class="metric-name">${m.name}</p><div class="metric-value"><b>${m.value}</b><small>${m.unit}</small></div><p class="metric-note">${esc(m.note)}</p></div>`).join('');
  renderBars($('#region-bars'),s.regions,true);
  $('#saved-count').textContent=Object.keys(state.saved).filter(id=>state.feed.jobs.some(j=>j.id===id)).length;
}

function renderBars(target,rows,clickable=false){
  const max=Math.max(1,...rows.map(x=>x.count));
  target.innerHTML=rows.map(r=>`<div class="bar-row"><div class="bar-info">${clickable?`<button data-region-pick="${esc(r.name)}" style="padding:0;font-size:inherit">${esc(r.name)}</button>`:`<span>${esc(r.name)}</span>`}<b>${r.count} <small>条</small></b></div><div class="bar-track" role="img" aria-label="${esc(r.name)} ${r.count}条"><div class="bar-fill" style="width:${r.count/max*100}%"></div></div></div>`).join('');
}

function syncFilters(){
  for(const key of ['region','type','kind','status','sort']) $('#'+key).value=state.filters[key];
  $('#search').value=state.filters.query;
  for(const b of $$('[data-focus]')){b.classList.toggle('selected',b.dataset.focus===state.filters.focus);b.setAttribute('aria-pressed',String(b.dataset.focus===state.filters.focus));}
}

function card(job){
  const status=jobStatus(job),saved=!!state.saved[job.id],days=daysUntil(job.deadline);
  const fresh=job.publishedAt && daysUntil(job.publishedAt)>=-7 && daysUntil(job.publishedAt)<=0;
  const typeClass=job.type==='党校'?'party':job.type==='职业院校'?'vocational':['社科院','政府科研院所'].includes(job.type)?'research':'';
  const note=matchNotes(job,state.profile).find(n=>n.level==='blocked')||matchNotes(job,state.profile)[0];
  const deadline=job.deadline?`${formatDate(job.deadline)} 截止${days>=0&&days<=14?' · 还剩'+days+'天':''}`:'截止日期待核验';
  return `<article class="job-card ${job.region==='广东'&&['党校','政府科研院所'].includes(job.type)?'highlight':''}" data-job-id="${esc(job.id)}">
    <div class="job-card-top"><div class="job-top-meta"><span class="type-badge ${typeClass}">${esc(job.type)}</span>${job.kind==='postdoc'?'<span class="kind-badge">博士后</span>':''}${fresh?'<span class="new-badge">NEW · 近期发布</span>':''}</div><button class="save-button ${saved?'saved':''}" data-save="${esc(job.id)}" aria-label="${saved?'取消收藏':'收藏'}${esc(job.institution)}${esc(job.title)}" aria-pressed="${saved}">${icon('bookmark')}</button></div>
    <h3 class="institution">${esc(job.institution)}</h3><p class="job-title">${esc(job.title)}</p>
    <div class="job-meta"><span>${icon('location')}${esc(job.city||job.region)}</span><span>${icon('briefcase')}${job.headcount?`原计划 ${job.headcount} 人`:'人数未明确'}</span><span>${icon('calendar')}${esc(deadline)}</span></div>
    ${(job.majors||[]).length?`<div class="major-tags">${job.majors.slice(0,4).map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}
    <p class="job-summary">${esc(job.summary)}</p>
    ${note?`<div class="job-note">${icon(note.level==='blocked'?'warning':'info')}<span>${esc(note.text)}</span></div>`:''}
    <div class="job-card-foot"><span class="status ${status}">${LABELS[status]}</span><div class="card-actions">${state.view==='saved'?applicationSelect(job):''}<button class="detail-button" data-detail="${esc(job.id)}">查看详情</button><a class="official-link" href="${esc(safeURL(job.url))}" target="_blank" rel="noopener noreferrer">${sourceLabel(job)} ${icon('arrow')}</a></div></div>
  </article>`;
}

function applicationSelect(job){const value=state.saved[job.id]?.stage||'follow';return `<select class="application-select" aria-label="${esc(job.institution)}投递进度" data-stage="${esc(job.id)}">${[['follow','关注中'],['preparing','准备材料'],['applied','已投递'],['interview','面试中'],['done','已结束']].map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('')}</select>`;}

function renderJobs(){
  const f={...state.filters,saved:state.view==='saved',hideBlocked:state.profile.hideBlocked};
  state.visible=filterJobs(state.feed.jobs,f,state.saved,state.profile);
  $('#listing-count').textContent=state.visible.length;
  $('#listing-title').firstChild.textContent=state.view==='saved'?'我的清单 ':'岗位雷达 ';
  const party=state.feed.jobs.filter(j=>j.type==='党校'),partyStats=statistics(party);
  $('#listing-description').textContent=state.view==='saved'?'收藏与投递进度保存在当前浏览器。':f.focus==='party'||f.type==='党校'?`四地已收录 ${party.length} 条党校记录：报名期内教研 ${partyStats.current} 条、博士后 ${partyStats.postdoc} 条、待核 ${partyStats.leads} 条。广东优先排序，滚动岗位须确认剩余名额。`:'广东优先，兼顾党校、政策研究与教学机会。';
  const brief=[f.region==='all'?'四地':f.region,f.kind==='formal'?'教研 / 科研':f.kind==='postdoc'?'博士后':'全部岗位',f.status==='current'?'报名期内及滚动招聘':f.status==='closed'?'历史记录':f.status==='review'?'待核验及待复核':'所选状态'].join(' · ');
  $('#active-filters').innerHTML=`<span>${esc(brief)}</span><button id="reset-filters">重置筛选</button>`;
  $('#job-list').innerHTML=state.visible.length?state.visible.map(card).join(''):`<div class="empty">${icon('empty')}<h3>${state.view==='saved'?'清单里还没有这些岗位':'这个筛选下暂无已核验岗位'}</h3><p>${state.view==='saved'?'在岗位卡片上点击书签即可收藏，也可以调整筛选查看其他已收藏记录。':'可以查看待核验线索，或扩大至其他地区。暂无结果不代表当地没有招聘。'}</p><button class="primary-button" data-empty-action="all">查看四地全部记录</button></div>`;
  $('#export-ics').disabled=!state.visible.some(j=>j.deadline&&isCurrent(j));
}

function renderStats(){
  const s=statistics(state.feed.jobs);
  renderBars($('#stats-regions'),s.regions);renderBars($('#stats-types'),s.types);
  const rows=REGIONS.map(region=>{
    const list=state.feed.jobs.filter(j=>j.region===region),a=statistics(list);
    return `<tr><td><b>${region}</b></td><td>${a.current}</td><td>${a.headcount}${a.unknownHeadcount?` <span class="muted">+ ${a.unknownHeadcount}条人数不详</span>`:''}</td><td>${a.postdoc}</td><td>${a.leads}</td><td>${list.filter(j=>jobStatus(j)==='closed').length}</td></tr>`;
  });
  $('#stats-table').innerHTML=`<h3>四地岗位明细</h3><div style="overflow-x:auto"><table class="data-table"><thead><tr><th>地区</th><th>当前教研 / 科研条目</th><th>原计划人数（已明确）</th><th>当前博士后</th><th>待核验 / 待复核</th><th>已截止</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="muted" style="margin-top:15px">原计划人数不是剩余名额。相近专业是否可报、应届及港澳学历资格须以单位审核为准。</p>`;
}

function renderSources(){
  const summary=state.feed.scanSummary||{};
  $('#health-summary').innerHTML=[['已配置',state.sources.length,''],['入口扫描成功',summary.ok||0,''],['部分完成',summary.partial||0,'partial'],['未能完成',(summary.failed||0),'error'],['未扫描',(summary.unattempted??state.sources.length),'planned']].map(([label,value,style])=>`<div class="health-item ${style}">${label}<b>${value}</b></div>`).join('');
  const region=$('#source-region').value,search=$('#source-search').value.trim().toLowerCase();
  const logs=new Map((state.feed.sourceHealth||[]).map(x=>[x.id,x]));
  const statusNames={ok:'入口扫描成功',partial:'部分完成',error:'未能完成',needs_js:'需浏览器复查',planned:'尚未扫描'};
  const rows=state.sources.filter(s=>(region==='all'||s.region===region)&&(!search||[s.institution,s.type,s.city].join(' ').toLowerCase().includes(search))).sort((a,b)=>b.priority-a.priority);
  $('#source-rows').innerHTML=rows.length?rows.map(s=>{const log=logs.get(s.id),status=log?.status||'planned';return `<tr><td><a href="${esc(safeURL(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.institution)} ↗</a><p class="muted">${esc(new URL(s.url).hostname)}</p></td><td>${esc(s.region)}<p class="muted">${esc(s.type)}</p></td><td><span class="health-pill ${status}">${statusNames[status]}</span><p class="muted">${log?esc(formatTime(log.checkedAt)):''}</p></td><td><p class="source-scope">${esc(log?.scope||(s.mode==='homepage'?'将从官网查找招聘栏目':'将扫描已配置官方栏目'))}</p>${log?.errors?.length?`<p class="source-error">${esc(log.errors[0])}</p>`:''}</td></tr>`;}).join(''):'<tr><td colspan="4" class="muted">没有符合条件的来源。</td></tr>';
  $('#search-health').innerHTML=state.feed.searchHealth?.length?state.feed.searchHealth.map(q=>`<div class="query-row"><span>${esc(q.query)}</span><span>${q.status==='ok'?`已补查 · ${q.results} 条线索`:'未完成 · '+esc(q.error||'待复查')}</span></div>`).join(''):'<p class="muted" style="padding-top:12px">本轮尚未执行关键词补查；已有官方栏目扫描结果仍可查看。</p>';
  $('#related-updates').innerHTML=state.feed.relatedUpdates?.length?state.feed.relatedUpdates.map(u=>`<div class="related-row"><a href="${esc(safeURL(u.url))}" target="_blank" rel="noopener noreferrer">${esc(u.title)} ↗</a><span class="muted">${esc(u.region)}</span></div>`).join(''):'<p class="muted" style="padding-top:12px">本轮未记录相关后续公告；未扫描到不代表不存在。</p>';
}

function render(){if(!state.feed)return;renderHeader();renderMetrics();syncFilters();renderJobs();renderStats();renderSources();}

function setView(view){
  if(view==='party'){view='jobs';Object.assign(viewFilters.jobs,{...defaultFilters,region:'all',kind:'all',status:'all',focus:'party'});}
  if(!['jobs','saved','stats','sources'].includes(view))view='jobs';
  state.view=view;
  if(view==='jobs'||view==='saved')state.filters=viewFilters[view];
  const labels={jobs:'岗位雷达',saved:'我的清单',stats:'地区统计',sources:'来源与更新'};
  $('#view-title').textContent=labels[view];
  $('#view-jobs').hidden=!['jobs','saved'].includes(view);$('#view-stats').hidden=view!=='stats';$('#view-sources').hidden=view!=='sources';
  for(const a of $$('[data-nav]')){a.classList.toggle('active',a.dataset.nav===view);if(a.dataset.nav===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');}
  if(state.feed){syncFilters();renderJobs();renderSources();}
}

function toggleSave(id){
  if(state.saved[id])delete state.saved[id];else state.saved[id]={stage:'follow',savedAt:new Date().toISOString()};
  storage.set('econ-sister:saved',state.saved);renderMetrics();renderJobs();
  if($('#job-dialog').open&&state.detailId===id)renderDetail(id);
  toast(state.saved[id]?'已加入我的清单':'已取消收藏');
}

function renderDetail(id){
  const job=state.feed.jobs.find(j=>j.id===id);if(!job)return;
  state.detailId=id;const status=jobStatus(job),r=job.requirements||{},notes=matchNotes(job,state.profile);
  const labels={education:'学历要求',freshGraduate:'应届要求',partyText:'政治面貌',ageText:'年龄要求',overseas:'港澳 / 境外学历',experienceText:'工作经历',firstDegree:'第一学历',research:'科研要求',employment:'用工方式'};
  const requirements=Object.entries(labels).filter(([k])=>r[k]).map(([k,v])=>`<li><b>${v}：</b>${esc(r[k])}</li>`).join('');
  $('#job-detail').innerHTML=`<div class="dialog-top"><span class="type-badge">${esc(job.type)} · ${job.kind==='postdoc'?'博士后':'教研 / 科研'}</span><button class="icon-button close-dialog" aria-label="关闭">×</button></div><h2 class="detail-title" id="detail-title">${esc(job.institution)}</h2><p class="detail-subtitle">${esc(job.title)}</p><div class="detail-meta"><span>${esc(job.city||job.region)}</span><span>${job.headcount?'原计划 '+job.headcount+' 人':'岗位人数未明确'}</span><span class="status ${status}">${LABELS[status]}</span></div><p class="muted">${esc(job.summary)}</p>
  <section class="detail-section"><h3>时间与岗位边界</h3><ul><li>发布日期：${formatDate(job.publishedAt)}；截止日期：${formatDate(job.deadline)}${job.deadline?.includes('T')?' '+esc(job.deadline.slice(11,16))+'（北京时间）':''}。</li><li>具体岗位 / 代码：${esc(job.positionCode||'详见公告及附件')}；专业：${esc((job.majors||[]).join('、')||'对应岗位专业待核验')}。</li><li>主管关系：${esc(job.affiliation||'需结合单位简介与公告确认')}。</li><li>剩余名额：${esc(job.remainingVacancies||'未核实，请联系招聘单位')}。</li></ul></section>
  <section class="detail-section"><h3>招聘条件</h3>${requirements?`<ul>${requirements}</ul>`:'<p>尚未完成对应岗位逐项核验，请查看官方正文和岗位表。</p>'}</section>
  <section class="detail-section"><h3>与你当前条件有关的提示</h3>${notes.length?`<ul>${notes.map(n=>`<li class="${n.level==='blocked'?'blocked':''}">${esc(n.text)}</li>`).join('')}</ul>`:'<p>尚无明确资格结论，请核对具体专业、成果及材料要求。</p>'}</section>
  <section class="detail-section"><h3>核验记录与依据</h3><p>最近实质核验：${job.verifiedAt?esc(formatTime(job.verifiedAt)):'尚未逐项核验'}${job.verifiedAt?' · '+esc(job.verifiedAt.slice(0,4))+'年':''}。${job.verifiedLevel==='position'?'已核对具体经济学博士岗位。':'当前为公告或线索，未计入已核验岗位。'}</p>${(job.evidence||[]).map(e=>`<p class="evidence">${esc(e.note)}${e.url?` <a href="${esc(safeURL(e.url))}" target="_blank" rel="noopener noreferrer">查看依据 ↗</a>`:''}</p>`).join('')}${(job.evidenceHints||[]).slice(0,3).map(e=>`<p class="evidence">自动提取线索：${esc(e)}</p>`).join('')}${(job.attachments||[]).map(a=>`<p style="margin-top:8px"><a class="official-link" href="${esc(safeURL(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.label)} ↗</a></p>`).join('')}</section>
  <div class="detail-bottom"><a class="primary-button" href="${esc(safeURL(job.url))}" target="_blank" rel="noopener noreferrer">查看${sourceLabel(job)} ${icon('arrow')}</a><button class="small-button" data-save="${esc(id)}">${icon('bookmark')}${state.saved[id]?'已收藏 · 点击取消':'加入我的清单'}</button>${job.deadline&&isCurrent(job)?`<button class="small-button" data-calendar="${esc(id)}">${icon('calendar')}导出截止日</button>`:''}</div>`;
}

function openProfile(){
  const form=$('#profile-form');for(const key of ['year','party','age','experience','overseas'])form.elements[key].value=state.profile[key]??'';
  form.elements.hideBlocked.checked=!!state.profile.hideBlocked;$('#profile-dialog').showModal();
}

function download(text,name,type){const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-save]');if(b){toggleSave(b.dataset.save);return;}
  const d=e.target.closest('[data-detail]');if(d){renderDetail(d.dataset.detail);$('#job-dialog').showModal();return;}
  if(e.target.closest('.close-dialog')){e.target.closest('dialog').close();return;}
  const focus=e.target.closest('[data-focus]');if(focus){if(focus.dataset.focus==='party'){location.hash='party';setView('party');return;}state.filters.focus=focus.dataset.focus;syncFilters();renderJobs();return;}
  const shortcut=e.target.closest('[data-shortcut]');if(shortcut){if(shortcut.dataset.shortcut==='party'){location.hash='party';setView('party');return;}state.filters.focus=shortcut.dataset.shortcut;state.filters.region='广东';state.filters.status='review';state.filters.kind='all';syncFilters();renderJobs();return;}
  const region=e.target.closest('[data-region-pick]');if(region){location.hash='jobs';setView('jobs');state.filters.region=region.dataset.regionPick;syncFilters();renderJobs();return;}
  const cal=e.target.closest('[data-calendar]');if(cal){download(toICS(state.feed.jobs.filter(j=>j.id===cal.dataset.calendar)),'econ-careers-deadline.ics','text/calendar;charset=utf-8');return;}
  if(e.target.closest('#reset-filters')){Object.assign(state.filters,state.view==='saved'?{...defaultFilters,region:'all',kind:'all',status:'all'}:defaultFilters);syncFilters();renderJobs();return;}
  if(e.target.closest('[data-empty-action]')){location.hash='jobs';setView('jobs');Object.assign(state.filters,{...defaultFilters,region:'all',kind:'all',status:'all'});syncFilters();renderJobs();}
});

for(const key of ['region','type','kind','status','sort'])$('#'+key).addEventListener('change',e=>{state.filters[key]=e.target.value;renderJobs();});
$('#search').addEventListener('input',e=>{state.filters.query=e.target.value;renderJobs();});
$('#source-search').addEventListener('input',renderSources);$('#source-region').addEventListener('change',renderSources);
$('#job-list').addEventListener('change',e=>{if(e.target.dataset.stage){const id=e.target.dataset.stage;state.saved[id]={...state.saved[id],stage:e.target.value};storage.set('econ-sister:saved',state.saved);toast('投递进度已保存');}});
$('#profile-open').addEventListener('click',openProfile);$('#profile-open-2').addEventListener('click',openProfile);
$('#profile-form').addEventListener('submit',e=>{e.preventDefault();const form=e.target;state.profile={year:form.elements.year.value,party:form.elements.party.value,age:form.elements.age.value,experience:form.elements.experience.value,overseas:form.elements.overseas.value,hideBlocked:form.elements.hideBlocked.checked};storage.set('econ-sister:profile',state.profile);$('#profile-dialog').close();renderJobs();toast('求职条件已保存');});
$('#export-csv').addEventListener('click',()=>download(toCSV(state.visible),`econ-careers-${shanghaiDate()}.csv`,'text/csv;charset=utf-8'));
$('#stats-export').addEventListener('click',()=>download(toCSV(state.feed.jobs),`econ-careers-all-${shanghaiDate()}.csv`,'text/csv;charset=utf-8'));
$('#export-ics').addEventListener('click',()=>{download(toICS(state.visible),`econ-careers-deadlines-${shanghaiDate()}.ics`,'text/calendar;charset=utf-8');toast('截止日历已导出，请在日历应用中导入');});
window.addEventListener('hashchange',()=>setView(location.hash.slice(1)));
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!$('dialog[open]')){e.preventDefault();location.hash='jobs';setView('jobs');$('#search').focus();}});
for(const dialog of $$('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});

try{
  const response=await Promise.all(['./data/feed.json','./data/sources.json','./data/site.json'].map(async u=>{const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(`文件载入失败：${u}（${r.status}）`);return r.json();}));
  state.feed=response[0];state.sources=response[1].sources;state.config=response[2];
  if(!Array.isArray(state.feed.jobs)||!Array.isArray(state.sources))throw new Error('岗位数据格式有误，请检查更新记录');
  render();setView(location.hash.slice(1)||'jobs');
  let lastDay=shanghaiDate();setInterval(()=>{const day=shanghaiDate();if(day!==lastDay){lastDay=day;render();}},60000);
}catch(err){$('#job-list').innerHTML=`<div class="empty">${icon('warning')}<h3>岗位数据暂时无法载入</h3><p>${esc(err.message)}。请刷新页面，或检查 GitHub 的最近部署记录。</p><button class="primary-button" id="retry-load">重新载入</button></div>`;$('#retry-load').addEventListener('click',()=>location.reload());$('#scan-status').textContent='数据载入未完成';$('#feed-notice').hidden=false;$('#feed-notice').textContent='页面尚未取得有效岗位数据；当前不显示统计结果。';}
