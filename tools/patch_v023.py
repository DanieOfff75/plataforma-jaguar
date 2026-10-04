from pathlib import Path
p=Path('/mnt/data/inetch_v022_work/index.html')
s=p.read_text(encoding='utf-8')
patch=r'''
<style id="inetch-suspension-v023">
/* INETCH v023 · modo suspensión: rojo + amarillo en toda la interfaz */
body.inetch-student-suspended-mode{
  background:
    radial-gradient(circle at 8% 5%,rgba(170,24,38,.42) 0,transparent 32%),
    radial-gradient(circle at 88% 2%,rgba(246,166,55,.28) 0,transparent 27%),
    radial-gradient(circle at 55% 100%,rgba(116,10,24,.32) 0,transparent 42%),
    #120305!important;
}
body.inetch-student-review-mode{
  background:
    radial-gradient(circle at 8% 5%,rgba(170,24,38,.32) 0,transparent 30%),
    radial-gradient(circle at 88% 2%,rgba(246,166,55,.48) 0,transparent 31%),
    radial-gradient(circle at 55% 100%,rgba(116,10,24,.28) 0,transparent 42%),
    #1a0c03!important;
}
#app.inetch-student-suspended-app .side{
  background:linear-gradient(180deg,#25070b 0%,#120305 58%,#1d0903 100%)!important;
  border-color:rgba(239,91,98,.42)!important;
  box-shadow:12px 0 55px rgba(100,5,15,.18);
}
#app.inetch-student-suspended-app .side-account{
  background:linear-gradient(135deg,rgba(113,17,28,.74),rgba(74,20,7,.78))!important;
  border-color:rgba(246,166,55,.55)!important;
}
#app.inetch-student-suspended-app .main>header{
  background:linear-gradient(90deg,rgba(94,8,19,.96),rgba(67,12,12,.92),rgba(85,42,7,.88))!important;
  border-color:rgba(246,166,55,.55)!important;
  box-shadow:0 4px 32px rgba(145,16,28,.24);
}
#app.inetch-student-suspended-app .main>header .text-xs{color:#ffb3ad!important}
#app.inetch-student-suspended-app .main>header .chip{border-color:rgba(246,166,55,.65)!important;color:#ffe0a8!important;background:rgba(246,166,55,.1)!important}
#app.inetch-student-suspended-app #content{background:linear-gradient(180deg,rgba(92,7,18,.08),transparent 28%)}
#app.inetch-student-suspended-app .nav{color:#f2b7b2!important}
#app.inetch-student-suspended-app .nav:hover{background:rgba(239,91,98,.16)!important;color:#fff!important}
#app.inetch-student-suspended-app .nav.active{background:linear-gradient(90deg,rgba(171,25,40,.68),rgba(126,45,8,.5))!important;color:#fff!important;box-shadow:inset 4px 0 #f6a637,0 0 22px rgba(239,91,98,.12)}
#app.inetch-student-suspended-app .card:not(.inetch-suspended-banner):not(.inetch-review-banner):not(.inetch-lock-card){
  background:linear-gradient(135deg,rgba(67,12,19,.9),rgba(45,12,7,.86))!important;
  border-color:rgba(239,91,98,.38)!important;
}
#app.inetch-student-suspended-app .btn:not(.danger){
  background:linear-gradient(135deg,#8e1826,#6a1d0b)!important;
  border-color:rgba(246,166,55,.62)!important;color:#fff4dd!important;
}
#app.inetch-student-suspended-app .btn.danger{background:linear-gradient(135deg,#c51f35,#8b121e)!important;border-color:#ff8c83!important;box-shadow:0 0 26px rgba(239,91,98,.25)}
#app.inetch-student-suspended-app .inetch-lock-card{background:linear-gradient(135deg,rgba(49,9,15,.94),rgba(70,31,7,.84))!important;border:2px dashed rgba(246,166,55,.62)!important;opacity:.92}
#app.inetch-student-suspended-app .inetch-lock-card .lock-label{color:#ffd37c!important}
#app.inetch-student-suspended-app .inetch-action-card{background:linear-gradient(135deg,rgba(92,12,24,.88),rgba(104,49,7,.72))!important;border-color:rgba(246,166,55,.58)!important}
#app.inetch-student-suspended-app .inetch-action-card:hover{border-color:#f6a637!important;box-shadow:0 0 28px rgba(246,166,55,.16)}
#app.inetch-student-review-app .side{background:linear-gradient(180deg,#2a1304 0%,#170a03 58%,#25070b 100%)!important;border-color:rgba(246,166,55,.5)!important}
#app.inetch-student-review-app .main>header{background:linear-gradient(90deg,rgba(101,50,7,.96),rgba(86,36,5,.9),rgba(91,9,18,.9))!important;border-color:rgba(246,166,55,.58)!important}
#app.inetch-student-review-app .nav{color:#f5d3a0!important}
#app.inetch-student-review-app .nav:hover{background:rgba(246,166,55,.15)!important;color:#fff!important}
#app.inetch-student-review-app .nav.active{background:linear-gradient(90deg,rgba(151,79,10,.7),rgba(118,18,29,.52))!important;color:#fff!important;box-shadow:inset 4px 0 #ffbf55,0 0 22px rgba(246,166,55,.12)}
#app.inetch-student-review-app .card:not(.inetch-review-banner):not(.inetch-lock-card):not(.inetch-action-card){background:linear-gradient(135deg,rgba(65,34,7,.88),rgba(53,10,16,.84))!important;border-color:rgba(246,166,55,.4)!important}
.inetch-restricted-note{border:2px solid rgba(246,166,55,.58)!important;background:linear-gradient(135deg,rgba(109,52,7,.76),rgba(88,10,21,.78))!important;box-shadow:0 0 34px rgba(246,166,55,.12)}
.inetch-restricted-note h3{color:#fff0cb!important}
.inetch-restricted-note p{color:#ffdca0!important}
</style>
<script>
/* INETCH v023 · suspensión integral: tema + restricciones de navegación */
S.studentAccess={suspended:false,review:false,motivo:'',hasta:null};
const INETCH_SUSPENDED_ALLOWED=['inicio','notificaciones','revision_acceso_alumno','avisos','perfil'];
async function refreshStudentAccessState(){
  if(S.role!=='alumno')return;
  try{
    const x=await api('studentOverview');
    S.studentAccess={
      suspended:!!x.student?.suspendido,
      review:String(x.student?.revision_acceso_estado||'').toLowerCase()==='pendiente',
      motivo:x.student?.suspension_motivo||'',
      hasta:x.student?.suspension_hasta||null
    };
  }catch(e){/* no romper la sesión si el estado tarda en cargar */}
  applyStudentAccessTheme();
}
function applyStudentAccessTheme(){
  const a=document.getElementById('app');
  const b=document.body;
  const suspended=S.role==='alumno'&&!!S.studentAccess?.suspended;
  const review=suspended&&!!S.studentAccess?.review;
  a?.classList.toggle('inetch-student-suspended-app',suspended&&!review);
  a?.classList.toggle('inetch-student-review-app',review);
  b?.classList.toggle('inetch-student-suspended-mode',suspended&&!review);
  b?.classList.toggle('inetch-student-review-mode',review);
}
function studentSuspendedNavigation(){
  if(!S.studentAccess?.suspended)return null;
  return [
    ['inicio','⛔ Estado de acceso'],
    ['revision_acceso_alumno',S.studentAccess.review?'🟠 Revisión en proceso':'🚨 Resolver suspensión'],
    ['notificaciones','🔔 Notificaciones'],
    ['avisos','📢 Avisos'],
    ['perfil','👤 Mi perfil']
  ];
}
const _inetchRenderShellV023=renderShell;
renderShell=function(){
  _inetchRenderShellV023();
  if(S.role==='alumno'&&S.studentAccess?.suspended){
    const items=studentSuspendedNavigation();
    document.getElementById('nav').innerHTML=items.map(([id,t])=>`<button class="nav ${S.page===id?'active':''}" onclick="loadPage('${id}')">${t}</button>`).join('');
    document.getElementById('title').textContent=S.page==='revision_acceso_alumno'?'Revisión de acceso':(S.page==='notificaciones'?'Notificaciones':(titles[S.page]||S.page));
    applyStudentAccessTheme();
  }
};
const _inetchLoadPageV023=loadPage;
loadPage=async function(page){
  if(S.role==='alumno'){
    await refreshStudentAccessState();
    if(S.studentAccess.suspended&&!INETCH_SUSPENDED_ALLOWED.includes(page)){
      if(page!=='inicio')toast('Este módulo está restringido mientras tu acceso permanezca suspendido.');
      page='inicio';
    }
  }
  return _inetchLoadPageV023(page);
};
async function inetchStudentAccessReviewPage(){
  const x=await api('studentOverview');
  const review=String(x.student?.revision_acceso_estado||'').toLowerCase()==='pendiente';
  const suspended=!!x.student?.suspendido;
  if(!suspended)return `<div class="card"><h2>✅ Acceso restablecido</h2><p class="text-sm text-[#9cb7b0] mt-2">Tu suspensión ya no está activa. Puedes volver a utilizar los módulos escolares.</p></div>`;
  if(review)return `<div class="space-y-5"><div class="card inetch-review-banner"><div class="flex items-start gap-4"><div class="text-6xl">🟠</div><div><span class="chip inetch-status-badge orange">REVISIÓN PENDIENTE</span><h2 class="text-3xl mt-3 text-white">Tu caso está siendo revisado</h2><p class="mt-3 text-[#ffe2b9] font-semibold">La solicitud ya fue enviada a Control Escolar y/o Dirección Escolar. Mientras se revisa, el acceso académico permanece restringido.</p>${x.student?.suspension_motivo?`<p class="mt-3 text-sm text-[#ffd39a]"><b>Motivo:</b> ${esc(x.student.suspension_motivo)}</p>`:''}</div></div></div><div class="card inetch-restricted-note"><h3>¿Qué puedes hacer mientras tanto?</h3><p class="mt-2">Revisa tus notificaciones y mantén actualizado tu correo de recuperación. Cuando la autoridad resuelva tu caso, el sistema te avisará.</p></div></div>`;
  return `<div class="space-y-5"><div class="card inetch-suspended-banner"><div class="flex items-start gap-4"><div class="text-6xl">⛔</div><div class="flex-1"><span class="chip inetch-status-badge red">SUSPENDIDO</span><h2 class="text-3xl mt-3 text-white">Resuelve tu suspensión</h2><p class="mt-3 text-[#ffe0e3] font-semibold">Para recuperar tus módulos escolares debes solicitar una revisión a Control Escolar.</p>${x.student?.suspension_motivo?`<p class="mt-3 text-sm text-[#ffd0d4]"><b>Motivo:</b> ${esc(x.student.suspension_motivo)}</p>`:''}${x.student?.suspension_hasta?`<p class="mt-1 text-sm text-[#ffd0d4]"><b>Vigencia:</b> ${esc(x.student.suspension_hasta)}</p>`:''}<button class="btn danger mt-5" onclick="inetchRequestAccessReview()">📝 SOLICITAR REVISIÓN</button></div></div></div><div class="card inetch-restricted-note"><h3>Mientras estés suspendido</h3><p class="mt-2">Se mantienen disponibles únicamente las funciones necesarias para comunicarte con la escuela, revisar avisos, notificaciones y gestionar tu revisión.</p></div></div>`;
}
const _inetchStudentOverviewV023=v22StudentOverview;
v22StudentOverview=async function(){
  const x=await api('studentOverview');
  const suspended=!!x.student?.suspendido;
  if(!suspended)return _inetchStudentOverviewV023();
  const [greet,emoji]=v22Greeting();
  const review=String(x.student?.revision_acceso_estado||'').toLowerCase()==='pendiente';
  S.studentAccess={suspended:true,review,motivo:x.student?.suspension_motivo||'',hasta:x.student?.suspension_hasta||null};
  applyStudentAccessTheme();
  const banner=review?`<div class="card inetch-review-banner" role="alert"><div class="flex items-start gap-4"><div class="text-6xl">🟠</div><div class="min-w-0 flex-1"><div class="flex flex-wrap gap-2 items-center"><h2 class="inetch-suspend-title">ACCESO EN REVISIÓN</h2><span class="chip inetch-status-badge orange">REVISIÓN PENDIENTE</span></div><p class="inetch-suspend-copy mt-2">Tu solicitud ya fue enviada. El acceso académico permanece restringido mientras Control Escolar revisa tu caso.</p>${x.student?.suspension_motivo?`<p class="text-sm text-[#ffe4bd] mt-3"><b>Motivo:</b> ${esc(x.student.suspension_motivo)}</p>`:''}<button class="btn mt-4" onclick="loadPage('revision_acceso_alumno')">🟠 Ver estado de revisión</button></div></div></div>`:`<div class="card inetch-suspended-banner" role="alert"><div class="flex items-start gap-4"><div class="text-6xl">⛔</div><div class="min-w-0 flex-1"><div class="flex flex-wrap gap-2 items-center"><h2 class="inetch-suspend-title">ACCESO SUSPENDIDO</h2><span class="chip inetch-status-badge red">SUSPENDIDO</span></div><p class="inetch-suspend-copy mt-2">Tu acceso escolar está suspendido. Para recuperar tus módulos debes solicitar una revisión.</p>${x.student?.suspension_motivo?`<p class="text-sm text-[#ffe0e3] mt-3"><b>Motivo:</b> ${esc(x.student.suspension_motivo)}</p>`:''}${x.student?.suspension_hasta?`<p class="text-sm text-[#ffe0e3] mt-1"><b>Vigencia:</b> ${esc(x.student.suspension_hasta)}</p>`:''}<button class="btn danger mt-5 w-full md:w-auto" onclick="inetchRequestAccessReview()">📝 SOLICITAR REVISIÓN</button></div></div></div>`;
  return `<div class="space-y-5 inetch-suspended-shell">${banner}<div class="card inetch-action-card"><div class="text-xs text-[#ffb6b0] font-black">PANEL DEL ALUMNO</div><h1 class="text-3xl mt-2 text-white">${greet}, ${esc(v22Name())} ${emoji}</h1><p class="text-sm text-[#ffd0a1] mt-2">Tu acceso está limitado temporalmente. Las funciones académicas permanecen bloqueadas hasta que tu situación sea resuelta.</p></div><div class="card inetch-restricted-note"><h3>🔒 Acceso académico restringido</h3><p class="mt-2">Para que puedas concentrarte en resolver tu situación, estas funciones quedan temporalmente bloqueadas:</p><div class="grid md:grid-cols-3 gap-3 mt-4"><div class="card inetch-lock-card"><div class="text-3xl">🔒</div><b class="block mt-2">Mis calificaciones</b><span class="lock-label text-xs block mt-1">BLOQUEADO</span></div><div class="card inetch-lock-card"><div class="text-3xl">🔒</div><b class="block mt-2">Mi horario</b><span class="lock-label text-xs block mt-1">BLOQUEADO</span></div><div class="card inetch-lock-card"><div class="text-3xl">🔒</div><b class="block mt-2">Mi asistencia</b><span class="lock-label text-xs block mt-1">BLOQUEADO</span></div></div></div><div class="card inetch-action-card"><h3>🧭 ¿Qué sí puedes hacer?</h3><div class="grid md:grid-cols-3 gap-3 mt-4"><button class="card text-left" onclick="loadPage('revision_acceso_alumno')"><b>🚨 Resolver suspensión</b><p class="text-xs mt-1 text-[#ffd39a]">Solicita o consulta la revisión.</p></button><button class="card text-left" onclick="loadPage('notificaciones')"><b>🔔 Notificaciones</b><p class="text-xs mt-1 text-[#ffd39a]">Consulta respuestas de la escuela.</p></button><button class="card text-left" onclick="loadPage('perfil')"><b>👤 Mi perfil</b><p class="text-xs mt-1 text-[#ffd39a]">Mantén actualizado tu correo de recuperación.</p></button></div></div></div>`;
};
const _inetchPageHtmlV023=pageHtml;
pageHtml=async function(p){if(p==='revision_acceso_alumno'&&S.role==='alumno')return inetchStudentAccessReviewPage();return _inetchPageHtmlV023(p)};
</script>
'''
s=s.replace('</body>',patch+'\n</body>')
p.write_text(s,encoding='utf-8')
print('patched',p.stat().st_size)
