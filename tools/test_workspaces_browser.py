from playwright.sync_api import sync_playwright
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description="Prueba de interfaz sin red; ambos argumentos son raíces con sistema.html")
parser.add_argument("--base",type=Path,required=True)
parser.add_argument("--actual",type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument("--chromium",default="/usr/bin/chromium")
args=parser.parse_args()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
 def launch(root):
  page=b.new_page(viewport={'width':1440,'height':900})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  import re
  html=(root/'sistema.html').read_text()
  def inline(m):
   src=m.group(1)
   if not src.startswith('/'):return ''
   f=root/src.lstrip('/')
   if not f.is_file():return ''
   code=f.read_text().replace('</script','<\\/script')
   return '<script>'+code+'</script>'
  html=re.sub(r'<script[^>]*src="([^"]+)"[^>]*>\s*</script>',inline,html)
  html=html.replace('<head>','<head><script>window.fetch=async()=>new Response(JSON.stringify({ok:false,error:"Offline mock"}),{status:403,headers:{"Content-Type":"application/json"}})</script>',1)
  page.route('**/*',lambda r:r.abort())
  page.set_content(html,wait_until='load');page.wait_for_timeout(400)
  return page,errors
 old,oldErrors=launch(args.base);new,errors=launch(args.actual)
 snapshot=lambda page:page.evaluate('''()=>{S.role='direccion_escolar';S.page='inicio';return Object.fromEntries(Object.entries(roleNav).map(([k,v])=>[k,v.map(x=>x[0])]))}''')
 before=snapshot(old);after=snapshot(new)
 print('BASE ERRORS',oldErrors,'NEW ERRORS',errors)
 print('roles',len(before), 'entries',sum(map(len,before.values())))
 for role,ids in before.items():
  assert not set(ids)-set(after[role]),(role,set(ids)-set(after[role]));print(role,'entries',len(ids),'->',len(after[role]))
  nav=new.evaluate('''role=>{S.role=role;S.page='inicio';S.studentSuspended=false;S.studentAccess=null;renderShell();return [...document.querySelectorAll('#nav [data-j-page]')].map(x=>x.dataset.jPage)}''',role)
  assert len(nav)==len(set(nav)) and set(nav)==set(after[role]),(role,nav,after[role])
 print('PASS all role menus; no missing routes')
 new.evaluate('''()=>{S.role='alumno';S.studentSuspended=true;S.studentAccess={suspended:true};renderShell()}''')
 assert set(new.locator('#nav [data-j-page]').evaluate_all('(els)=>els.map(e=>e.dataset.jPage)'))=={'inicio','revision_acceso_alumno','notificaciones','avisos','perfil'}
 print('PASS suspended student menu')
 new.evaluate('''()=>{
 S.role='docente';S.page='inicio';S.studentSuspended=false;S.studentAccess=null;S.activeCycle='2026-2027';S.profile={nombre_completo:'Docente de prueba'};document.getElementById('app').classList.remove('hide');document.getElementById('login').classList.add('hide');
 const gm1={id:101,grupo_id:1,materia_id:11,grupos:{id:1,clave:'1F',turno:'Vespertino'},materias:{id:11,nombre:'Español'},horas_semana:4};
 const gm2={id:102,grupo_id:1,materia_id:12,grupos:gm1.grupos,materias:{id:12,nombre:'Historia'},horas_semana:3};
 const gm3={id:103,grupo_id:2,materia_id:11,grupos:{id:2,clave:'2F',turno:'Matutino'},materias:gm1.materias,horas_semana:4};
 const gms=[gm1,gm2,gm3];const assignments=gms.map(g=>({grupo_materia_id:g.id,grupo_materias:g,horas_asignadas:g.horas_semana}));
 const periods=[{id:1,nombre:'Primer periodo',activo:true,es_periodo_actual:true}];const students=[{id:1,nombre_completo:'Alumno prueba',matricula:'FICTICIA001'}];
 window.__mockCalls=[];
 api=async(resource,opts={})=>{window.__mockCalls.push([resource,opts]);if(resource==='teacherGroups')return assignments;if(resource==='periods')return periods;if(resource==='notifications')return [];if(resource==='teacherDashboard')return {assignments,teacher:{nombre_completo:'Docente prueba'},cycle:'2026-2027',notices:[],clarifications:[]};return []};
 apiQuery=async(resource,opts={})=>{window.__mockCalls.push([resource,opts]);const gm=gms.find(g=>Number(g.id)===Number(opts.grupo_materia_id));if(resource==='teacherRoster')return {grupo_materia:gm,students,teacher:{nombre_completo:'Docente prueba'}};if(resource==='teacherEvaluationOverview')return {assignments,periods,rubricas:[],borradores:[],ventanas:[]};if(resource==='teacherGrades')return {grupo_materia:gm,students};return {}};
 jaguarTeacherEvaluationWindows=async()=>[{id:1,habilitada:true}];
 j55get=async(action)=>action==='bootstrap'?{assignments}:[];
 j56api=async()=>({gms,assignments,teachers:[],rows:gms.map(g=>({grupo_materia_id:g.id,estado:'registrada',google_course_id:'ficticio-'+g.id}))});
 j57api=async()=>({periods});renderShell();
 }''')
 new.evaluate("loadPage('grupos')");assert new.locator('#content h3').count()==2
 new.locator('#content button').filter(has_text='Español · 4 h/semana').first.click();new.wait_for_function("S.workspaceId===101 && document.querySelector('.j-workspace-tile')")
 assert new.locator('#content .j-workspace-tile').count()==8
 print('PASS group chooser: multiple subjects on one group and eight work actions')
 new.locator('#content .j-workspace-tile').filter(has_text='Padrón y listas').click();new.wait_for_function("document.querySelector('#modal').classList.contains('open')")
 assert 'FICTICIA001' in new.locator('#mb').inner_text();new.evaluate('closeModal()');print('PASS roster uses selected assignment')
 new.locator('#content .j-workspace-tile').filter(has_text='Fechas y registros').click();new.wait_for_function("window.__jaguarAttendance?.groupId===101 && document.getElementById('jaguar-att-periods')?.textContent.includes('Primer periodo')");assert new.evaluate('window.__jaguarAttendance.groups.map(x=>x.id)')==[101];print('PASS scoped attendance and period')
 new.evaluate("loadPage('grupos',{gmId:102})");new.locator('#content .j-workspace-tile').filter(has_text='Rúbrica, adopción').click();new.wait_for_function("document.querySelector('#modal').classList.contains('open')");assert 'Historia' in new.locator('#mb').inner_text() and 'Español' not in new.locator('#mb').inner_text();new.evaluate('closeModal()');print('PASS scoped evaluation modal')
 new.locator('#content .j-workspace-tile').filter(has_text='Calificaciones oficiales').click();new.wait_for_function("window.__jaguarTeacherGrade?.groupId===102 && document.getElementById('jaguar-grade-periods')?.textContent.includes('Primer periodo')");assert new.evaluate('window.__jaguarTeacherGrade.groups.map(x=>x.id)')==[102];print('PASS scoped official grade history')
 new.evaluate("loadPage('grupos',{gmId:101})");new.locator('#content .j-workspace-tile').filter(has_text='Crear, ampliar').click();new.wait_for_selector('#content button[onclick="openDailyGradebook(101)"]');assert new.locator('#content button[onclick^="openDailyGradebook("]').count()==1;print('PASS scoped gradebook')
 new.evaluate("loadPage('grupos',{gmId:103})");new.locator('#content .j-workspace-tile').filter(has_text='Clase y calificaciones').click();new.wait_for_selector('#j574gradeGm');assert new.locator('#j574gradeGm').input_value()=='103';assert new.evaluate('J56.catalog.gms.map(g=>g.id)')==[103];print('PASS scoped Classroom')
 new.evaluate("loadPage('grupos',{gmId:102})");new.locator('#content .j-workspace-tile').filter(has_text='Banco y creación').click();new.wait_for_selector('#j55_gm');assert new.locator('#j55_gm').input_value()=='102';print('PASS scoped exam preselection')
 new.evaluate("loadPage('grupos',{gmId:999999})");assert 'ya no está disponible' in new.locator('#content').inner_text();assert new.locator('#content .j-workspace-tile').count()==0;print('PASS missing assignment denied')
 new.evaluate("loadPage('asistencia')");assert new.evaluate('window.__jaguarAttendance.groups.length')==3;assert new.evaluate('S.workspaceId')==0;print('PASS general access preserved')
 # search opens collapsed group
 new.evaluate("S.page='inicio';renderShell();document.getElementById('j-module-search').value='Banco de exámenes';jaguarFocusModule()")
 assert new.locator('#nav [data-j-page="examenes"]').evaluate("e=>e.closest('details').open")
 print('PASS collapsed module search')
 new.evaluate("loadPage('grupos',{gmId:101})");new.set_viewport_size({'width':390,'height':844});print('PASS mobile viewport loaded (external CDN CSS not tested)')
 print('PAGE ERRORS',errors)
 assert not errors,errors
 b.close()
