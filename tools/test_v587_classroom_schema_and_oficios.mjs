import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classroomDbProblem,CLASSROOM_DATA_TABLES,CLASSROOM_GRADE_RPC} from '../lib/classroom_schema_errors.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

for(const name of CLASSROOM_DATA_TABLES){
 const issue=classroomDbProblem({code:'PGRST205',message:`Could not find the table 'public.${name}' in the schema cache`});
 assert.equal(issue.status,409);
 assert.ok(issue.message.includes(name),`Identificar la tabla ${name}`);
 assert.ok(!issue.message.includes('Reconecta Google'));
}
let issue=classroomDbProblem({code:'PGRST202',message:`Could not find the function public.${CLASSROOM_GRADE_RPC} in the schema cache`});
assert.ok(issue.message.includes('función'));
assert.equal(issue.resource,CLASSROOM_GRADE_RPC);
issue=classroomDbProblem({code:'42703',message:'column "google_work_id" of relation "jaguar_classroom_trabajos_tipo" does not exist'});
assert.ok(issue.message.includes('columnas'));
issue=classroomDbProblem({code:'42501',message:'permission denied for table jaguar_classroom_alumnos'});
assert.equal(issue.status,403);
issue=classroomDbProblem({code:'23505',message:'duplicate key value violates unique constraint'});
assert.ok(issue.message.includes('existe'));
issue=classroomDbProblem({code:'99999',message:'error con datos sensibles matrícula SECRET-XYZ'});
assert.ok(!issue.message.includes('SECRET-XYZ'));

const route=read('routes/google-classroom.js');
assert.match(route,/action==='schema_status'/);
assert.match(route,/if\(!manager\)fail\('Diagnóstico exclusivo de Servicios Docentes\.',403\)/);
assert.match(route,/head:true/);
assert.doesNotMatch(route,/Falta ejecutar la migración SQL V5\.7\.4 o V5\.7\.5 de Classroom/);
const ui=read('assets/jaguar-classroom-v56.js');
assert.match(ui,/Diagnosticar tablas de Classroom/);
assert.match(ui,/j587checkSchema/);
const migration=read('sql/JAGUAR_V5_8_7_01_TABLAS_CLASSROOM.sql');
for(const table of CLASSROOM_DATA_TABLES)assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`));
for(const bad of [/\bDROP TABLE\b/i,/\bTRUNCATE\b/i,/\bDELETE FROM\b/i,/\bUPDATE public\.calificaciones\b/i])assert.doesNotMatch(migration,bad);
assert.equal((migration.match(/\bCOMMIT;/g)||[]).length,1);
assert.doesNotMatch(migration,/\$\$/);
const optionalRpc=read('sql/JAGUAR_V5_8_7_02_RPC_SOLO_SI_FALTA.sql');
assert.match(optionalRpc,/END;\s*\$\$;/);
assert.equal((optionalRpc.match(/\$\$/g)||[]).length,2);
const letters=read('lib/documentos_oficiales_pdf.js');
const formalOffice=read('lib/grade_batch_office_pdf.js');
assert.match(letters,/const esOficio=type\.startsWith\('OFI-'\)/);
assert.match(letters,/A T E N T A M E N T E/);
assert.match(formalOffice,/OFICIO DE REMISIÓN DE CALIFICACIONES/);
assert.match(formalOffice,/ANEXO DE CALIFICACIONES/);
assert.match(formalOffice,/accepted\?revision\.firma_docente_path:null/);
console.log('✓ Jaguar V5.8.7: errores SQL precisos, diagnóstico sin datos, reparación no destructiva, oficio formal y firma no simulada.');
