import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GOOGLE_SCOPES} from '../lib/google_classroom_oauth.js';
const route=readFileSync(new URL('../routes/google-classroom.js',import.meta.url),'utf8');
const oauth=readFileSync(new URL('../lib/google_classroom_oauth.js',import.meta.url),'utf8');
for(const scope of ['classroom.coursework.students.readonly','classroom.rosters.readonly','classroom.topics'])
 assert(GOOGLE_SCOPES.includes('https://www.googleapis.com/auth/'+scope),'OAuth solicita '+scope);
assert(!route.includes('Reconecta Google para autorizar consulta de actividades y alumnos de Classroom.'),'No debe lanzar un falso error por metadatos');
assert(!route.includes('connection?.permisos'),'No depende de metadata OAuth');
assert(route.includes('await googleStudents(token,course)'),'Consulta alumnos directamente en Google');
assert(route.includes('googleWork(token,course)'),'Consulta actividades directamente en Google');
assert(route.includes('Google rechazó consultar los alumnos'),'Explica problemas reales de Google');
assert(oauth.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT'),'Reconoce respuesta de Google por permisos insuficientes');
console.log('✓ V5.7.7: autorización real de Classroom sin falso aviso de reconexión (8 controles).');
