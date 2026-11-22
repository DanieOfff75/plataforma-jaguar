/* Banco Aurora · puente seguro en Recursos Monetarios.
 * Cada abono verificado se acredita una sola vez al cargo escolar.
 */
(async()=>{ /* Módulo cargado sin operaciones automáticas */ })();

async function jaguarAuroraFinanceAction(action,cargoId,intentId=''){
 const {data:{session}}=await supabaseClient.auth.getSession();
 if(!session?.access_token)throw Error('Debes iniciar sesión nuevamente.');
 const r=await fetch('/api/aurora-banking',{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
  body:JSON.stringify({action,cargoId,intentId})
 });
 const d=await r.json().catch(()=>({}));
 if(!r.ok||!d.ok)throw Error(d.error||'No se pudo consultar Banco Aurora.');
 return d;
}
window.jaguarAuroraBalanceForm=async function jaguarAuroraBalanceForm(){
 if(!['recursos_monetarios','direccion_escolar'].includes(S.role))return;
 modal('🏦 Conciliación bancaria · Banco Aurora',
  '<div class="space-y-4"><p class="text-sm">Consultando saldo en Aurora y en la cuenta unificada de Recursos Monetarios…</p><div id="ja_balance_view" class="card">Cargando conciliación…</div><p class="text-xs text-[#A9BAC8]">Caja en efectivo se contabiliza por separado. Los saldos bancarios virtuales se verifican sin crear ingresos.</p><button id="ja_balance_refresh" class="btn">Actualizar saldos</button></div>');
 const run=async()=>{
  const node=document.getElementById('ja_balance_view');if(!node)return;
  node.textContent='Consultando…';
  try{
   const d=await jaguarAuroraFinanceAction('bank_balance',0);
   if(!node.isConnected)return;
   const box=document.createElement('div');box.className='space-y-3';
   const rows=[
    ['Banco Aurora · cuenta empresarial ITHLA',d.bank.balance+' '+d.bank.currency],
    ['Recursos Monetarios · cuenta bancaria unificada',d.jaguar.balance+' '+d.jaguar.currency],
    ['Diferencia de conciliación',d.difference+' MXN']
   ];
   for(const [label,value] of rows){
    const row=document.createElement('div');row.className='flex justify-between gap-4 border-b border-white/10 py-2';
    const a=document.createElement('span'),b=document.createElement('strong');
    a.textContent=label;b.textContent=value;row.append(a,b);box.append(row);
   }
   const summary=document.createElement('p');
   summary.className=d.matched?'text-emerald-300 font-semibold':'text-amber-300 font-semibold';
   summary.textContent=d.matched?'✓ Saldos conciliados':'⚠ Los saldos son diferentes. Revisa pagos y movimientos no verificados.';
   box.append(summary);node.replaceChildren(box);
  }catch(e){node.textContent='No se pudo obtener la conciliación: '+e.message;}
 };
 document.getElementById('ja_balance_refresh')?.addEventListener('click',run);
 await run();
};
window.jaguarAuroraPaymentForm=function jaguarAuroraPaymentForm(){
 if(!['recursos_monetarios','direccion_escolar'].includes(S.role))return;
 const d=window._jaguarFinance||{};
 const pending=(d.charges||[]).filter(x=>Number(x.remaining||0)>0);
 modal('✨ Cobros con Banco Aurora',`
 <div class="space-y-4">
 <p class="text-sm text-[#A9BAC8]">Selecciona un cargo pendiente. Aurora mostrará al titular la pantalla de autorización; el instituto no recibe los datos de su tarjeta.</p>
 <label class="block text-sm">Cargo pendiente
 <select id="ja_aurora_charge" class="select mt-2">
 ${pending.map(x=>`<option value="${Number(x.id)}">${esc(x.folio||'Cargo '+x.id)} · ${esc(x.alumnos?.nombre_completo||'')} · pendiente ${financeMoney(x.remaining)}</option>`).join('')}
 </select></label>
 <button id="ja_aurora_create" class="btn primary w-full" ${pending.length?'':'disabled'}>Generar enlace de pago</button>
 <div id="ja_aurora_link" class="card text-sm" hidden></div>
 <label class="block text-sm">ID de solicitud Aurora
 <input id="ja_aurora_intent" class="input mt-2" placeholder="Identificador UUID" autocomplete="off"></label>
 <div class="flex flex-wrap gap-2">
 <button id="ja_aurora_status" class="btn" type="button">Consultar estado</button>
 <button id="ja_aurora_verify" class="btn primary" type="button">Verificar pago</button>
 </div>
 <div class="card space-y-2">
 <h4 class="font-semibold">Verificar depósito o transferencia recibida</h4>
 <p class="text-xs text-[#A9BAC8]">Cuando el pagador transfiera desde Aurora a la cuenta empresarial ITHLA o deposite en ventanilla, introduce aquí la referencia AU-... del comprobante.</p>
 <input id="ja_aurora_incoming" class="input" placeholder="AU-..." pattern="AU-[a-fA-F0-9]{32}" autocomplete="off">
 <button id="ja_aurora_verify_incoming" class="btn" type="button">Verificar abono bancario</button>
 </div>
 <div id="ja_aurora_result" class="text-sm text-[#A9BAC8]" role="status"></div>
 <p class="text-xs text-[#A9BAC8]">La verificación desde el servidor acredita el cargo escolar una sola vez en la cuenta bancaria unificada.</p>
 </div>`);
 const getCharge=()=>Number(document.getElementById('ja_aurora_charge')?.value||0);
 const show=m=>{const el=document.getElementById('ja_aurora_result');if(el)el.textContent=m;};
 document.getElementById('ja_aurora_create')?.addEventListener('click',async()=>{
  const btn=document.getElementById('ja_aurora_create');btn.disabled=true;
  try{
   const r=await jaguarAuroraFinanceAction('create',getCharge());
   document.getElementById('ja_aurora_intent').value=r.intentId;
   const u=new URL(r.checkoutUrl);
   if(u.protocol!=='https:'||u.hostname!=='banco-aurora.vercel.app'||!/^\/checkout\/[0-9a-f-]{36}$/i.test(u.pathname))
    throw Error('La dirección bancaria no es válida.');
   const box=document.getElementById('ja_aurora_link');
   box.replaceChildren();
   const p=document.createElement('p');p.textContent='Importe: '+r.amount+' MXN · Enlace temporal de pago';
   const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.className='btn primary inline-block mt-2';a.textContent='Abrir pago en Banco Aurora';
   box.append(p,a);box.hidden=false;
   show('Enlace generado. El titular puede pagar desde Banco Aurora.');
  }catch(e){show(e.message)}finally{btn.disabled=false;}
 });
 document.getElementById('ja_aurora_status')?.addEventListener('click',async()=>{
  try{
   const id=document.getElementById('ja_aurora_intent').value.trim();
   const r=await jaguarAuroraFinanceAction('status',getCharge(),id);
   show('Estado: '+r.status+' · Importe: '+r.amount+' MXN'+(r.reference?' · Referencia: '+r.reference:''));
  }catch(e){show(e.message)}
 });
 document.getElementById('ja_aurora_verify_incoming')?.addEventListener('click',async()=>{
  const btn=document.getElementById('ja_aurora_verify_incoming');btn.disabled=true;
  try{
   const reference=document.getElementById('ja_aurora_incoming').value.trim().toUpperCase();
   if(!/^AU-[a-f0-9]{32}$/i.test(reference))throw Error('Introduce la referencia completa AU-...');
   const {data:{session}}=await supabaseClient.auth.getSession();
   if(!session?.access_token)throw Error('Sesión vencida. Inicia sesión nuevamente.');
   const rsp=await fetch('/api/aurora-banking',{method:'POST',headers:{
    'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({action:'verify_incoming',cargoId:getCharge(),reference})});
   const out=await rsp.json();
   if(!rsp.ok||!out.ok)throw Error(out.error||'No se pudo verificar el abono');
   show('Abono confirmado: '+out.amount+' MXN. Referencia '+out.reference+'. Cargo escolar acreditado.');
  }catch(e){show(e.message)}finally{btn.disabled=false;}
 });
 document.getElementById('ja_aurora_verify')?.addEventListener('click',async()=>{
  const btn=document.getElementById('ja_aurora_verify');btn.disabled=true;
  try{
   const id=document.getElementById('ja_aurora_intent').value.trim();
   const r=await jaguarAuroraFinanceAction('verify',getCharge(),id);
   show('Confirmado: '+r.reference+' · '+r.amount+' MXN. Cargo escolar acreditado.');
  }catch(e){show(e.message)}finally{btn.disabled=false;}
 });
};
