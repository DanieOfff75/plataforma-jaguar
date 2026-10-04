import crypto from 'node:crypto';

function clean(v,max=2000){return String(v??'').trim().slice(0,max);}
function publicBaseUrl(req=null){
  const configured=String(process.env.PUBLIC_APP_URL||'').trim().replace(/\/$/,'');
  if(configured)return configured;
  const host=String(req?.headers?.['x-forwarded-host']||req?.headers?.host||'localhost:3000').split(',')[0].trim();
  const proto=String(req?.headers?.['x-forwarded-proto']||'https').split(',')[0].trim();
  return `${proto}://${host}`;
}
function token(){return crypto.randomBytes(32).toString('base64url');}
function hashToken(value){return crypto.createHash('sha256').update(String(value)).digest('hex');}
function safePublicPayload(payload={}){
  const out={};
  for(const [k,v] of Object.entries(payload||{})){
    if(v===undefined||v===null)continue;
    if(['string','number','boolean'].includes(typeof v))out[k]=typeof v==='string'?clean(v,1000):v;
    else if(Array.isArray(v))out[k]=v.slice(0,100).map(x=>safePublicPayload(x));
    else if(typeof v==='object')out[k]=safePublicPayload(v);
  }
  return out;
}

export async function registerVerifiableDocument(admin,{folio,tipo,titulo,alumno_id=null,fecha_emision=null,fecha_expiracion=null,payload={},created_by=null,req=null}){
  const cleanFolio=clean(folio,120); if(!cleanFolio)throw new Error('El documento no tiene folio de validación.');
  const cleanTipo=clean(tipo,60)||'documento';
  const cleanTitle=clean(titulo,160)||cleanTipo;
  const rawToken=token();
  const base=publicBaseUrl(req);
  const verificationUrl=`${base}/verificar.html?token=${encodeURIComponent(rawToken)}`;
  const row={
    folio:cleanFolio,tipo:cleanTipo,titulo:cleanTitle,alumno_id:alumno_id?Number(alumno_id):null,
    token_hash:hashToken(rawToken),estado:'valido',fecha_emision:fecha_emision||new Date().toISOString(),
    fecha_expiracion:fecha_expiracion||null,datos_publicos:safePublicPayload(payload),created_by:created_by||null
  };
  const {data,error}=await admin.from('documentos_verificables').insert(row).select('id,folio,tipo,titulo,estado,fecha_emision,fecha_expiracion').single();
  if(error)throw error;
  return {id:data.id,token:rawToken,verificationUrl,row:data};
}

export async function qrPng(verificationUrl,{size=180}={}){
  const url=`https://quickchart.io/qr?text=${encodeURIComponent(String(verificationUrl))}&size=${Number(size)||180}&margin=1&ecLevel=M`;
  const response=await fetch(url,{headers:{'User-Agent':'JAGUAR-Document-QR/1.0'}});
  if(!response.ok)throw new Error(`No se pudo generar el código QR (${response.status}).`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length)throw new Error('El generador QR devolvió una imagen vacía.');
  return bytes;
}

export async function deleteVerifiableDocument(admin,id){if(!id)return;try{await admin.from('documentos_verificables').delete().eq('id',id);}catch{} }

export function documentStatus(row){
  if(!row)return 'no_valido';
  if(row.estado==='cancelado')return 'cancelado';
  if(row.estado==='expirado')return 'expirado';
  if(row.fecha_expiracion && new Date(row.fecha_expiracion).getTime()<=Date.now())return 'expirado';
  return 'valido';
}

export function verificationPublicBase(req){return publicBaseUrl(req);}
