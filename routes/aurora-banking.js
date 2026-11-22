/** Jaguar / Recursos Monetarios ↔ Banco Aurora.
 * Solo el servidor conserva el convenio privado.
 * No inserta pagos, no modifica cargos y no comparte datos personales de alumnos.
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
  const cargoId=Number(req.body?.cargoId);
  const record=await loadCharge(adminClient,cargoId);
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
   const details={aurora_intent_id:p.id,cargo_id:cargoId,referencia:p.reference,importe:p.amount,validado_por:user.id};
   const ins=await adminClient.from('recursos_aurora_verificaciones').insert(details).select('id').maybeSingle();
   if(ins.error&&ins.error.code!=='23505')throw BAD(503,'No se pudo registrar la verificación.');
   if(ins.error){
    const old=await adminClient.from('recursos_aurora_verificaciones').select('id,cargo_id,importe,referencia').eq('aurora_intent_id',id).maybeSingle();
    if(old.error||!old.data||old.data.cargo_id!==cargoId||old.data.referencia!==p.reference||cents(old.data.importe)!==record.due)
     throw BAD(409,'Esta referencia ya pertenece a otra conciliación.');
   }
   return res.status(200).json({ok:true,verified:true,reference:p.reference,amount:p.amount,
    note:'Verificación almacenada; el asiento de recursos_pagos requiere conciliación institucional.'});
  }
  throw BAD(400,'Operación desconocida.');
 }catch(error){
  if(!error.status)console.error('Aurora bridge error:',error.code||error.name||'unexpected');
  return res.status(error.status||500).json({ok:false,error:error.status?error.message:'No se pudo completar la consulta financiera.'});
 }
}
