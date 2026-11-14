/** Scope legacy announcements consistently in lists and home dashboards. */
export function noticeVisibleTo(notice,role){
 if(!notice||notice.activo!==true||notice.publicado===false||notice.destino_publicacion==='publica'||typeof role!=='string'||!role)return false;
 if(notice.destino_publicacion!=null&&!['plataforma','ambas'].includes(notice.destino_publicacion))return false;
 const audience=notice.audiencia;
 if(audience==null)return true; // Legacy unrestricted announcement.
 if(!Array.isArray(audience))return false;
 return audience.length===0||audience.includes(role)||(role==='control'&&audience.includes('control_escolar'));
}
export function dashboardNotices(rows,role,limit=8){
 return (rows||[]).filter(n=>noticeVisibleTo(n,role)).slice(0,limit).map(({id,titulo,contenido,fecha_publicacion})=>({id,titulo,contenido,fecha_publicacion}));
}
