"""Synthetic API browser smoke; does not execute SQL."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(accept_downloads=True); page.set_default_timeout(5000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="host"></div>')
    page.evaluate('''()=>{window.S={role:'control_escolar'};window.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.jaguarReadJson=r=>r.json();window.toast=x=>window.message=x;window.confirm=()=>true;window.prompt=q=>q.includes('Referencia')?'DOC-001':'Formalización documentada de egreso';window.posts=[];window.record=null;window.fetch=async(url,opts={})=>{let d;const b=opts.body?JSON.parse(opts.body):null;if(b){posts.push(b);record={id:'4',current:true,reference:'DOC-001',actor:'Control Escolar'};}if(String(url).includes('historical_report'))d={student:'10',cycle:'2024-2025',official:false,state:'projected',rows:[{}],csv:'Informe experimental; NO ES BOLETA\\r\\n6.75'};else d={student:'10',cycle:'2024-2025',decision:{state:'academic_completion'},record,eligible:!record,canFormalize:!record&&S.role==='control_escolar',fingerprint:'a'.repeat(32),experimental:true};return new Response(JSON.stringify({ok:true,data:d}),{headers:{'Content-Type':'application/json'}})}}''')
    page.add_script_tag(path=str(root/'assets/jaguar360-operations.js')); page.evaluate("document.getElementById('host').innerHTML=jaguarOperations.html()")
    page.locator('#jop_cycle').fill('2024-2025'); page.locator('#jop_student').fill('10')
    with page.expect_download() as download:
        page.get_by_role('button',name='Descargar informe histórico CSV').click()
    file=download.value; assert file.suggested_filename=='JAGUAR-REVISION-2024-2025-10.csv'; assert '6.75' in Path(file.path()).read_text(); page.get_by_text('No es una boleta oficial.',exact=False).wait_for()
    page.get_by_role('button',name='Consultar formalización de egreso').click(); page.get_by_role('button',name='Formalizar egreso en pruebas').click(); page.get_by_text('Registro 4',exact=False).wait_for()
    assert page.evaluate("posts[0].action")=='formalize_egress'; assert page.evaluate("posts[0].fingerprint")=='a'*32; assert page.get_by_role('button',name='Formalizar egreso en pruebas').count()==0
    assert not errors,errors; print('OK: historical CSV download and experimental egress flow (mocked API)'); browser.close()
