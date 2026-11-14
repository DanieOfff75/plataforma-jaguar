"""Synthetic 6-period academic report smoke; no official PDF, no database."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(accept_downloads=True); page.set_default_timeout(5000)
    errors=[];downloads=[];page.on('pageerror',lambda e: errors.append(str(e)));page.on('download',lambda d:downloads.append(d))
    page.set_content('<div id="host"></div>')
    page.evaluate('''()=>{window.S={role:'control_escolar'};window.supabaseClient={auth:{getSession:async()=>({data:{session:{access_token:'mock'}}})}};window.jaguarReadJson=r=>r.json();window.fetch=async()=>new Response(JSON.stringify({ok:true,data:{student:'10',cycle:'2024-2025',official:false,state:'pending',planVersion:4,fingerprint:'a'.repeat(32),periods:Array.from({length:6},(_,i)=>({number:i+1,verified:i<5})),subjects:[{key:'MAT',name:'Matemáticas',state:'pending',evaluation:'numerica'},{key:'TALL',name:'Taller <img src=x onerror=alert(1)>',state:'pending',evaluation:'cualitativa'}],rows:[{subjectKey:'MAT',subject:'Matemáticas',period:1,sealed:5,ordinary:5,effective:7.75,recoveryCalls:'123',present:9,absent:1},{subjectKey:'TALL',subject:'Taller',period:1,sealed:'RP',ordinary:'RP',effective:'AP'}],csv:'Informe NO ES BOLETA'}}),{headers:{'Content-Type':'application/json'}})}''')
    page.add_script_tag(path=str(root/'assets/jaguar360-operations.js'));page.evaluate("document.getElementById('host').innerHTML=jaguarOperations.html()")
    page.locator('#jop_cycle').fill('2024-2025');page.locator('#jop_student').fill('10')
    page.get_by_role('button',name='Consultar informe histórico detallado').click()
    page.get_by_text('Efectiva: 7.75',exact=True).first.wait_for()
    assert page.get_by_text('Efectiva: AP',exact=True).first.is_visible()
    assert page.locator('#jop_report th').filter(has_text='P6').first.inner_text().endswith('Sin sello')
    assert page.locator('#jop_report img').count()==0
    assert page.get_by_text('Sin evidencia conciliada',exact=True).count()==10
    assert not downloads and not errors,(downloads,errors)
    print('OK: 6-period matrix, exact decimals, AP/RP, missing evidence, escaped text and no automatic download (mock API)')
    browser.close()
