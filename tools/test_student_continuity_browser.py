"""Student confirms/withdraws own recorded continuity intention, mock API only."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<div id="host"></div>')
    page.evaluate('''()=>{window.S={role:'alumno'};window.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.jaguarReadJson=r=>r.json();window.toast=x=>window.message=x;window.confirm=()=>true;window.posts=[];window.state=null;window.fetch=async(url,opts={})=>{const b=opts.body?JSON.parse(opts.body):null;let d;if(String(url).includes('student_continuity')||b?.action==='student_continuity'){if(b){posts.push(b);state=b.response;}d={decision:{id:'9007199254740993',state:'provisional_eligible',targetCycle:'2027-2028',targetGrade:2},confirmation:state?{state}:null,canRespond:true,enrolled:false};}else d={rows:[],summary:{}};return new Response(JSON.stringify({ok:true,data:d}),{headers:{'Content-Type':'application/json'}})}}''')
    page.add_script_tag(path=str(root/'assets/jaguar360.js'));page.evaluate("async()=>{document.getElementById('host').innerHTML=await jaguar360Page()}")
    page.get_by_text('Confirmar continuidad escolar · experimental',exact=True).click();page.locator('#j360-cont-cycle').fill('2026-2027');page.get_by_role('button',name='Consultar continuidad').click();page.get_by_text('Continuidad provisional',exact=True).wait_for();page.get_by_role('button',name='Confirmar continuidad',exact=True).click();page.get_by_role('button',name='Retirar confirmación',exact=True).click();page.get_by_text('Confirmación retirada.',exact=False).wait_for()
    assert page.evaluate('posts.map(b=>b.response)')==['confirmada','retirada'];assert page.evaluate('posts.every(b=>b.decision==="9007199254740993" && !b.student)');assert not errors,errors
    print('OK: student consultation, explicit confirmation, withdrawal, bigint identity and no student ID input (mock API)');browser.close()
