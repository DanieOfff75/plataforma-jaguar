/** One badge for two different obligations. Reading a personal notification never acknowledges a communiqué. */
import {evidenceId} from './jaguar_history_evidence.js';
const fail=(message,status=503)=>Object.assign(Error(message),{status});
export function notificationId(value){
 if(typeof value==='number'&&!Number.isSafeInteger(value))throw fail('Identificador de notificación inválido.',400);
 try{return evidenceId(String(value??''));}catch{throw fail('Identificador de notificación inválido.',400);}
}
export async function notificationSummary(db,user){
 const {data,error}=await db.rpc('jaguar360_bandeja_totales',{p_actor:user.id});
 if(error)throw fail(error.code==='42501'?'Sin atribución.':'No se pudo consultar el contador de notificaciones.',error.code==='42501'?403:503);
 if(!data||!['unread','pendingAcknowledgements'].every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)||!Number.isSafeInteger(data.unread+data.pendingAcknowledgements))throw fail('Contador de notificaciones inválido.');
 return {unread:data.unread,pendingAcknowledgements:data.pendingAcknowledgements,total:data.unread+data.pendingAcknowledgements};
}
