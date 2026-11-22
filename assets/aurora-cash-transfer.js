/* Aurora institutional cash desk transfer; loaded as independent Jaguar module. */
window.jaguarAuroraCashTransferForm=function jaguarAuroraCashTransferForm(){
 if(!['recursos_monetarios','direccion_escolar'].includes(S.role))return;
 const html=[
 '<div class="space-y-4">',
 '<p class="text-sm">Primero registra en la sucursal Aurora un depósito de <strong>caja institucional ITHLA</strong> hacia la cuenta empresarial del instituto. Copia la referencia del ticket.</p>',
 '<div class="card"><p>Origen: Caja institucional ITHLA</p><p>Destino: Cuenta bancaria unificada · Banco Aurora</p>',
 '<p>Es un traspaso de saldos, no una colegiatura ni un ingreso nuevo.</p></div>',
 '<label class="block text-sm">Referencia de ventanilla<input id="ja_cash_reference" class="input mt-2" placeholder="AU-..." maxlength="35"></label>',
 '<button id="ja_cash_submit" class="btn primary w-full" type="button">Verificar depósito y pasar caja a banco</button>',
 '<div id="ja_cash_result" role="status" class="text-sm"></div></div>'
 ].join('');
 modal('💵 Enviar efectivo a Banco Aurora',html);
 const button=document.getElementById('ja_cash_submit'),output=document.getElementById('ja_cash_result');
 button?.addEventListener('click',async()=>{
  const reference=String(document.getElementById('ja_cash_reference')?.value||'').trim().toUpperCase();
  if(!/^AU-[A-F0-9]{32}$/.test(reference)){output.textContent='Referencia bancaria inválida.';return;}
  button.disabled=true;output.textContent='Verificando el depósito en Aurora…';
  try{
   const {data:{session}}=await supabaseClient.auth.getSession();
   if(!session?.access_token)throw Error('Inicia sesión nuevamente.');
   const response=await fetch('/api/aurora-banking',{method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({action:'cash_transfer',reference})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok)throw Error(result.error||'Depósito no conciliado');
   output.textContent=(result.already?'Depósito ya conciliado.':'Traspaso conciliado.')+
    ' Importe: $'+result.amount+' MXN. Referencia '+result.reference+'. Asiento '+result.transferId+'.';
  }catch(e){output.textContent='No se traspasó el saldo: '+e.message;}
  finally{button.disabled=false;}
 });
};