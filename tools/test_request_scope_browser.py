"""Prueba de interfaz de solicitudes y cupos V36. Mocks locales, sin servicios remotos."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
s=(root/'sistema.html').read_text()
functions=[]
for name in ('v3DepartmentRequestsModule','jaguarStudentGroupSelector'):
 m=re.search(r'(?m)^async function '+name+r'\(\).*$',s)
 assert m,name
 functions.append(m.group(0))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=b.new_page();page.route('**/*',lambda r:r.abort());page.set_content('<div id="host"></div><select id="sr_tipo"><option value="grupo">Grupo</option></select><div id="sr_group_wrap"><select id="sr_group"></select></div><p id="sr_current_group"></p>');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.evaluate('''()=>{window.S={role:'servicios_estudiantiles'};window.labels={};window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.jaguarNombreInstitucional=()=> 'Alumno ficticio';window.toast=console.error;window.api=async()=>[{id:'9007199254740993',tipo:'grado',estado:'pendiente',motivo:'<script>TEST</script>'},{id:'2',tipo:'taller',estado:'pendiente',motivo:'Otro horario'}];window.clicked=[];window.resolveStudentRequest=(id,state)=>clicked.push([id,state]);window.jaguarStudentGroupOptions=async()=>({actual:{clave:'1A',grado:1,limite:25},grupos:[{id:2,clave:'1B',grado:1,letra:'B',turno:'Matutino',ocupados:28,limite:30,cupo:2,lleno:false}]})}''')
 page.add_script_tag(content='\n'.join(functions));page.evaluate("async()=>{document.getElementById('host').innerHTML=await v3DepartmentRequestsModule();await jaguarStudentGroupSelector()}")
 assert page.get_by_text('Requiere trámite autorizado').count()==1
 assert page.get_by_role('button',name='Aprobar',exact=True).count()==1
 page.get_by_role('button',name='Rechazar',exact=True).first.click();assert page.evaluate('clicked')==[['9007199254740993','rechazada']]
 assert '28/30' in page.locator('#sr_group').inner_text();assert 'límite 25' in page.locator('#sr_current_group').inner_text();assert page.locator('#host script').count()==0;assert not errors,errors
 print('OK: aprobación restringida, contenido escapado, ID bigint exacto, capacidad configurable');b.close()
