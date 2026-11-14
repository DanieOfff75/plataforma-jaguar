"""Mocked API smoke test, no real account or DB."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="host"></div>')
    page.evaluate('''()=>{window.S={role:'control_escolar'};window.labels={};window.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.jaguarReadJson=r=>r.json();window.confirm=()=>true;window.prompt=()=> 'Resolución revisada y documentada.';window.posts=[];window.draft=null;window.ackAt=null;window.fetch=async(url,opts={})=>{let d={summary:{},insights:[]};if(url.includes('internal_notices')||opts.body){let b=opts.body?JSON.parse(opts.body):null;if(b){posts.push(b.operation);if(b.operation==='propose')draft={...b,id:'1',state:'propuesta',recipients:0,acknowledged:0};if(b.operation==='publish'){draft.state='publicado';draft.recipients=1;}if(b.operation==='ack'){ackAt='2026-11-14T12:00:00Z';draft.acknowledged=1;}}d={experimental:true,roles:['docente'],canPropose:S.role==='control_escolar',canResolve:S.role==='direccion_escolar',sent:draft&&S.role!=='docente'?[draft]:[],inbox:draft&&draft.state==='publicado'&&S.role==='docente'?[{...draft,ackAt,sentAt:'2026-11-14T11:00:00Z',senderRole:'control_escolar'}]:[]};}return new Response(JSON.stringify({ok:true,data:d}),{headers:{'Content-Type':'application/json'}})}}''')
    page.add_script_tag(path=str(root/'assets/jaguar360.js'))
    def setup(role):
        page.evaluate('async role=>{S.role=role;document.getElementById("host").innerHTML=await jaguar360Dashboard()}',role)
        page.get_by_text('Comunicados y acuses de recepción',exact=True).click();page.get_by_role('button',name='Consultar comunicados').click()
    setup('control_escolar');page.locator('#jn_subject').fill('Reunión <b>docente</b>');page.locator('#jn_body').fill('Aviso de reunión de coordinación.');page.locator('#jn_reference').fill('OF-001');page.locator('#jn_reason').fill('Informar al personal docente.');page.locator('input[name=jn_role][value=docente]').check();page.get_by_role('button',name='Proponer comunicado interno').click();page.get_by_text('Reunión <b>docente</b> · propuesta',exact=True).wait_for();assert page.get_by_role('button',name='Autorizar comunicado').count()==0
    setup('direccion_escolar');page.get_by_role('button',name='Autorizar comunicado').click();page.get_by_text('Reunión <b>docente</b> · publicado',exact=True).wait_for()
    setup('docente');page.get_by_role('button',name='Acusar recepción').click();page.get_by_text('Acuse:',exact=False).wait_for();assert page.get_by_role('button',name='Acusar recepción').count()==0;assert page.evaluate('posts')==['propose','publish','ack'];assert not errors,errors
    print('OK: proposal, independent review, acknowledgement, escaped text (mock API)');browser.close()
