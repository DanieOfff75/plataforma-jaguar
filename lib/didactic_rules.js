/** NEXO Centro Didáctico: normalización y validaciones sin dependencias. */
export const DIDACTIC_FIELDS=['titulo','enfoque','proposito','aprendizaje','inicio','desarrollo','cierre','evaluacion','adecuaciones','recursos'];
export function safeText(value,max=1800){return String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').trim().slice(0,max);}
export function validExternalLink(value){
 try {const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password)return null;
  const host=u.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.local')||/^(?:\d+\.){3}\d+$/.test(host)||host.includes(':'))return null;
  return u.href.slice(0,400);
 }catch{return null;}
}
export function parseNexoJSON(raw){
 const value=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 try {return JSON.parse(value)}catch{}
 const a=value.indexOf('{'),b=value.lastIndexOf('}');
 if(a===-1||b<a)throw new Error('El motor no devolvió una estructura de planeación válida. Intenta de nuevo.');
 try{return JSON.parse(value.slice(a,b+1))}catch{throw new Error('La respuesta del modelo no pudo interpretarse como planeación. Vuelve a generar las opciones.');}
}
export function cleanProposal(value,number=1,externalLinks=[]){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Propuesta inválida.');
 const v={};for(const field of DIDACTIC_FIELDS)v[field]=safeText(value[field],field==='desarrollo'?2000:field==='titulo'?150:1300);
 if(!v.titulo||!v.desarrollo||!v.inicio||!v.cierre)throw Error('La IA generó una propuesta incompleta; solicítala de nuevo.');
 v.recursos_enlaces=[...new Set((externalLinks||[]).map(validExternalLink).filter(Boolean))].slice(0,6);
 v.opcion=number;
 return v;
}
export function cleanProposals(raw,links=[]){
 const root=typeof raw==='string'?parseNexoJSON(raw):raw;
 if(!Array.isArray(root?.opciones)||root.opciones.length<3)throw Error('La IA debe ofrecer tres opciones didácticas completas.');
 return root.opciones.slice(0,3).map((v,i)=>cleanProposal(v,i+1,links));
}
export function validateMaterial(v){
 const topic=safeText(v.tema,180),material=safeText(v.material,6500),objectives=safeText(v.objetivo,600);
 if(topic.length<3 && material.length<30)throw Error('Escribe un tema o adjunta un fragmento de material didáctico.');
 if(/\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/i.test(material)||/\b(?:alumno|estudiante)\s*:?\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/i.test(material))throw Error('Retira nombres y datos personales del material antes de analizarlo.');
 const pedagogia=['activa','proyectos','colaborativa','inclusion','tradicional'].includes(v.metodologia)?v.metodologia:'activa';
 const sesiones=Math.max(1,Math.min(15,Number(v.sesiones)||1));
 const duracion=Math.max(20,Math.min(180,Number(v.minutos)||50));
 const links=[...new Set((Array.isArray(v.enlaces)?v.enlaces:[]).map(validExternalLink).filter(Boolean))].slice(0,6);
 return {tema:topic,material,objetivo:objectives,metodologia:pedagogia,sesiones,duracion,enlaces:links};
}
export function didacticSnapshot(proposal,meta={}){
 const p=cleanProposal(proposal,1,proposal.recursos_enlaces||[]);
 const lines=[`PLANEACIÓN DIDÁCTICA · ${p.titulo}`,`Propósito: ${p.proposito}`,`Aprendizaje esperado/PDA: ${p.aprendizaje}`,`Enfoque: ${p.enfoque}`,`INICIO: ${p.inicio}`,`DESARROLLO: ${p.desarrollo}`,`CIERRE: ${p.cierre}`,`EVALUACIÓN Y EVIDENCIAS: ${p.evaluacion}`,`ADECUACIONES CURRICULARES: ${p.adecuaciones}`,`RECURSOS: ${p.recursos}`,...(p.recursos_enlaces||[]).map(x=>`Enlace proporcionado por docente: ${x}`),'Elaborada con apoyo de NEXO IA. Contenido seleccionado, revisado y validado por el docente.'];
 return {texto:lines.join('\n\n'),origen:'nexo_ia',revision_docente:true,modelo:safeText(meta.modelo,100),proveedor:safeText(meta.proveedor,40),metodologia:safeText(meta.metodologia,40),sesiones:Number(meta.sesiones)||1,recursos_enlaces:p.recursos_enlaces,propuesta:p};
}
