import crypto from 'node:crypto';
import { getClients, requireRoles } from '../lib/_admin.js';
import { documentStatus } from './documentos.js';
import { makeVerificationPdf } from '../lib/verificacion_pdf.js';

function hashToken(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function publicData(row,status){
  const payload=row?.datos_publicos&&typeof row.datos_publicos==='object'?row.datos_publicos:{};
  return {ok:true,estado:status,vista_pdf:'disponible',documento:{folio:row.folio,tipo:row.tipo,titulo:row.titulo,fecha_emision:row.fecha_emision,fecha_expiracion:row.fecha_expiracion,datos:payload}};
}

// Sólo un expediente clasificado EXPLÍCITAMENTE público en ambos campos
// puede entregar una vista basada en el archivo original. Los archivos de alumnos,
// pagos, credenciales y expedientes restringidos jamás salen por un enlace QR.
async function publicOriginalIfApproved(admin,row,status){
  if(status!=='valido')return null;
  const {data:official,error:oe}=await admin.from('documentos_oficiales_emitidos')
    .select('id,archivo_path,archivo_sha256,estado').eq('documento_verificable_id',row.id).limit(1).maybeSingle();
  if(oe||!official||official.estado!=='emitido'||!official.archivo_path)return null;
  const {data:archive,error:ae}=await admin.from('expedientes_documentales')
    .select('archivo_path,archivo_sha256,mime_type,size_bytes,estado,confidencialidad,alcance')
    .eq('documento_oficial_id',official.id)
    .eq('confidencialidad','publico').eq('alcance','publico').eq('estado','vigente').limit(1).maybeSingle();
  if(ae||!archive||archive.archivo_path!==official.archivo_path||archive.mime_type!=='application/pdf'||Number(archive.size_bytes)>8_000_000||Number(archive.size_bytes)<=0)return null;
  const expected=String(archive.archivo_sha256||'').toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected)||expected!==String(official.archivo_sha256||'').toLowerCase())return null;
  const {data:blob,error:downloadError}=await admin.storage.from('archivo-escolar').download(archive.archivo_path);
  if(downloadError||!blob)return null;
  const bytes=Buffer.from(await blob.arrayBuffer());
  if(bytes.length>8_000_000||crypto.createHash('sha256').update(bytes).digest('hex')!==expected)return null;
  return bytes;
}

export default async function handler(req,res){
  try{
    const {adminClient}=getClients(req);
    if(req.method==='GET'){
      const token=String(req.query?.token||'').trim();
      if(token.length<20||token.length>200)return res.status(400).json({ok:false,error:'Código de verificación inválido.'});
      const {data,error}=await adminClient.from('documentos_verificables')
        .select('id,folio,tipo,titulo,estado,fecha_emision,fecha_expiracion,datos_publicos,token_hash')
        .eq('token_hash',hashToken(token)).maybeSingle();
      if(error)throw error;
      if(!data)return res.status(404).json({ok:false,estado:'no_valido',error:'Documento no encontrado o código de verificación inválido.'});
      const status=documentStatus(data);
      if(status==='expirado'&&data.estado!=='expirado'){
        try{await adminClient.from('documentos_verificables').update({estado:'expirado'}).eq('id',data.id);}catch{}
      }
      res.setHeader('Cache-Control','private, no-store, max-age=0');
      res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
      if(String(req.query?.pdf||'')==='1'){
        let originalBytes=null;
        try{originalBytes=await publicOriginalIfApproved(adminClient,data,status);}catch{/* la vista pública nunca debe revelar el original si algo falla */}
        let pdf;
        try{pdf=await makeVerificationPdf({record:data,status,originalBytes});}
        catch{
          // Un PDF original corrupto no debe impedir visualizar la validación.
          pdf=await makeVerificationPdf({record:data,status,originalBytes:null});
        }
        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Disposition','inline; filename="verificacion-jaguar.pdf"');
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('Content-Security-Policy',"frame-ancestors 'self'");
        return res.status(200).send(pdf);
      }
      return res.status(200).json(publicData(data,status));
    }
    if(req.method==='POST'){
      const {user,profile}=await requireRoles(req,['control','control_escolar','direccion_escolar']);
      const b=req.body||{};const id=Number(b.id||0),action=String(b.action||'').trim();
      if(action==='list'){
        const {data,error}=await adminClient.from('documentos_verificables').select('id,folio,tipo,titulo,estado,fecha_emision,fecha_expiracion,alumno_id,datos_publicos').order('id',{ascending:false}).limit(500);
        if(error)throw error;
        return res.status(200).json({ok:true,data:data||[]});
      }
      if(!id||!['valido','cancelado','expirado'].includes(action))return res.status(400).json({ok:false,error:'Solicitud de estado inválida.'});
      const patch={estado:action,updated_at:new Date().toISOString(),updated_by:user.id};
      const {data,error}=await adminClient.from('documentos_verificables').update(patch).eq('id',id).select('id,folio,estado').single();
      if(error)throw error;
      return res.status(200).json({ok:true,data,message:`Documento ${data.folio} actualizado a ${action}.`});
    }
    return res.status(405).json({ok:false,error:'Método no permitido.'});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'No se pudo validar el documento.'});}
}
