import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const file=p=>readFileSync(new URL(p,root),'utf8');
const js=file('assets/jaguar-teacher-transitions.js');
const api=file('routes/teacher-transition.js');
const sql=file('sql/ITHLA_RELEVO_02_ADOPCION_ACTIVIDADES.sql');
const pdf=file('lib/jaguar_relevo_rubrica_pdf.js');
test('la interfaz ofrece vista previa y descarga PDF para cada rúbrica',()=>{
 assert.match(js,/Previsualizar PDF/);assert.match(js,/Descargar PDF/);
 assert.match(js,/rubricPDF\(\$\{Number\(v\.id\)\},\$\{Number\(x\.id\)\}/);
});
test('las solicitudes de PDF exigen sesión y el relevo correcto en servidor',()=>{
 assert.match(api,/mode==='rubrica_pdf'/);assert.match(api,/role!=='docente'/);
 assert.match(api,/Number\(v\.docente_nuevo_id\)!==Number\(teacher\.id\)/);
 assert.match(api,/Number\(rb\.docente_id\)!==Number\(v\.docente_anterior_id\)/);
 assert.match(api,/Content-Type','application\/pdf'/);
});
test('la adopción de actividades verifica rol y llama función SQL',()=>{
 assert.match(api,/action==='adoptar_actividades'/);
 assert.match(api,/rpc\('jaguar_relevo_adoptar_actividades'/);
 assert.match(js,/Adoptar \$\{cols.length\} actividades/);
});
test('la adopción registra procedencia e impide repetición',()=>{
 assert.match(sql,/UNIQUE\(vacante_id,bitacora_origen_id\)/);
 assert.match(sql,/INSERT INTO public\.jaguar_relevo_auditoria/);
 assert.match(sql,/origenes_relevo/);
});
test('el reemplazo no edita bitácoras del docente anterior',()=>{
 assert.doesNotMatch(sql,/UPDATE public\.bitacora_excel_diaria SET[^;]+WHERE id=v_origen\.id/);
 assert.match(sql,/WHERE id=v_destino\.id/);
 assert.match(sql,/excede 40 actividades/i);
 assert.match(sql,/v_notas := v_notas \|\|/);
});
test('PDF sin datos personales de alumnos ni modificaciones a la rúbrica',()=>{
 assert.doesNotMatch(pdf,/alumnos|evaluacion_notas|matricula/);
 assert.match(pdf,/PDFDocument\.create/);
 assert.match(pdf,/PONDERACIÓN TOTAL/);
});
test('consulta de actividades incluye adopciones anteriores',()=>{
 assert.match(api,/jaguar_relevo_adopciones_actividades/);
 assert.match(js,/Ya adoptada/);
});
