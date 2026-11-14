"""Browser contract only: no database or real authentication."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def inline(m):
  src=m.group(1);f=root/src.lstrip('/')
  return '<script>'+f.read_text().replace('</script','<\\/script')+'</script>' if src.startswith('/') and f.is_file() else ''
 html=re.sub(r'<script[^>]*src="([^"]+)"[^>]*>\s*</script>',inline,(root/'sistema.html').read_text());page.route('**/*',lambda r:r.abort());page.set_content(html,wait_until='load')
 page.evaluate('''()=>{S.role='direccion_escolar';document.getElementById('app').classList.remove('hide');document.getElementById('login').classList.add('hide');window.confirm=()=>true;window.prompt=()=>"Resolución documental ficticia";supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.calls=[];window.ready=false;window.enabled=false;window.sealed=false;window.rect=[];
 window.fetch=async(url,opts={})=>{const q=new URL(String(url),'https://jaguar.test').searchParams;let data={historial:[],padron_version:1,sesiones_version:1};if(opts.method==='POST'){const body=JSON.parse(opts.body);calls.push(body);if(body.action==='seal_period')sealed=true;if(body.action==='sealed_rectification'&&body.operation==='proponer')rect=[{id:'5',state:'pendiente',originalBefore:5,officialBefore:5,originalAfter:6.75,officialAfter:7,actor:'CE ficticio',reason:body.reason,reference:body.reference}];if(body.action==='sealed_rectification'&&body.operation==='autorizar')rect[0].state='autorizada';data={};}else if(q.get('view')==='seal')data={sealed,ready,experimental:enabled,planVersion:2,fingerprint:'b'.repeat(32),blockers:ready?[]:['Falta evidencia'],actor:'Dirección ficticia',createdAt:'2026-11-14',reason:'Acta ficticia'};else if(q.get('view')==='rectifications')data={sealedOriginal:5,sealedOfficial:5,history:rect,effectiveId:rect[0]?.state==='autorizada'?'5':null,experimental:enabled};return new Response(JSON.stringify({ok:true,data}),{headers:{'Content-Type':'application/json'}})};
 window.panel=document.createElement('div');document.body.appendChild(panel);panel.innerHTML=jaguarHistoryEvidence.html([{id:'12',ciclo_escolar:'2026-2027',nombre:'P1'}]);}''')
 def open_evidence():
  page.locator('#jhe_period').select_option('12');page.get_by_role('button',name='Consultar evidencia',exact=True).click();page.locator('#jhe_seal').wait_for(state='attached')
 def read_seal():
  page.get_by_role('button',name='Consultar cierre protegido',exact=True).click();page.wait_for_function("document.querySelector('#jhe_seal').innerText!=='Consultando…' && document.querySelector('#jhe_seal').innerText.length>0")
 open_evidence();read_seal();assert 'Falta evidencia' in page.locator('#jhe_seal').inner_text();assert page.get_by_role('button',name='Autorizar cierre protegido (pruebas)').count()==0
 page.evaluate('ready=true');read_seal();assert 'Escrituras deshabilitadas' in page.locator('#jhe_seal').inner_text();assert page.get_by_role('button',name='Autorizar cierre protegido (pruebas)').count()==0
 page.evaluate('enabled=true');read_seal();page.get_by_role('button',name='Autorizar cierre protegido (pruebas)').click();page.wait_for_function("calls.length===1 && document.querySelector('#jhe_seal').innerText.includes('Periodo sellado')");assert page.evaluate('calls[0].fingerprint')=='b'*32
 def read_rect():
  page.locator('#jhe_rect_student').fill('19');page.locator('#jhe_rect_gm').fill('34');page.get_by_role('button',name='Consultar rectificaciones').click();page.wait_for_function("document.querySelector('#jhe_rect').innerText.includes('Nota del sello')")
 page.evaluate("S.role='control_escolar'");read_rect();page.locator('#jhe_rect_grade').fill('6.75');page.locator('#jhe_rect_ref').fill('Acta de prueba');page.locator('#jhe_rect_reason').fill('Corrección documental ficticia');page.get_by_role('button',name='Proponer rectificación').click();page.wait_for_function("calls.length===2 && document.querySelector('#jhe_rect').innerText.includes('pendiente')");assert page.evaluate('calls[1].grade')=='6.75';assert page.get_by_role('button',name='Autorizar rectificación').count()==0
 page.evaluate("S.role='direccion_escolar'");read_rect();page.locator('#jhe_rect summary').click();page.get_by_role('button',name='Autorizar rectificación',exact=True).click();page.wait_for_function("calls.length===3 && document.querySelector('#jhe_rect').innerText.includes('autorizada')");assert page.evaluate('calls[2].id')=='5';assert 'Nota del sello: 5' in page.locator('#jhe_rect').inner_text()
 assert not errors,errors;print('OK: cierre bloqueado y opt-in, sello con huella, rectificación por CE y resolución de Dirección; API simulada.')
 b.close()
