import test from 'node:test';import assert from 'node:assert/strict';
import {canManagePublic,isPublicNotice,publicNotice,publicEditorial,adminEditorialAction} from '../lib/ithla_public_v8.js';
function mockDB(rows){return {from(table){const arr=rows[table]||[];const filters=[];const q={select(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},in(k,values){filters.push(x=>values.includes(x[k]));return q},order(){return q},limit(){return q},then(resolve){return resolve({data:arr.filter(x=>filters.every(f=>f(x))),error:null})}};return q}}}
test('Avisos internos antiguos nunca son públicos',()=>{
 assert.equal(isPublicNotice({activo:true,destino_publicacion:'plataforma'}),false);
 assert.equal(isPublicNotice({activo:true,destino_publicacion:'publica'}),true);
 assert.equal(isPublicNotice({activo:true,destino_publicacion:'ambas'}),true);
 assert.equal(isPublicNotice({activo:false,destino_publicacion:'ambas'}),false);
 assert.equal(isPublicNotice({activo:true,publicado:false,destino_publicacion:'ambas'}),false);
});
test('Formato público no incluye expediente, correo, CURP ni audiencia',()=>{
 const x=publicNotice({id:1,titulo:'Información',contenido:'Texto',fecha_publicacion:'2026-10-19',responsable_nombre:'Cargo autorizado',correo:'secreto@x.com',curp:'SECRETO',audiencia:['direccion_escolar']});
 assert.deepEqual(Object.keys(x).sort(),['contenido','descripcion','fecha_publicacion','id','responsable_nombre','titulo'].sort());
});
test('Publicación lee fuentes reales; solo directorios consentidos',async()=>{
 const rows={avisos:[{id:1,titulo:'Interno',activo:true,publicado:true,destino_publicacion:'plataforma'},{id:2,titulo:'Artículo',activo:true,publicado:true,destino_publicacion:'ambas'}],ithla_eventos_publicos:[{id:5,titulo:'Evento',descripcion:'prueba',fecha_inicio:'2026-11-03',estado:'publicado'}],ithla_public_directory_optin:[{departamento_clave:'DIR',visible:true},{departamento_clave:'CE',visible:false}],departamentos:[{id:10,clave:'DIR',nombre:'Dirección',activo:true},{id:11,clave:'CE',nombre:'Control Escolar',activo:true}],responsables_departamento:[{departamento_id:10,nombre_responsable:'Nombre autorizado',cargo:'Directivo',activo:true,es_director:true},{departamento_id:11,nombre_responsable:'Nombre reservado',cargo:'Otro',activo:true}]};
 const d=await publicEditorial(mockDB(rows));assert.equal(d.avisos.length,1);assert.equal(d.eventos.length,1);assert.equal(d.directorio_publico.length,1);assert.equal(d.directorio_publico[0].nombre,'Nombre autorizado');
});
test('Visitante, docente y alumno no administran contenido público',()=>{
 for(const r of ['visitante','docente','alumno',null])assert.equal(canManagePublic(r),false);
 for(const r of ['direccion_escolar','control_escolar','servicios_docentes','archivo_escolar','recursos_monetarios'])assert.equal(canManagePublic(r),true);
});
test('Solo roles autorizados ejecutan operaciones',async()=>{
 await assert.rejects(adminEditorialAction({}, {id:'u'}, {rol:'docente'},'admin-portal-event',{titulo:'Evento'}),e=>e.status===403);
});
test('Dirección obligatoria para publicar nombres',async()=>{
 await assert.rejects(adminEditorialAction({}, {id:'u'}, {rol:'control_escolar'},'admin-portal-directory',{clave:'DIR',visible:true}),e=>e.status===403);
});
test('Fechas inválidas se rechazan antes de tocar la base',async()=>{
 await assert.rejects(adminEditorialAction({}, {id:'u'}, {rol:'direccion_escolar'},'admin-portal-event',{titulo:'Anuncio real',fecha_inicio:'nunca'}),e=>e.status===400);
});
