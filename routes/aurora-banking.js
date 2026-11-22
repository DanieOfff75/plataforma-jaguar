/** Jaguar / Recursos Monetarios ↔ Banco Aurora.
 * Solo el servidor conserva el convenio privado.
 * Solo acredita pagos tras prueba bancaria privada; nunca recibe números de tarjeta ni comparte datos personales.
 */
import {requireRoles} from '../lib/_admin.js';

const BANK='https://banco-aurora.vercel.app';
const BAD=(status,message)=>Object.assign(new Error(message),{status});
function cents(raw){
 const value=String(raw??'');
 if(!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(value))throw BAD(422,'Importe financiero no válido.');
 const [whole,fraction='']=value.split('.');
 return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
const money=n=>String(n/100n)+'.'+String(n%100n).padStart(2,'0');
const validUuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);

async function bankRequest(path,method='GET',payload=null){
 const secret=process.env.AURORA_MERCHANT_KEY;
 if(!secret||secret.length!==64)throw BAD(503,'No se ha configurado el convenio privado con Banco Aurora.');
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch(BANK+path,{
   method,headers:{authorization:'Bearer '+secret,'content-type':'application/json'},
   ...(payload?{body:JSON.stringify(payload)}:{}),signal:controller.signal
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw BAD(r.status===409?409:502,r.status===409?(data.error||'Solicitud de cobro incompatible.'):'Banco Aurora no confirmó esta solicitud.');
  return data;
 }catch(e){if(e.status)throw e;throw BAD(503,'No fue posible contactar Banco Aurora.');}
 finally{clearTimeout(timeout);}
}

async function loadCharge(db,cargoId){
 if(!Number.isSafeInteger(cargoId)||cargoId<=0)throw BAD(400,'Identificador de cargo no válido.');
 const {data:c,error}=await db.from('recursos_cargos').select('id,folio,importe,estado').eq('id',cargoId).maybeSingle();
 if(error||!c)throw BAD(404,'Cargo escolar no encontrado.');
 if(!['pendiente','parcial'].includes(c.estado))throw BAD(409,'El cargo no está pendiente de pago.');
 const p=await db.from('recursos_pagos').select('importe').eq('cargo_id',cargoId).eq('estado','registrado').limit(501);
 if(p.error)throw BAD(503,'No fue posible conciliar los pagos del cargo.');
 if((p.data||[]).length>500)throw BAD(409,'El cargo requiere revisión manual de conciliación.');
 const already=(p.data||[]).reduce((s,row)=>s+cents(row.importe),0n);
 const total=cents(c.importe);
 const due=total-already;
 if(due<=0n)throw BAD(409,'El cargo ya está cubierto.');
 return {cargo:c,already,due,externalChargeRef:'ITHLA-CARGO-'+cargoId+'-P'+already.toString()};
}

export default async function auroraBanking(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.method!=='POST')throw BAD(405,'Método no permitido.');
  const origin=String(req.headers.origin||'');
  if(origin&&new URL(origin).host!==String(req.headers.host||''))throw BAD(403,'Origen no permitido.');
  const {user,adminClient}=await requireRoles(req,['recursos_monetarios','direccion_escolar']);
  const action=String(req.body?.action||'');
  if(action==='bank_balance'){
    const bank=await bankRequest('/api/merchant/account-status');
    const r=await adminClient.rpc('jaguar_recursos_saldo_cuenta',{p_cuenta_id:2,p_fecha:new Date().toISOString().slice(0,10)});
    if(r.error)throw BAD(503,'No se pudo calcular el saldo bancario escolar.');
    const jaguarBalance=String(r.data||0);
    const difference=money(cents(bank.balance)-cents(jaguarBalance));
    return res.status(200).json({ok:true,
      bank:{name:'Banco Aurora · ITHLA',balance:bank.balance,currency:bank.currency,last4:bank.accountEnding},
      jaguar:{name:'Cuenta bancaria unificada ITHLA',balance:jaguarBalance,currency:'MXN'},
      difference,matched:cents(bank.balance)===cents(jaguarBalance),
      cashSeparate:true});
  }
  const cargoId=Number(req.body?.cargoId);
  if(['verify','verify_incoming','status'].includes(action)){
    const ref=String(req.body?.reference||'').trim().toUpperCase(),intentId=String(req.body?.intentId||'');
    let q=adminClient.from('recursos_aurora_verificaciones').select('cargo_id,referencia,importe,recurso_pago_id');
    if(action==='verify_incoming'&&/^AU-[A-F0-9]{32}$/.test(ref))q=q.eq('referencia',ref);
    else if(validUuid(intentId))q=q.eq('aurora_intent_id',intentId);
    else q=null;
    if(q){
      const {data:prior,error:previousError}=await q.maybeSingle();
      if(previousError)throw BAD(503,'No se pudo consultar la conciliación previa.');
      if(prior){
        if(Number(prior.cargo_id)!==cargoId)throw BAD(409,'La referencia pertenece a otro cargo.');
        if(prior.recurso_pago_id)return res.status(200).json({ok:true,verified:true,already:true,
          reference:prior.referencia,amount:String(prior.importe),paymentId:prior.recurso_pago_id,status:'authorized'});
        throw BAD(409,'La referencia tiene una conciliación anterior pendiente de revisión.');
      }
    }
  }
  const record=await loadCharge(adminClient,cargoId);
  if(action==='verify_incoming'){
    const ref=String(req.body?.reference||'').trim().toUpperCase();
    if(!/^AU-[0-9A-F]{32}$/.test(ref))throw BAD(400,'Referencia Aurora inválida.');
    const payment=await bankRequest('/api/merchant/received/'+encodeURIComponent(ref));
    if(payment.state!=='received'||!['deposit','internal'].includes(payment.type))
      throw BAD(409,'La referencia no representa un depósito o transferencia confirmada.');
    if(cents(payment.amount)!==record.due)throw BAD(409,'El abono no coincide con el saldo pendiente del cargo escolar.');
    const {data:credited,error:dbErr}=await adminClient.rpc('jaguar_aurora_acreditar_pago_verificado',{
      p_intent:payment.operationId,p_cargo:cargoId,p_ref:payment.reference,p_amount:payment.amount,
      p_actor:user.id,p_method:payment.type==='deposit'?'deposito':'transferencia'});
    if(dbErr)throw BAD(409,'Banco Aurora confirmó el abono, pero Jaguar no pudo acreditarlo: '+dbErr.message);
    return res.status(200).json({ok:true,verified:true,reference:payment.reference,amount:payment.amount,
      paymentId:credited?.pago_id,note:'Abono acreditado en la cuenta bancaria ITHLA y aplicado al cargo escolar.'});
  }
  if(action==='create'){
   const p=await bankRequest('/api/merchant/intents','POST',{
    externalChargeRef:record.externalChargeRef,amount:money(record.due)
   });
   return res.status(200).json({ok:true,chargeId:cargoId,amount:money(record.due),
    intentId:p.intentId,checkoutUrl:p.checkoutUrl,status:p.state});
  }
  if(action==='status'||action==='verify'){
   const id=req.body?.intentId;
   if(!validUuid(id))throw BAD(400,'Solicitud de pago inválida.');
   const p=await bankRequest('/api/merchant/intents/'+encodeURIComponent(id));
   if(p.externalChargeRef!==record.externalChargeRef||cents(p.amount)!==record.due)
    throw BAD(409,'La referencia o el importe no coinciden con el saldo pendiente.');
   if(action==='status')return res.status(200).json({ok:true,status:p.state,amount:p.amount,reference:p.state==='authorized'?p.reference:null});
   if(p.state!=='authorized'||!/^AU-[0-9a-f]{32}$/i.test(String(p.reference||'')))throw BAD(409,'Banco Aurora todavía no ha confirmado el pago.');
   const {data:credited,error:dbErr}=await adminClient.rpc('jaguar_aurora_acreditar_pago_verificado',{
     p_intent:p.id,p_cargo:cargoId,p_ref:p.reference,p_amount:p.amount,p_actor:user.id,p_method:'tarjeta'});
   if(dbErr)throw BAD(409,'Aurora recibió el pago, pero Jaguar requiere conciliarlo: '+dbErr.message);
   return res.status(200).json({ok:true,verified:true,reference:p.reference,amount:p.amount,
     paymentId:credited?.pago_id,note:'Cargo escolar liquidado con pago virtual confirmado desde Banco Aurora.'});
  }
  throw BAD(400,'Operación desconocida.');
 }catch(error){
  if(!error.status)console.error('Aurora bridge error:',error.code||error.name||'unexpected');
  return res.status(error.status||500).json({ok:false,error:error.status?error.message:'No se pudo completar la consulta financiera.'});
 }
}
