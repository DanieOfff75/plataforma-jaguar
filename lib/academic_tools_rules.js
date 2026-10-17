/** Reglas puras de Jaguar V5.5. No deben depender del navegador ni de Supabase. */
export const ROOM_MANAGERS=['coordinacion_academica','direccion_escolar','servicios_docentes'];
export const ROOM_READERS=[...ROOM_MANAGERS,'control_escolar','control','servicios_docentes'];
export const GRADE_MANAGERS=['control_escolar','control','direccion_escolar'];
export const EXAM_ROLES=['docente'];
export function fail(message,status=400){throw Object.assign(new Error(message),{status});}
export function positiveId(v,label='ID'){const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)fail(`${label} inválido.`);return n;}
export function normalizeRoom(input){
 const name=String(input.nombre||'').trim().toUpperCase();
 const cap=Number(input.capacidad);
 if(name.length<2||name.length>70||!Number.isSafeInteger(cap)||cap<1||cap>1000)fail('Nombre de aula (2-70 caracteres) y capacidad (1-1000) obligatorios.');
 const code=String(input.codigo||'').trim().toUpperCase();
 if(!/^[A-Z0-9_-]{2,24}$/.test(code))fail('Clave de aula inválida; utiliza letras, números, guion o guion bajo.');
 const tipo=String(input.tipo_espacio||'').trim().toLowerCase();
 if(!['aula','laboratorio','auditorio','oficina','otro'].includes(tipo))fail('Selecciona el tipo de espacio: aula, laboratorio, auditorio, oficina u otro.');
 if(tipo==='aula'&&/(LABORATORIO|^LAB([\s_-]|$)|AUDITORIO|OFICINA|ADMINISTRACI[ÓO]N|DIRECCI[ÓO]N|SECRETAR[ÍI]A)/i.test(name))fail('Un laboratorio, auditorio u oficina no puede registrarse como aula ordinaria.');
 return {codigo:code,nombre:name,capacidad:cap,edificio:String(input.edificio||'').trim().slice(0,80)||null,descripcion:String(input.descripcion||'').trim().slice(0,300)||null,activo:input.activo!==false,tipo_espacio:tipo};
}
const timeMinutes=x=>{const s=String(x||'').slice(0,5);if(!/^\d{2}:\d{2}$/.test(s))fail('Horario inválido.');const [h,m]=s.split(':').map(Number);if(h>23||m>59)fail('Horario inválido.');return 60*h+m;};
export function overlaps(a,b){return Number(a.dia_semana)===Number(b.dia_semana)&&timeMinutes(a.hora_inicio)<timeMinutes(b.hora_fin)&&timeMinutes(b.hora_inicio)<timeMinutes(a.hora_fin);}
export function normalizeQuestion(raw){
 const tipo=String(raw.tipo||'');if(!['opcion_multiple','verdadero_falso','abierta'].includes(tipo))fail('Tipo de reactivo inválido.');
 const enunciado=String(raw.enunciado||'').trim();if(enunciado.length<8||enunciado.length>2500)fail('El enunciado debe tener entre 8 y 2500 caracteres.');
 const puntos=Number(raw.puntos||1);if(!Number.isFinite(puntos)||puntos<=0||puntos>100)fail('Puntaje inválido.');
 let opciones=[];let respuesta=null;
 if(tipo==='opcion_multiple'){
   opciones=Array.isArray(raw.opciones)?raw.opciones.map(x=>String(x||'').trim()):[];
   if(opciones.length<2||opciones.length>6||opciones.some(x=>!x||x.length>300)||new Set(opciones.map(x=>x.toLowerCase())).size!==opciones.length)fail('Introduce entre 2 y 6 opciones distintas.');
   const correct=Number(raw.respuesta);if(!Number.isInteger(correct)||correct<0||correct>=opciones.length)fail('Selecciona una respuesta correcta.');
   respuesta=correct;
 }else if(tipo==='verdadero_falso'){respuesta=String(raw.respuesta)==='true';}
 else if(raw.respuesta!=null){respuesta=String(raw.respuesta).trim().slice(0,1500)||null;}
 return {tipo,enunciado,puntos,opciones,respuesta};
}
export function validateGradeRows(raw,maxRows=250){
 if(!Array.isArray(raw)||raw.length===0||raw.length>maxRows)fail(`Debes enviar entre 1 y ${maxRows} registros.`);
 const used=new Set();return raw.map((row,i)=>{
   const matricula=String(row?.matricula||'').trim().toUpperCase();
   if(!matricula||matricula.length>60)fail(`Fila ${i+1}: matrícula obligatoria.`);
   if(used.has(matricula))fail(`Fila ${i+1}: matrícula duplicada (${matricula}).`);
   used.add(matricula);
   if(row?.calificacion===null||row?.calificacion===undefined||String(row.calificacion).trim()==='')fail(`Fila ${i+1}: calificación vacía.`);
   const grade=Number(row.calificacion);
   if(!Number.isFinite(grade)||grade<0||grade>10||Math.round(grade*10)!==grade*10)fail(`Fila ${i+1}: la nota debe estar entre 0 y 10 con máximo un decimal.`);
   return {matricula,calificacion:grade,observaciones:String(row.observaciones||'').trim().slice(0,450)};
 });
}
export function calculateGradePreview(rows,students,existing,{allowUpdates=false}={}){
 const roster=new Map(students.map(s=>[String(s.matricula||'').trim().toUpperCase(),s]));
 const prev=new Map(existing.map(x=>[Number(x.alumno_id),x]));
 const results=[];
 for(const r of rows){
   const student=roster.get(r.matricula);let status='nuevo',detail='Registro nuevo';
   const old=student&&prev.get(Number(student.id));
   if(!student){status='error';detail='La matrícula no pertenece al grupo seleccionado';}
   else if(old){
     if(old.rubrica_id||old.cierre_evaluacion_id||old.detalle_evaluacion?.rubrica_id){status='error';detail='Nota protegida: generada por rúbrica';}
     else if(Number(old.calificacion)===r.calificacion && String(old.observaciones||'')===r.observaciones){status='sin_cambio';detail='Sin cambios';}
     else if(allowUpdates){status='actualizar';detail=`Cambiar de ${old.calificacion} a ${r.calificacion}`;}
     else {status='error';detail='Existe una calificación; requiere autorización de actualización';}
   }
   results.push({...r,alumno_id:student?.id||null,nombre:student?.nombre_completo||'—',actual:old?.calificacion??null,status,detail});
 }
 return {rows:results,summary:{nuevas:results.filter(r=>r.status==='nuevo').length,actualizar:results.filter(r=>r.status==='actualizar').length,sin_cambio:results.filter(r=>r.status==='sin_cambio').length,errores:results.filter(r=>r.status==='error').length}};
}
