/** Fotografías de credencial (Supabase Storage privado, sin nuevas tablas SQL).
 * El identificador numérico del alumno decide la ruta; el navegador nunca decide
 * qué bucket ni dónde se guarda la foto. Las fotos se normalizan a JPEG en el cliente.
 */
export const CREDENTIAL_PHOTO_BUCKET='credenciales-alumnos';
export const MAX_CREDENTIAL_PHOTO_BYTES=650_000;
export function credentialPhotoPath(alumnoId){
  const id=Number(alumnoId);
  if(!Number.isSafeInteger(id)||id<=0)throw Object.assign(new Error('Alumno no válido.'),{status:400});
  return `alumnos/${id}/credencial.jpg`;
}
export async function ensureCredentialPhotoBucket(admin){
  const {error}=await admin.storage.getBucket(CREDENTIAL_PHOTO_BUCKET);
  if(error&&/not found|does not exist|not exist|404/i.test(error.message||'')){
    const {error:creationError}=await admin.storage.createBucket(CREDENTIAL_PHOTO_BUCKET,{public:false,fileSizeLimit:MAX_CREDENTIAL_PHOTO_BYTES,allowedMimeTypes:['image/jpeg']});
    if(creationError&&!/already exists|duplicate/i.test(creationError.message||''))throw creationError;
  }else if(error)throw error;
}
export function inspectCredentialJpeg(bytes){
  // Revisa las dimensiones a partir de un marcador SOF de JPEG; no confiar
  // únicamente en la extensión .jpg ni en el Content-Type recibido.
  if(bytes.length<128||bytes[0]!==0xff||bytes[1]!==0xd8)throw Object.assign(new Error('La fotografía JPG está dañada.'),{status:400});
  for(let offset=2;offset<bytes.length-9;){
    if(bytes[offset]!==0xff){offset++;continue;}
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    const marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd8))continue;
    if(offset+2>bytes.length)break;
    const len=bytes.readUInt16BE(offset);
    if(len<2||offset+len>bytes.length)break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      if(len<7)break;
      const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
      if(width<160||height<180||width>6000||height>6000)throw Object.assign(new Error('La fotografía debe medir al menos 160 × 180 px y máximo 6000 × 6000 px.'),{status:400});
      return {width,height};
    }
    offset+=len;
  }
  throw Object.assign(new Error('No se pudieron comprobar las dimensiones de la fotografía JPG.'),{status:400});
}
export function decodeCredentialPhoto(base64){
  const raw=String(base64||'').trim();
  if(!raw||raw.length>Math.ceil(MAX_CREDENTIAL_PHOTO_BYTES*4/3)+20||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
    throw Object.assign(new Error('La fotografía debe ser JPG y tener menos de 650 KB.'),{status:400});
  const buf=Buffer.from(raw,'base64');
  const jpeg=buf.length>=128&&buf[0]===0xFF&&buf[1]===0xD8&&buf[2]===0xFF&&buf[buf.length-2]===0xFF&&buf[buf.length-1]===0xD9;
  if(!jpeg||buf.length>MAX_CREDENTIAL_PHOTO_BYTES)
    throw Object.assign(new Error('Formato de fotografía inválido. Sube un retrato JPG/PNG/WebP desde el formulario.'),{status:400});
  inspectCredentialJpeg(buf);
  return buf;
}
export async function readCredentialPhoto(admin,studentId,{required=false}={}){
  const path=credentialPhotoPath(studentId);
  const {data,error}=await admin.storage.from(CREDENTIAL_PHOTO_BUCKET).download(path);
  if(error||!data){
    if(/not found|does not exist|404|bucket not found|resource was not found/i.test(error?.message||'')){
      if(!required)return null;
      throw Object.assign(new Error('Este alumno aún no tiene una fotografía de credencial registrada.'),{status:409});
    }
    throw error||Object.assign(new Error('No fue posible leer la fotografía privada.'),{status:500});
  }
  const buf=Buffer.from(await data.arrayBuffer());
  if(buf.length<128||buf.length>MAX_CREDENTIAL_PHOTO_BYTES)throw Object.assign(new Error('La fotografía almacenada está dañada o supera el límite permitido.'),{status:409});
  inspectCredentialJpeg(buf);
  return buf;
}
export async function saveCredentialPhoto(admin,studentId,base64){
  const bytes=decodeCredentialPhoto(base64);
  await ensureCredentialPhotoBucket(admin);
  const path=credentialPhotoPath(studentId);
  const {error}=await admin.storage.from(CREDENTIAL_PHOTO_BUCKET).upload(path,bytes,{contentType:'image/jpeg',cacheControl:'0',upsert:true});
  if(error)throw error;
  return {path,bytes:bytes.length};
}
