"""Opening UI smoke with mocked API. No database writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="host"></div>')
    page.evaluate('''()=>{window.S={role:'direccion_escolar'};window.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.jaguarReadJson=r=>r.json();window.toast=x=>window.message=x;window.confirm=()=>true;window.prompt=q=>q.includes('Referencia')?'ACTA-001':'Motivo administrativo documentado';window.posts=[];window.ready=false;window.activated=false;window.fetch=async(url,opts={})=>{const b=opts.body?JSON.parse(opts.body):null;if(b){posts.push(b);activated=true;}const d=activated?{activated:true,result:{periods:3,archivedGroups:3,studentMoves:0}}:{activated:false,source:'2026-2027',version:2,sourceGroups:[1,2,3],targetGroups:[4,5,6],plan:{policy:{periods:3,minimum:6,precision:0,ordinaryRounding:'truncate'}},blockers:ready?[]:['Origen: faltan sellos ordinarios.'],canActivate:ready&&S.role==='direccion_escolar',fingerprint:'a'.repeat(32)};return new Response(JSON.stringify({ok:true,data:d}),{headers:{'Content-Type':'application/json'}})}}''')
    page.add_script_tag(path=str(root/'assets/jaguar360-operations.js'))
    page.evaluate("document.getElementById('host').innerHTML=jaguarOperations.html()")
    page.locator('#jop_cycle').fill('2027-2028');page.get_by_text('Apertura de ciclo · experimental',exact=True).click()
    page.get_by_role('button',name='Revisar apertura de ciclo').click();page.get_by_text('Origen: faltan sellos ordinarios.',exact=True).wait_for()
    assert page.get_by_role('button',name='Abrir ciclo en pruebas').count()==0
    page.evaluate('ready=true');page.get_by_role('button',name='Revisar apertura de ciclo').click();page.get_by_role('button',name='Abrir ciclo en pruebas').wait_for()
    page.locator('#jop_cycle').fill('2028-2029');page.evaluate('jaguarOperations.activateCycle()');assert page.evaluate('posts.length')==0
    page.locator('#jop_cycle').fill('2027-2028');page.get_by_role('button',name='Revisar apertura de ciclo').click();page.get_by_role('button',name='Abrir ciclo en pruebas').click()
    page.get_by_text('Ciclo abierto en pruebas.',exact=False).wait_for();assert page.evaluate('posts.length')==1;assert page.evaluate('posts[0].fingerprint')=='a'*32;assert not errors,errors
    print('OK: blocked opening, stale target and confirmed opening (mock API)');browser.close()
