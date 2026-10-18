/* NEXO: asesor sólo de lectura. No conoce SQL, credenciales ni ejecuta acciones. */
const COMMON=new Set('de la el los las un una para por con en y o es se que como cómo donde dónde me mi tu a al del puedo necesito quiero hacer obtener pedir pido dice sacar cual cuáles cuando cuando hay tiene esta estoy'.split(' '));
const SYNONYMS={constancia:'constancia',papel:'constancia',estudio:'constancia',solicitar:'constancia',comprobante:'constancia',comprobar:'constancia',escolaridad:'constancia',estudios:'constancia',certificado:'constancia',inscripcion:'admision',ingreso:'admision',admision:'admision',aspirante:'admision',convocatoria:'admision',registro:'admision',registrarme:'admision',inscribirme:'admision',inscripcion:'admision',calificaciones:'calificaciones',nota:'calificaciones',notas:'calificaciones',boleta:'calificaciones',promedio:'calificaciones',usuario:'acceso',password:'acceso',contrasena:'acceso',sesion:'acceso',login:'acceso',entrar:'acceso',aula:'aulas',salon:'aulas',ubicacion:'aulas',examenes:'examenes',prueba:'examenes',evaluacion:'examenes',telefono:'contacto',correo:'contacto',direccion:'contacto'};
export function words(text){return [...new Set(String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9ñ\s]/g,' ').split(/\s+/).map(t=>SYNONYMS[t]||t).filter(t=>t.length>2&&!COMMON.has(t)))];}
const DEFAULT_KNOWLEDGE=[
 {pregunta:'¿Cómo solicito una constancia de estudios?',etiquetas:['constancia','control escolar','tramite'],respuesta:'Para solicitar una constancia de estudios, consulta el procedimiento vigente con Control Escolar. No tengo requisitos, costos ni plazos oficiales publicados para confirmarlos.',fuente:'Control Escolar'},
 {pregunta:'¿Cómo puedo inscribirme o consultar admisiones?',etiquetas:['admision','nuevo ingreso','convocatoria'],respuesta:'El Portal de Admisiones publica el estado de la convocatoria. Si está abierta, puedes iniciar una solicitud; si ya tienes folio, conserva tu CURP para consultar el resultado.',fuente:'Portal de Admisiones',url:'https://registro-escolar-virid.vercel.app/'},
 {pregunta:'¿Dónde puedo consultar mis calificaciones y boleta?',etiquetas:['calificaciones','boleta','alumno'],respuesta:'Ingresa a Plataforma Jaguar con tu cuenta de alumno y abre el apartado «Mis calificaciones». Para dudas o correcciones, solicita orientación a Control Escolar.',fuente:'Plataforma Jaguar',url:'/sistema.html'},
 {pregunta:'Olvidé mi contraseña, ¿cómo recupero el acceso?',etiquetas:['acceso','usuario','contraseña'],respuesta:'En la pantalla de acceso de Jaguar selecciona «¿Olvidaste tu contraseña?» y sigue el procedimiento de recuperación. No compartas contraseñas con nadie.',fuente:'Acceso a Jaguar',url:'/sistema.html'},
 {pregunta:'¿Dónde están mis exámenes o rúbricas?',etiquetas:['examenes','docente','rubrica'],respuesta:'Si eres docente, ingresa a Jaguar para utilizar las herramientas académicas asignadas a tu perfil. NEXO puede indicarte la ruta, pero no modifica evaluaciones.',fuente:'Plataforma Jaguar',url:'/sistema.html'}
];
function safeUrl(input){const x=String(input||'');return x.startsWith('/')&&!x.startsWith('//')||/^https:\/\/[a-z0-9.-]+(?:\/[^\s<>\"'`]*)?$/i.test(x)?x:null;}
export function answerNexo(query,published=[]){
 const q=String(query||'').trim();
 if(q.length<3||q.length>420)return {encontrado:false,respuesta:'Escribe una pregunta breve para poder orientarte.',fuente:'NEXO'};
 const qWords=words(q);
 const extra=Array.isArray(published)?published.slice(0,150).filter(x=>x&&typeof x.pregunta==='string'&&typeof x.respuesta==='string'):[];
 const corpus=[...extra,...DEFAULT_KNOWLEDGE];
 const ranking=corpus.map(item=>{
  const title=words([item.pregunta,...(Array.isArray(item.etiquetas)?item.etiquetas:[])].join(' ')),matched=qWords.filter(t=>title.includes(t));
  const coverage=qWords.length?matched.length/qWords.length:0;
  const focus=title.length?matched.length/Math.min(title.length,5):0;
  const exact=q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(String(item.pregunta).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))?1:0;
  return {item,score:Math.max(exact,coverage*.77+focus*.23),hits:matched.length};
 }).sort((a,b)=>b.score-a.score);
 const best=ranking[0],second=ranking[1];
 if(!best||best.hits===0||best.score<.43||(second&&second.score>.55&&best.score-second.score<.04&&best.item.pregunta!==second.item.pregunta))return {encontrado:false,respuesta:'No encontré información institucional suficientemente relacionada con tu pregunta. Puedes reformularla o consultar al departamento correspondiente. No voy a inventar un procedimiento.',fuente:'NEXO · sin coincidencia fiable'};
 return {encontrado:true,respuesta:best.item.respuesta.slice(0,1800),fuente:String(best.item.fuente||'Conocimiento institucional').slice(0,100),url:safeUrl(best.item.url),confianza:Math.round(best.score*100)};
}
