/** Formato de listas de ALUMNOS: paternal, maternal, nombres. Solo presentación.
 * Los campos explícitos tienen prioridad; los nombres completos heredados de Jaguar
 * siguen la convención nombre(s) + apellido paterno + apellido materno.
 * Si la procedencia es ambigua, Control Escolar debe corregir/estructurar el registro:
 * no es posible deducir siempre los apellidos a partir de un único campo.
 */
const tidy = value => String(value ?? '').replace(/\s+/g,' ').trim();
const collator = new Intl.Collator('es-MX', {sensitivity:'base',numeric:true});
export function institutionalName(person){
  return (typeof person==='string' ? tidy(person) : tidy(person?.nombre_completo ?? person?.nombre)) || '—';
}
const surnameParticles = new Set(['DE','DEL','LA','LAS','LOS','SAN','SANTA','VAN','VON','DA','DOS']);
function peelSurname(words){
  const group=[words.pop()];
  while(words.length && surnameParticles.has(words[words.length-1].toLocaleUpperCase('es-MX'))){
    const part=words.pop(); group.unshift(part);
    if(['LA','LAS','LOS'].includes(part.toLocaleUpperCase('es-MX')) && words.length && words[words.length-1].toLocaleUpperCase('es-MX')==='DE')group.unshift(words.pop());
  }
  return group.join(' ');
}
export function studentRosterName(person){
  const s=typeof person==='string'?{nombre_completo:person}:(person||{});
  const pat=tidy(s.apellido_paterno ?? s.primer_apellido);
  const mat=tidy(s.apellido_materno ?? s.segundo_apellido);
  let names=tidy(s.nombres ?? s.nombre_s ?? s.nombres_pila);
  const raw=tidy(s.nombre_completo ?? s.name ?? s.nombre);
  if(pat || mat){
    if(!names && raw){
      const suffix=tidy(`${pat} ${mat}`);
      // Los registros heredados pueden traer el nombre completo además de los apellidos.
      if(suffix && raw.toLocaleUpperCase('es-MX').endsWith(suffix.toLocaleUpperCase('es-MX'))){
        names=tidy(raw.slice(0,raw.length-suffix.length));
      }else if(suffix && raw.toLocaleUpperCase('es-MX').startsWith(suffix.toLocaleUpperCase('es-MX'))){
        names=tidy(raw.slice(suffix.length));
      }else if(!raw.toLocaleUpperCase('es-MX').includes(pat.toLocaleUpperCase('es-MX'))){
        names=raw;
      }else {
        // No ocultar nombres si no se puede conciliar la cadena con los campos.
        return raw;
      }
    }
    return [pat,mat,names].filter(Boolean).join(' ') || raw || 'Sin nombre';
  }
  if(!raw)return 'Sin nombre';
  if(s.nombre_orden==='institucional'||s.orden_institucional===true)return raw;
  // Se acepta una separación explícita apellidos, nombre(s).
  if(raw.includes(',')){
    const parts=raw.split(',');return `${tidy(parts[0])} ${tidy(parts.slice(1).join(' '))}`.trim();
  }
  const words=raw.split(' ');
  if(words.length<3)return raw; // No inventar apellidos de un nombre corto.
  const maternal=peelSurname(words),paternal=peelSurname(words);
  if(!words.length)return raw;
  return [paternal,maternal,words.join(' ')].filter(Boolean).join(' ');
}
export function sortInstitutionalPeople(rows){
  return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>
    collator.compare(studentRosterName(a),studentRosterName(b)) ||
    collator.compare(tidy(a?.matricula??''),tidy(b?.matricula??'')) ||
    collator.compare(tidy(a?.id??''),tidy(b?.id??'')));
}
