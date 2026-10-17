/* Plataforma Jaguar 3: presentación y visualización; conserva control de acceso y rutas existentes. */
(() => {
'use strict';
const MODE_KEY='jaguar_display_mode_v3';
const MODE_ALLOWED=['light','dark'];
function setMode(mode){
  const choice=MODE_ALLOWED.includes(mode)?mode:'light';
  document.documentElement.setAttribute('data-jaguar-mode',choice);
  try{localStorage.setItem(MODE_KEY,choice);}catch{}
  const button=document.getElementById('j-mode');
  if(button){button.textContent=choice==='light'?'☾':'☀';button.title=choice==='light'?'Activar modo oscuro':'Activar modo claro';button.setAttribute('aria-label',button.title)}
}
let saved='light';try{saved=localStorage.getItem(MODE_KEY)||'light'}catch{}
setMode(saved);
window.jaguarToggleMode=()=>setMode(document.documentElement.getAttribute('data-jaguar-mode')==='light'?'dark':'light');
window.jaguarToggleSidebar=()=>{
  const on=!document.querySelector('#app .side')?.classList.contains('is-open');
  document.querySelector('#app .side')?.classList.toggle('is-open',on);
  document.querySelector('#app .j-side-backdrop')?.classList.toggle('is-open',on);
  document.getElementById('j-mobile-menu')?.setAttribute('aria-expanded',String(on));
};
window.jaguarCloseSidebar=()=>{
  document.querySelector('#app .side')?.classList.remove('is-open');
  document.querySelector('#app .j-side-backdrop')?.classList.remove('is-open');
  document.getElementById('j-mobile-menu')?.setAttribute('aria-expanded','false');
};
const iconMap={inicio:'⌂',resumen:'▦',alumnos:'♙',docentes:'♧',grupos:'♟',listas:'☷',materias:'▤',horarios:'▦',horario:'◷',calificaciones:'▥',asistencia:'✓',talleres:'✎',avisos:'♧',usuarios:'♙',revision_acceso:'♢',config:'⚙',perfil:'◉',estadisticas:'▥',reportes:'▥',finanzas:'◫',recursos_monetarios:'◫',departamentos:'▣',solicitudes_taller:'✉',archivo_solicitudes:'▤',planeaciones:'✎',institucion:'♜',encargados:'♧',notificaciones:'♧',credenciales:'▤'};
const cleanLabel=text=>String(text||'').replace(/^[^\p{L}\p{N}]+/u,'').trim()||text;
window.jaguarRenderNav=(items)=>items.map(([id,label])=>{
  const title=cleanLabel(label);
  const active=S.page===id;
  const cleanId=String(id||'').replace(/[^a-z0-9_]/gi,'');
  return `<button class="nav ${active?'active':''}" data-j-page="${cleanId}" aria-current="${active?'page':'false'}" onclick="loadPage('${cleanId}');jaguarCloseSidebar()"><span class="j-nav-ico" aria-hidden="true">${iconMap[id]||'◇'}</span><span class="j-nav-txt">${esc(title)}</span></button>`;
}).join('');
window.jaguarFocusModule=()=>{
  const query=String(document.getElementById('j-module-search')?.value||'').trim().toLowerCase();
  if(!query)return;
  const all=[...document.querySelectorAll('#app #nav .nav')];
  const target=all.find(btn=>btn.textContent.toLowerCase().includes(query));
  if(!target){toast('No hay un módulo visible para tu rol con ese nombre.');return}
  target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});
};
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
    const search=document.getElementById('j-module-search');
    if(search&&document.querySelector('#app:not(.hide)')){e.preventDefault();search.focus()}
  }
  if(e.key==='Escape')window.jaguarCloseSidebar();
});
const safeNum=x=>Number.isFinite(Number(x))&&x!==null&&x!==''?Number(x):null;
const printable=x=>x===null||x===undefined?'—':String(x);
const nice=n=>n===null?'—':new Intl.NumberFormat('es-MX',{maximumFractionDigits:1}).format(n);
const pct=n=>n===null?'—':nice(n)+'%';
const colors=['#09858a','#35abc1','#e0ad50','#ee855c','#d65060','#406ca7'];
const html=x=>esc(String(x??''));
function titleCard(label,value,ico,subtitle){return `<div class="card j-kpi"><div class="j-kpi-icon" aria-hidden="true">${ico}</div><div><small>${html(label)}</small><b>${html(printable(value))}</b>${subtitle?`<small>${html(subtitle)}</small>`:''}</div></div>`}
function hero(detail){
  return `<div class="j-hero"><div><div class="j-kicker">INSTITUTO TECNOLÓGICO E HISTÓRICO LATINOAMERICANO</div><h1>Bienvenido(a), ${html(S.profile?.nombre_completo?.split(/\s+/).slice(0,2).join(' ')||'a Plataforma Jaguar')}</h1><p>${html(detail)}<br>Ciclo escolar ${html(S.activeCycle||'sin definir')} · <i>Scientia, Humanitas et Progressum</i></p></div><img class="j-hero-logo" src="/assets/ithla-logo.png" alt="Escudo de ITHLA" onerror="this.style.display='none'"></div>`;
}
function panel(title,sub,content,extra=''){
  return `<section class="card"><div class="j-section-heading"><div><h3>${html(title)}</h3>${sub?`<div class="j-chart-subtitle">${html(sub)}</div>`:''}</div>${extra}</div>${content}</section>`;
}
function bars(labels,values,{suffix='',color=colors[0]}={}){
  const pairs=labels.map((label,i)=>({label:String(label),value:Math.max(0,Number(values[i])||0)}));
  const max=Math.max(1,...pairs.map(r=>r.value));
  if(!pairs.some(x=>x.value>0))return `<div class="j-empty">Sin registros para graficar.</div>`;
  return `<div class="j-simple-bars" role="img" aria-label="${html(pairs.map(x=>x.label+': '+x.value+suffix).join('; '))}">${pairs.map((r,i)=>`<div class="j-bar-col"><b>${html(nice(r.value))}${html(suffix)}</b><div style="height:${Math.max(2,r.value/max*119)}px;background:linear-gradient(180deg,${i%2?'#48b6b1':color},#086b80)"></div><small>${html(r.label)}</small></div>`).join('')}</div>`;
}
function donut(items,heading='Registros'){
  const data=items.filter(r=>Number(r.total)>0).map(r=>({...r,total:Number(r.total)}));
  const total=data.reduce((sum,row)=>sum+row.total,0);
  if(!total)return '<div class="j-empty">Sin datos registrados todavía.</div>';
  let p=0;
  const stops=[];
  data.forEach((r,i)=>{const q=p+r.total/total*100;stops.push(`${colors[i%colors.length]} ${p.toFixed(2)}% ${q.toFixed(2)}%`);p=q});
  return `<div class="j-donut-wrap"><div class="j-donut" style="background:conic-gradient(${stops.join(',')})" role="img" aria-label="${html(data.map(x=>x.label+': '+x.total).join('; '))}"><div class="j-donut-inner"><strong>${html(nice(total))}</strong><small>${html(heading)}</small></div></div><div class="j-legend">${data.map((r,i)=>`<div class="j-legend-row"><span class="j-dot" style="background:${colors[i%colors.length]}"></span>${html(r.label)}<b>${html(nice(r.total))}</b></div>`).join('')}</div></div>`;
}
function lineChart(rows){
  const data=Array.isArray(rows)?rows:[];
  if(!data.length)return `<div class="j-empty">Sin asistencias registradas para mostrar tendencia.</div>`;
  const width=680,height=216,padX=48,padTop=18,padBottom=38,plotH=height-padTop-padBottom;
  const rates=data.map(x=>{const n=(Number(x.present)||0)+(Number(x.absent)||0);return n?Number(x.present)/n*100:null});
  const points=rates.map((rate,i)=>({x:padX+(width-padX-18)*(data.length===1?.5:i/(data.length-1)),y:rate===null?null:padTop+(100-rate)/100*plotH,rate}));
  const valid=points.filter(p=>p.y!==null);
  const lines=valid.map(p=>`${p.x},${p.y}`).join(' ');
  return `<svg class="j-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tasa de asistencia por mes: ${html(data.map((x,i)=>x.month+': '+(rates[i]===null?'sin datos':rates[i].toFixed(1)+'%')).join('; '))}"><g stroke="var(--j-line)" stroke-width="1">${[0,25,50,75,100].map(n=>{const y=padTop+(100-n)/100*plotH;return `<line x1="${padX}" y1="${y}" x2="${width-12}" y2="${y}"/>`}).join('')}</g><g fill="var(--j-muted)" font-size="11" font-family="Arial">${[0,25,50,75,100].map(n=>`<text x="${padX-7}" y="${padTop+(100-n)/100*plotH+4}" text-anchor="end">${n}%</text>`).join('')}${points.map((p,i)=>`<text x="${p.x}" y="${height-11}" text-anchor="middle">${html(data[i].month.slice(5))}/${html(data[i].month.slice(2,4))}</text>`).join('')}</g>${valid.length>1?`<polyline points="${lines}" fill="none" stroke="#008c91" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`:''}${valid.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#008c91"><title>${p.rate.toFixed(1)}%</title></circle>`).join('')}</svg>`;
}
const action=(id,text)=>`<button class="btn" onclick="loadPage('${id}')">${html(text)} →</button>`;
async function adminHome(){
  const [dReq,aReq]=await Promise.allSettled([api('dashboard'),api('dashboardAnalytics')]);
  // La vista Premium debe permanecer visible aunque falle una de las consultas.
  const d=dReq.status==='fulfilled'?(dReq.value||{}):{counts:{},notices:[]};
  const a=aReq.status==='fulfilled'?aReq.value:null;
  const c=d.counts||{};
  const kpis=[['Alumnos activos',c.alumnos,'♙'],['Docentes activos',c.docentes,'♧'],['Grupos',c.grupos,'▦'],['Materias',c.materias,'▤']];
  const grades=a?.gradesByBand||[];
  const status=dReq.status==='rejected'?'No se pudieron consultar los indicadores institucionales. Revisa la conexión o los permisos de Supabase; el resto de los módulos continúa disponible.':a?`Se analizaron ${nice(a.recordedGrades)} calificaciones y ${nice(a.recordedAttendance)} asistencias${a.gradeSampleLimited||a.attendanceSampleLimited?' (muestra reciente limitada a 5,000 por tipo)':''}.`:'Las estadísticas ampliadas no están disponibles; los módulos y recuentos siguen funcionando.';
  return `<div class="j-stack">${hero('Panel institucional · consulta y seguimiento académico')}<div class="j-kpis">${kpis.map(x=>titleCard(...x)).join('')}</div><div class="j-chart-grid">${panel('Rendimiento académico','Distribución de las calificaciones registradas',bars(grades.map(x=>x.label),grades.map(x=>x.total)),a?`<span class="chip">Promedio ${html(printable(a.mean))}</span>`:'')}${panel('Distribución de calificaciones','Rangos registrados en el sistema',donut(grades,'Evaluaciones'))}</div><div class="j-chart-grid">${panel('Evolución de la asistencia','Porcentaje de presentes y justificadas por mes',lineChart(a?.attendanceMonths||[]),a?`<span class="chip">Asistencia ${html(pct(a.attendanceRate))}</span>`:'')}${panel('Alumnos por grado','Alumnado activo con grupo asignado',bars(Object.keys(a?.byGrade||{}).sort((x,y)=>+x-+y).map(x=>x+'°'),Object.keys(a?.byGrade||{}).sort((x,y)=>+x-+y).map(x=>a.byGrade[x])))}</div><div class="j-chart-grid">${panel('Avisos institucionales','Últimos comunicados publicados',(d.notices||[]).map(n=>`<div class="j-notice"><b>${html(n.titulo)}</b><p>${html(n.contenido)}</p></div>`).join('')||'<p class="j-hint">No hay avisos publicados.</p>')}${panel('Accesos rápidos','Continúan todos los módulos en la barra lateral',`<div class="j-quick">${action('alumnos','Alumnos')}${action('calificaciones','Calificaciones')}${action('asistencia','Asistencia')}${action('grupos','Grupos')}${action('avisos','Avisos')}</div><p class="j-hint" style="margin-top:18px">${html(status)}</p>`)}</div></div>`;
}
async function studentHome(){
  const original=await v22StudentOverview();
  if(S.studentSuspended||S.studentAccess?.suspended)return original;
  try{
    const d=await api('studentOverview');
    const nums=(d.grades||[]).map(x=>x.calificacion).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='').map(Number).filter(v=>Number.isFinite(v)&&v>=0&&v<=10);
    const bands=[0,0,0,0,0];nums.forEach(n=>bands[n<6?0:n<7?1:n<8?2:n<9?3:4]++);
    const content=`<div class="j-chart-grid" style="margin-top:16px">${panel('Mis calificaciones','Distribución de las calificaciones que tienes registradas',bars(['0–5.9','6–6.9','7–7.9','8–8.9','9–10'],bands))}${panel('Mi rendimiento','Se utilizan únicamente tus registros escolares',donut(['0–5.9','6–6.9','7–7.9','8–8.9','9–10'].map((label,i)=>({label,total:bands[i]})),'Calificaciones'))}</div>`;
    return original+content;
  }catch{return original}
}
async function teacherHome(){
  const original=await v3TeacherDashboard();
  try{
    const d=await api('teacherDashboard');
    const counts=new Map();
    (d.assignments||[]).forEach(a=>{
      const name=a.grupo_materias?.grupos?.clave||'Sin grupo';counts.set(name,(counts.get(name)||0)+1);
    });
    const rows=[...counts].sort((a,b)=>a[0].localeCompare(b[0],'es'));
    return original+`<div style="margin-top:15px">${panel('Asignaciones por grupo','Asignaciones docentes activas registradas en Jaguar',bars(rows.map(x=>x[0]),rows.map(x=>x[1])))}</div>`;
  }catch{return original}
}
async function departmentHome(){
  const original=await v3DeptDashboard();
  try{
    const d=await api('dashboard');const c=d.counts||{};
    const labels=['Alumnos','Docentes','Grupos','Materias'];
    const values=[c.alumnos,c.docentes,c.grupos,c.materias];
    return original+`<div style="margin-top:15px">${panel('Panorama de la institución','Datos agregados disponibles para este rol',bars(labels,values))}</div>`;
  }catch{return original}
}
window.jaguarPremiumHome=async()=>{
  if(['control_escolar','direccion_escolar','control'].includes(S.role))return adminHome();
  if(S.role==='alumno')return studentHome();
  if(S.role==='docente')return teacherHome();
  if(['servicios_docentes','servicios_estudiantiles','prefectura','coordinacion_academica'].includes(S.role))return departmentHome();
  return dashboard();
};
// Enhances navigation only: no module names removed and existing loadPage remains authoritative.
const app=document.getElementById('app');
if(app)app.classList.add('jaguar-v3');
// The menu remains available to every role exactly according to existing mappings.
})();
