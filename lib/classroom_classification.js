/** Clasificación explícita de trabajos Google. No inferir notas oficiales de títulos. */
const fail=(msg)=>{throw Object.assign(new Error(msg),{status:400});};
const TYPES=new Set(['actividad','examen','excluir']);
const SOURCES=new Set(['forms','classroom','manual']);
export function parseFormId(input){
 const value=String(input||'').trim();if(!value)return null;
 if(/^[a-zA-Z0-9_-]{15,160}$/.test(value))return value;
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com')fail('El enlace de Forms debe pertenecer a docs.google.com.');
  const m=u.pathname.match(/^\/forms\/d\/(?:e\/)?([a-zA-Z0-9_-]{15,160})(?:\/|$)/);
  if(!m)fail('No se reconoció el enlace de Google Forms.');
  return m[1];
 }catch(e){fail(e?.message?.includes('Forms')?e.message:'Introduce un ID o un enlace válido de Google Forms.');}
}
export function normalizeWorkTypes(input,work){
 if(!Array.isArray(input)||input.length!==work.length||input.length>300)fail('Clasifica todos los trabajos visibles del periodo.');
 const known=new Set(work.map(w=>String(w.id))),seen=new Set(),forms=new Set();
 const out=[];
 for(const row of input){
  const id=String(row?.work_id||'');const tipo=String(row?.tipo||'');
  if(!known.has(id)||seen.has(id)||!TYPES.has(tipo))fail('Hay trabajos no clasificados, duplicados o ajenos a este periodo.');
  seen.add(id);
  const fuente=tipo==='examen'?String(row?.fuente_examen||''):null;
  if(tipo==='examen'&&!SOURCES.has(fuente))fail('Indica si la calificación del examen viene de Forms, Classroom o captura manual.');
  const formId=tipo==='examen'&&fuente==='forms'?parseFormId(row.google_form_id):null;
  if(tipo==='examen'&&fuente==='forms'&&!formId)fail('Un examen de Forms necesita el ID o enlace del formulario para detectar duplicados.');
  if(formId){if(forms.has(formId))fail('El mismo formulario aparece dos veces en el periodo. Clasifica un solo trabajo como examen y excluye el duplicado.');forms.add(formId);}
  out.push({google_work_id:id,tipo,fuente_examen:fuente,google_form_id:formId});
 }
 return out.sort((a,b)=>a.google_work_id.localeCompare(b.google_work_id));
}
export function classifiedWork(work,records=[]){
 const byId=new Map(records.map(r=>[String(r.google_work_id),r]));
 return work.map(w=>{
  const c=byId.get(String(w.id));const tipo=TYPES.has(c?.tipo)?c.tipo:'pendiente';
  return {...w,classification:tipo,exam_source:tipo==='examen'?c.fuente_examen||null:null,google_form_id:tipo==='examen'?c.google_form_id||null:null,auto_exclude:tipo!=='actividad'};
 });
}
export function excludedFromClassification(work){
 if(work.some(w=>!TYPES.has(w.classification)))fail('Antes de importar, el docente debe clasificar todos los trabajos como Actividad, Examen o Excluir.');
 return work.filter(w=>w.classification!=='actividad').map(w=>String(w.id)).sort();
}
