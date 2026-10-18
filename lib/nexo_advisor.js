/* NEXO V6.0.1: recuperación de conocimiento institucional, sólo lectura. No es un modelo generativo. */
const COMMON=new Set('de la el los las un una para por con en y o es se que como donde me mi tu a al del puedo necesito quiero hacer obtener pedir pido dice sacar cual cuales cuando hay tiene esta estoy quien qué cómo dónde está tengo este ese esa estos puedo favor porfavor me puedes dónde si ya'.split(' '));
const SYNONYMS={
 constancias:'constancia',constancia:'constancia',papel:'constancia',comprobante:'constancia',escolaridad:'constancia',certificado:'constancia',certificacion:'constancia',estudios:'constancia',
 ingreso:'admision',ingresos:'admision',admision:'admision',admisiones:'admision',aspirantes:'admision',aspirante:'admision',convocatoria:'admision',registro:'admision',registrarme:'admision',inscribirme:'admision',inscripcion:'admision',inscripciones:'admision',
 calificacion:'calificaciones',calificaciones:'calificaciones',nota:'calificaciones',notas:'calificaciones',boletas:'calificaciones',boleta:'calificaciones',promedio:'calificaciones',
 usuarios:'acceso',usuario:'acceso',password:'acceso',contrasena:'acceso',clave:'acceso',sesion:'acceso',login:'acceso',entrar:'acceso',acceder:'acceso',
 aulas:'aulas',aula:'aulas',salones:'aulas',salon:'aulas',examen:'examenes',examenes:'examenes',pruebas:'examenes',rubrica:'rubricas',rubricas:'rubricas',
 contactos:'contacto',telefono:'contacto',correo:'contacto',direccion:'contacto',ubicacion:'contacto',
 fechas:'fechas',calendarios:'calendario',calendario:'calendario',avisos:'avisos',aviso:'avisos',noticias:'avisos',
 instalar:'instalar',instalacion:'instalar',aplicacion:'instalar',app:'instalar',android:'instalar',movil:'instalar',celular:'instalar',
 recuperar:'acceso',olvido:'acceso',olvide:'acceso',restablecer:'acceso'
};
function normalize(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9ñ\s]/g,' ').replace(/\s+/g,' ').trim()}
export function words(text){return [...new Set(normalize(text).split(' ').filter(Boolean).filter(t=>t.length>2&&!COMMON.has(t)).map(t=>SYNONYMS[t]||t))]}
function distance(a,b){if(Math.abs(a.length-b.length)>1)return 3;if(a===b)return 0;let previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,previous[j]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));previous=cur}return previous[b.length]}
function similar(q,k){return q===k?1:q.length>=5&&k.length>=5&&Math.abs(q.length-k.length)<=1&&distance(q,k)===1?.72:0}
const DEFAULT_KNOWLEDGE=[
 {pregunta:'¿Cómo solicito una constancia de estudios?',etiquetas:['constancia','tramite','control escolar','comprobante escolar'],respuesta:'Para solicitar una constancia de estudios, consulta el procedimiento vigente con Control Escolar. No tengo requisitos, costos ni plazos oficiales publicados para confirmarlos.',fuente:'Orientación · Control Escolar'},
 {pregunta:'¿Cómo puedo inscribirme o consultar las admisiones?',etiquetas:['admision','nuevo ingreso','convocatoria','registro','folio'],respuesta:'Consulta el Portal de Admisiones para conocer el estado de la convocatoria. Si ya registraste una solicitud, utiliza los medios de seguimiento del propio portal. La aceptación no sustituye la confirmación de inscripción de Control Escolar.',fuente:'Portal de Admisiones',url:'https://registro-escolar-virid.vercel.app/'},
 {pregunta:'¿Dónde consulto mis calificaciones o la boleta?',etiquetas:['calificaciones','boleta','alumno','notas','promedio'],respuesta:'Inicia sesión en Plataforma Jaguar con tu cuenta y busca la sección de calificaciones disponible para tu perfil. Las dudas o aclaraciones oficiales se tramitan con el personal responsable.',fuente:'Plataforma Jaguar',url:'/sistema.html'},
 {pregunta:'Olvidé mi contraseña, ¿cómo recupero el acceso?',etiquetas:['acceso','contrasena','sesion','recuperar','usuario'],respuesta:'En la pantalla de acceso de Jaguar utiliza «¿Olvidaste tu contraseña?» y sigue las instrucciones. NEXO nunca solicitará tu contraseña.',fuente:'Acceso a Jaguar',url:'/sistema.html'},
 {pregunta:'¿Dónde encuentro exámenes y rúbricas docentes?',etiquetas:['examenes','rubricas','docente','evaluacion','banco de preguntas'],respuesta:'Si eres docente, inicia sesión en Jaguar y abre los módulos académicos habilitados para tu perfil. NEXO sólo puede orientarte y no modifica evaluaciones.',fuente:'Plataforma Jaguar',url:'/sistema.html'},
 {pregunta:'¿Cómo instalo Jaguar en mi celular Android?',etiquetas:['instalar','android','pwa','celular','pantalla de inicio'],respuesta:'En Android, abre la portada de Jaguar en Chrome, toca el menú de tres puntos y elige «Instalar aplicación» o «Agregar a pantalla principal», si aparece. La instalación crea un acceso directo; las funciones privadas requieren internet e inicio de sesión.',fuente:'Portal Jaguar',url:'/'},
 {pregunta:'¿Dónde veo los avisos y eventos del instituto?',etiquetas:['avisos','calendario','eventos','noticias'],respuesta:'Los avisos y eventos autorizados se muestran en la portada pública de ITHLA, sin necesidad de iniciar sesión.',fuente:'Portal institucional',url:'/'},
 {pregunta:'¿Cómo contacto a Control Escolar?',etiquetas:['contacto','control escolar','telefono','correo'],respuesta:'Consulta los medios de contacto publicados en la portada institucional. No tengo un horario de atención confirmado para indicártelo.',fuente:'Portal institucional',url:'/'},
];
function safeUrl(url){const x=String(url||'');return x.startsWith('/')&&!x.startsWith('//')||/^https:\/\/[a-z0-9.-]+(?:\/[^\s<>"'`]*)?$/i.test(x)?x:null}
export function answerNexo(query,published=[],fallbackMessage=null){
 const q=String(query||'').trim();
 if(q.length<3||q.length>420)return {encontrado:false,respuesta:'Escribe una pregunta breve para poder orientarte.',fuente:'NEXO'};
 const tokens=words(q);
 const external=Array.isArray(published)?published.slice(0,150).filter(x=>x&&typeof x.pregunta==='string'&&typeof x.respuesta==='string'&&x.respuesta.trim()):[];
 const corpus=[...external,...DEFAULT_KNOWLEDGE];
 const ranked=corpus.map((entry,index)=>{
  const title=words(entry.pregunta),tags=words((entry.etiquetas||[]).join(' ')),all=[...new Set([...title,...tags])];
  const similarity=tokens.map(t=>Math.max(0,...all.map(k=>similar(t,k))));
  const matched=similarity.filter(s=>s>.6).length;
  const coverage=tokens.length?similarity.reduce((a,b)=>a+b,0)/tokens.length:0;
  const relevance=matched>=1?.8:0;
  const normalizedTitle=normalize(entry.pregunta),normalizedQuery=normalize(q);
  const exact=normalizedQuery===normalizedTitle?1:0;
  // Preferir artículos institucionales editados por el Centro cuando empatan.
  const score=exact||Math.min(1,coverage*.83+Math.min(matched,3)*.045+relevance*.07+(index<external.length?.012:0));
  return {entry,score,matched};
 }).sort((a,b)=>b.score-a.score);
 const best=ranked[0],other=ranked[1];
 if(!best||best.score<.46||best.matched===0||(other&&other.score>.67&&best.score-other.score<.025&&best.entry.pregunta!==other.entry.pregunta)){
   return {encontrado:false,respuesta:typeof fallbackMessage==='string'&&fallbackMessage.trim()?fallbackMessage.slice(0,600):'No encontré información institucional suficientemente relacionada con tu pregunta. ¿Puedes indicar el trámite o servicio concreto? Si no está publicado, consulta al departamento correspondiente. Prefiero no inventar una respuesta.',fuente:'NEXO · información no encontrada'};
 }
 return {encontrado:true,respuesta:String(best.entry.respuesta).slice(0,1800),fuente:String(best.entry.fuente||'Conocimiento institucional').slice(0,100),url:safeUrl(best.entry.url),confianza:Math.round(best.score*100)};
}
