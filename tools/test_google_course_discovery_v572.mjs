import assert from 'node:assert/strict';
import {googleCourses,projectCourse} from '../lib/google_classroom_oauth.js';
const originalFetch=globalThis.fetch;
let calls=[];
try {
  globalThis.fetch=async (url,opts)=>{
    const u=new URL(url); calls.push(u);
    assert.equal(u.pathname,'/v1/courses');
    assert.equal(u.searchParams.has('teacherId'),false,'No debe filtrar por docente');
    assert.equal(u.searchParams.get('pageSize'),'100');
    assert.match(opts.headers.Authorization,/^Bearer /);
    const page=u.searchParams.get('pageToken');
    return {ok:true,json:async()=>page
      ? {courses:[{id:'2',name:'Segundo curso',courseState:'ARCHIVED'}]}
      : {courses:[{id:'1',name:'Primero',courseState:'ACTIVE'}],nextPageToken:'next'}};
  };
  const result=await googleCourses('token-falso-de-prueba');
  assert.equal(calls.length,2,'Debe consultar todas las páginas');
  assert.deepEqual(result.map(c=>c.id),['1','2']);
  assert.equal(projectCourse(result[1]).estado,'ARCHIVED');
  console.log('✓ Discovery Classroom V5.7.2: sin filtro restrictivo, paginación y clases archivadas');
} finally {globalThis.fetch=originalFetch;}
