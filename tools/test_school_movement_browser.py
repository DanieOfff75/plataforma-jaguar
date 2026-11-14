"""Synthetic UI smoke; no real database, identities or writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(); page.set_default_timeout(5000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="host"></div>')
    page.evaluate('''()=>{window.S={role:'control_escolar'};window.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.jaguarReadJson=r=>r.json();window.toast=x=>window.message=x;window.confirm=()=>true;window.prompt=q=>q.includes('Referencia')?'DOC-001':'Movimiento escolar documentado';window.posts=[];window.historyRows=[];window.current='activo';window.fetch=async(url,opts={})=>{const b=opts.body?JSON.parse(opts.body):null;if(b){posts.push(b);if(b.operation==='propose')historyRows=[{id:'4',cycle:b.cycle,type:b.type,target:b.group,fingerprint:b.fingerprint,state:'pending',reference:b.reference,reason:b.reason,actor:'Control Escolar'}];else if(b.operation==='approve'){current=b.type;historyRows[0].state='applied';historyRows[0].resolution={before:{state:'activo'},after:{state:current},reference:b.reference,actor:'Dirección'};}}const pending=historyRows.some(r=>r.state==='pending'),eligible=current==='activo';const d={before:{state:current,group:eligible?'4':null},eligible,pending,blockers:eligible?[]:['Estado incompatible'],fingerprint:'a'.repeat(32),canPropose:S.role==='control_escolar'&&eligible&&!pending,history:historyRows.map(r=>({...r,canReview:S.role==='direccion_escolar'&&r.state==='pending',canApprove:S.role==='direccion_escolar'&&r.state==='pending'&&eligible}))};return new Response(JSON.stringify({ok:true,data:d}),{headers:{'Content-Type':'application/json'}})}}''')
    page.add_script_tag(path=str(root/'assets/jaguar360-operations.js'))
    def setup():
        page.evaluate("document.getElementById('host').innerHTML=jaguarOperations.html()")
        page.locator('#jop_cycle').fill('2026-2027');page.locator('#jop_student').fill('5')
        page.get_by_text('Bajas, traslados y reincorporación · experimental',exact=True).click()
        page.locator('#jop_move_type').select_option('traslado')
        page.get_by_role('button',name='Consultar movimiento escolar').click()
    setup();page.get_by_role('button',name='Proponer movimiento en pruebas').click();page.get_by_text('Pendiente de Dirección',exact=False).wait_for();assert page.get_by_role('button',name='Autorizar y aplicar en pruebas').count()==0
    page.evaluate("S.role='direccion_escolar'");setup();page.get_by_role('button',name='Autorizar y aplicar en pruebas').click();page.get_by_text('Aplicado en pruebas',exact=False).wait_for();assert page.get_by_role('button',name='Autorizar y aplicar en pruebas').count()==0
    assert page.evaluate("posts.map(x=>[x.operation,x.type,x.fingerprint])")==[['propose','traslado','a'*32],['approve','traslado','a'*32]]
    page.locator('#jop_move_type').select_option('retorno');assert page.locator('#jop_move_target').is_visible();page.get_by_role('button',name='Consultar movimiento escolar').click();page.get_by_text('Indica el ID del alumno y, para retorno, el grupo destino.',exact=True).wait_for()
    assert not errors,errors;print('OK: proposal, independent approval, return target validation (mocked API)');browser.close()
