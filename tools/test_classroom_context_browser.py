"""Prueba Chromium aislada del flujo real Classroom; no usa Google ni Supabase."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page();page.route('**/*',lambda route:route.abort());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content('''<select id="j574gradeGm" onchange="j574gradeContextChanged()"><option value="1">Uno</option><option value="2">Dos</option></select><select id="j574gradePeriod" onchange="j574gradeContextChanged()"><option value="3">Tres</option><option value="4">Cuatro</option></select><div id="j574gradeResult"></div>''')
 page.add_script_tag(content="window.S={role:'docente'};window.esc=v=>String(v);window.notice=[];window.toast=v=>notice.push(v);window.confirm=()=>true;")
 page.add_script_tag(path=str(ROOT/'assets/jaguar-classroom-v56.js'))
 page.evaluate('''()=>{window.pending=[];window.requests=[];window.mockGrade=gm=>({topic:{name:'Grupo '+gm},work:[{id:'w',title:'Actividad',classification:'actividad',max_points:100}],students:[{google_user_id:'g',alumno_id:1,name:'Alumno ficticio'}],alumnos:[{id:1,matricula:'FICTICIA'}],rows:[{work_id:'w',google_user_id:'g',points:59.99}],closed:false});j574get=async(a,p)=>new Promise(resolve=>pending.push(()=>resolve(mockGrade(p.grupo_materia_id))));j57api=async(e,a,p)=>{requests.push({a,p});if(a==='grade_preview')return new Promise(resolve=>pending.push(()=>resolve({proof:'ficticia',component:{nombre:'Classroom',ponderacion:20},grades:[{alumno_id:1,valor:5.999}]})));if(a==='grade_commit')return new Promise(resolve=>pending.push(()=>resolve({imported:1,component:'Classroom'})));throw Error('Acción inesperada');};}''')
 page.evaluate('()=>{j574loadGrades();}');page.locator('#j574gradeGm').select_option('2');page.evaluate('()=>{j574loadGrades();pending[1]();pending[0]();}');page.wait_for_function("document.querySelector('#j574gradeResult').textContent.includes('Grupo 2')")
 assert page.evaluate('J574.context.gm')==2 and 'Grupo 1' not in page.locator('#j574gradeResult').inner_text()
 page.evaluate('()=>{j574gradePreview();}');page.locator('[data-j575-type="0"]').select_option('excluir');page.evaluate('()=>{pending[2]();}');assert page.evaluate('J574.proof') is None
 page.evaluate('()=>{j574gradePreview();}');assert page.locator('#j574gradePreview').inner_text().startswith('Guarda y verifica');assert page.evaluate('requests.length')==1
 page.evaluate('()=>{j574loadGrades();pending[3]();}');page.wait_for_function('J574.grade && !J574.classificationDirty')
 page.evaluate('()=>{j574gradePreview();pending[4]();}');page.wait_for_function("J574.proof==='ficticia'");assert '5.999' in page.locator('#j574gradePreview').inner_text()
 page.evaluate('()=>{j574commitGrades();j574commitGrades();}');assert page.evaluate("requests.filter(x=>x.a==='grade_commit').length")==1
 page.evaluate('()=>{pending[5]();}');page.wait_for_function('!J574.committing');assert page.evaluate('J574.proof') is None
 assert not errors,errors
 print('PASS Classroom: selección, respuesta tardía, cambios sin guardar, precisión visible y doble clic en confirmación')
 b.close()
