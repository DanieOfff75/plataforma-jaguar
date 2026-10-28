/**
 * Plataforma Jaguar - Vercel Hobby API router.
 * Groups related endpoints while retaining their original public URLs.
 * Each handler keeps its own role, method and payload verification.
 * IMPORTANT: This dispatcher never selects modules from arbitrary paths.
 */
import academicTools from '../routes/academic-tools.js';
import classroom from '../routes/classroom.js';
import googleClassroom from '../routes/google-classroom.js';
import googleOAuth from '../routes/google-oauth.js';
import teacher from '../routes/teacher.js';
import didacticStudio from '../routes/didactic-studio.js';
import teacherTransition from '../routes/teacher-transition.js';
import ithlaPublic from '../routes/ithla-public.js';

const handlers=Object.freeze({
  'academic-tools':academicTools,
  classroom,
  'google-classroom':googleClassroom,
  'google-oauth':googleOAuth,
  teacher,
  'didactic-studio':didacticStudio,
  'teacher-transition':teacherTransition,
  'ithla-public':ithlaPublic
});

export default async function handler(req,res){
  const route=String(req.query?.__jaguar_route||'');
  const target=Object.hasOwn(handlers,route)?handlers[route]:null;
  if(!target)return res.status(404).json({ok:false,error:'Ruta no disponible.'});
  return target(req,res);
}
