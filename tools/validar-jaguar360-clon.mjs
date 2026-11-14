#!/usr/bin/env node
/** Offline by default. Explicit execution only on a disposable schema-only local clone. */
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function loadPlan(){
 const plan=JSON.parse(fs.readFileSync(path.join(root,'sql/JAGUAR360_ORDEN_CLON.json'),'utf8'));
 if(plan.migrations.length!==39||new Set(plan.migrations).size!==plan.migrations.length)throw Error('Orden de migraciones incompleto.');
 for(const rel of [...plan.migrations,plan.audit]){if(!/^(sql|tests)\/[A-Za-z0-9_]+\.sql$/.test(rel)||!fs.statSync(path.join(root,rel)).isFile())throw Error('Archivo de migración inválido: '+rel);}
 return plan;
}
export function cloneTarget(host,database,port='5432'){
 if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('Solo conexión local explícita a un clon desechable.');
 if(typeof database!=='string'||!/^jaguar360_clon_[a-z0-9_]{1,40}$/.test(database))throw Error('El nombre de la base debe empezar por jaguar360_clon_.');
 if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Puerto inválido.');
 return ['-X','-w','-h',host,'-p',port,'-d',database,'-v','ON_ERROR_STOP=1','-A','-t','-q'];
}
export function assertCloneMarker(value,db){if(value.trim()!==db+'|validacion_sin_datos_reales')throw Error('Falta el marcador explícito de clon aislado. No se ejecutó ninguna migración.');}
function main(){
 const args=process.argv.slice(2),plan=loadPlan();
 if(!args.length||args[0]==='--plan'&&args.length===1){console.log(JSON.stringify(plan,null,2));console.log('Solo inventario; no se conectó a ninguna base.');return;}
 if(args.length!==5||args[0]!=='--ejecutar-clon'||args[4]!==args[2])throw Error('Uso: --ejecutar-clon 127.0.0.1 jaguar360_clon_NOMBRE 5432 jaguar360_clon_NOMBRE');
 const [,host,db,port]=args,base=cloneTarget(host,db,port);
 if(process.env.PGSERVICE||process.env.PGSERVICEFILE||process.env.PGOPTIONS||process.env.PGHOSTADDR)throw Error('Elimina PGSERVICE, PGSERVICEFILE, PGOPTIONS y PGHOSTADDR para no alterar el destino explícito.');
 const run=extra=>{const r=spawnSync('psql',[...base,...extra],{encoding:'utf8',maxBuffer:32*1024*1024});if(r.error)throw Error('No se pudo ejecutar psql: '+r.error.message);if(r.status!==0)throw Error((r.stderr||'psql falló').trim());return r.stdout;};
 const query="SELECT current_database()||'|'||coalesce(current_setting('jaguar360.isolated_clone',true),'')";
 assertCloneMarker(run(['-c',query]),db);
 // Precondition: sanitized pristine base schema with no previous Jaguar 360 plan migration.
 const pre=run(['-c',"SELECT CASE WHEN to_regclass('public.jaguar360_planes_ciclo') IS NULL AND to_regclass('public.perfiles') IS NOT NULL AND to_regclass('public.alumnos') IS NOT NULL AND to_regclass('public.periodos_escolares') IS NOT NULL AND to_regclass('public.jaguar_precision_calificaciones') IS NOT NULL AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))=3 THEN 'ok' ELSE 'blocked' END"]);
 if(pre.trim()!=='ok')throw Error('Prerrequisitos incompletos o clon ya migrado. Restaura una base desechable limpia y revisa las guías.');
 for(const [i,rel] of plan.migrations.entries()){console.log(`${i+1}/${plan.migrations.length}: ${rel}`);run(['-f',path.join(root,rel)]);}
 const audit=run(['-f',path.join(root,plan.audit)]).trim();if(audit){console.error(audit);throw Error('La auditoría detectó hallazgos. No autoriza producción.');}
 console.log('Migraciones ejecutadas y auditoría de catálogo sin hallazgos. Aún se requieren pruebas de autorización, concurrencia, datos ficticios y aceptación. No autoriza producción.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main()}catch(e){console.error(e.message);process.exitCode=1;}}
