#!/usr/bin/env python3
"""Comprueba sintaxis JS y Python de los tres repositorios sin iniciar servidores."""
import ast, concurrent.futures, json, subprocess, sys
from pathlib import Path
TOP=Path(__file__).resolve().parents[2]
REPOS=('plataforma-jaguar','admisiones','centro-control')
paths=[p for repo in REPOS for p in (TOP/repo).rglob('*') if p.is_file() and not set(p.parts)&{'node_modules','.git','__pycache__','.vercel'} and p.suffix in {'.js','.mjs','.cjs','.py'}]
def check(p):
 try:
  if p.suffix=='.py':ast.parse(p.read_text(encoding='utf-8-sig'),filename=str(p));return None
  r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True,timeout=30)
  if r.returncode:return {'archivo':str(p.relative_to(TOP)),'error':r.stderr[-1800:]}
 except (OSError,ValueError,SyntaxError,subprocess.TimeoutExpired) as e:return {'archivo':str(p.relative_to(TOP)),'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:errors=[x for x in ex.map(check,paths) if x]
print(json.dumps({'archivos':len(paths),'errores':errors,'alcance':'Sintaxis, no ejecución de servicios ni HTML inline'},ensure_ascii=False,indent=2));sys.exit(bool(errors))
