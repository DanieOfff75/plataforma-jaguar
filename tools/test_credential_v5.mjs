/** Prueba offline: node tools/test_credential_v5.mjs
 * NO sustituye una prueba de emisión desde Supabase.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readFile as readFileAsync} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {decodeCredentialPhoto,readCredentialPhoto,saveCredentialPhoto,credentialPhotoPath} from '../lib/credential_photo.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const report=await readFileAsync(path.join(root,'api/reports.js'),'utf-8');
const data=await readFileAsync(path.join(root,'api/data.js'),'utf-8');
const html=await readFileAsync(path.join(root,'index.html'),'utf-8');
const pdf=await readFileAsync(path.join(root,'lib/credencial_escolar_pdf.js'),'utf-8');
assert.match(report,/action==='student_credential_photo_status'/);
assert.match(report,/action==='student_credential_photo_upload'/);
assert.match(report,/readCredentialPhoto\(admin,s\.id,\{required:true\}\)/);
assert.match(report,/contains\('datos_publicos',\{pago_folio:paymentFolio\}\)/);
assert.match(report,/archivo-escolar/);
assert.match(data,/readCredentialPhoto\(admin,alumnoId,\{required:true\}\)/);
assert.match(data,/credVoidError/);
for(const item of ['cred_photo_file','cred_photo_preview','jaguarCredentialPhotoChanged','jaguarCredentialPhotoStatus'])assert.ok(html.includes(item));
assert.match(pdf,/85\.6 x 54 mm/);
assert.match(pdf,/Garet-Book\.ttf/);
assert.match(pdf,/Garet-Heavy\.ttf/);
assert.match(pdf,/qrBytes/);
for(const f of ['Garet-Book.ttf','Garet-Heavy.ttf'])assert.ok(readFileSync(path.join(root,'assets/fonts',f)).length>10000);
assert.equal(credentialPhotoPath(3),'alumnos/3/credencial.jpg');
assert.throws(()=>credentialPhotoPath(-4));
assert.throws(()=>decodeCredentialPhoto('any bad file'));
// Foto JPEG pequeña sintetizada por Pillow, libre de información personal.
const sample=readFileSync(path.join(root,'tools/fixtures/credencial-demo.jpg'));
assert.deepEqual(decodeCredentialPhoto(sample.toString('base64')),sample);
let last;
const admin={storage:{getBucket:async()=>({data:{name:'credenciales-alumnos'},error:null}),from:()=>({upload:async(path,data,opts)=>{last={path,data,opts};return {error:null};},download:async(path)=>path===last?.path?{data:new Blob([last.data]),error:null}:{data:null,error:{message:'Object not found'}}})}};
await saveCredentialPhoto(admin,42,sample.toString('base64'));
assert.equal(last.path,'alumnos/42/credencial.jpg');
assert.equal(last.opts.upsert,true);
assert.equal(last.opts.contentType,'image/jpeg');
assert.deepEqual(await readCredentialPhoto(admin,42,{required:true}),sample);
assert.equal(await readCredentialPhoto(admin,41),null);
await assert.rejects(()=>readCredentialPhoto(admin,41,{required:true}),/aún no tiene/);
console.log('OK: credencial V5 - fotografía, rutas privadas, controles, presencia de acciones y fuentes.');
