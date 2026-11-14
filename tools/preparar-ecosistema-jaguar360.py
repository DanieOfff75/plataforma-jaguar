#!/usr/bin/env python3
"""Construye copias completas aisladas de los tres repositorios. No publica ni conecta a Supabase."""
import argparse, hashlib, json, os, shutil, tempfile, zipfile
from pathlib import Path, PurePosixPath

REPOS = ('plataforma-jaguar', 'admisiones', 'centro-control')
MANIFEST = 'INTEGRIDAD_ECOSISTEMA_V38.json'

def sha(data): return hashlib.sha256(data).hexdigest()

def safe(name):
    p=PurePosixPath(name)
    if (not name or name.startswith('/') or '\\' in name or ':' in name or
        any(x in ('','.','..') for x in name.split('/')) or '.git' in p.parts):
        raise ValueError(f'Ruta no admitida: {name!r}')
    return name

def zip_contents(file):
    data={}
    with zipfile.ZipFile(file) as z:
        for item in z.infolist():
            if item.is_dir(): continue
            name=safe(item.filename)
            if name in data or (item.external_attr >> 16)&0o170000==0o120000:
                raise ValueError('Entrada repetida o enlace: '+name)
            data[name]=z.read(item)
    return data

def original(file):
    raw=zip_contents(file)
    prefixes={k.split('/')[0] for k in raw}
    if len(prefixes)!=1 or any('/' not in k for k in raw):
        raise ValueError('El ZIP original debe tener una sola carpeta raíz.')
    return {safe(k.split('/',1)[1]):v for k,v in raw.items()}

def prepare(patch,bases,destination):
    destination=Path(destination).absolute()
    if destination.exists() or destination.is_symlink(): raise ValueError('El destino ya existe. Elige una carpeta NUEVA.')
    package=zip_contents(patch)
    manifest=json.loads(package[MANIFEST])
    if set(manifest)!=set(REPOS): raise ValueError('Manifiesto de repositorios incompleto.')
    staged={}
    # Valida todos los archivos antes de escribir ninguno.
    for repo in REPOS:
        info=manifest[repo]; source=Path(bases[repo]); files=original(source)
        if sha(source.read_bytes())!=info['base_sha256']: raise ValueError(f'{repo}: ZIP original diferente del utilizado para programar.')
        expected=info['unchanged_hashes']; changes=info['files']; prefix=repo+'/'
        actual={k[len(prefix):]:v for k,v in package.items() if k.startswith(prefix)}
        if set(actual)!=set(changes): raise ValueError(f'{repo}: paquete incompleto o archivos extra.')
        if set(expected)&set(changes) or set(files)!=set(expected)|{k for k,v in changes.items() if v['before'] is not None}:
            raise ValueError(f'{repo}: inventario original incompatible.')
        for k,v in expected.items():
            safe(k)
            if sha(files[k])!=v: raise ValueError(f'{repo}: archivo original cambiado: {k}')
        for k,v in changes.items():
            safe(k)
            if (sha(files[k]) if k in files else None)!=v['before'] or sha(actual[k])!=v['after']:
                raise ValueError(f'{repo}: huella de actualización incorrecta: {k}')
        files.update(actual); staged[repo]=files
    # Crear copias sólo tras verificar los tres repositorios. No sobreescribir nada.
    destination.parent.mkdir(parents=True,exist_ok=True)
    temp=Path(tempfile.mkdtemp(prefix='.jaguar360-',dir=destination.parent))
    try:
        for repo,files in staged.items():
            for k,v in files.items():
                target=temp/repo/k; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(v)
        (temp/'PRUEBA_LOCAL.txt').write_text('Copias verificadas. NO conectar a producción. No se ejecutaron SQL ni despliegues.\n',encoding='utf-8')
        if destination.exists() or destination.is_symlink(): raise ValueError('El destino apareció durante la preparación.')
        os.rename(temp,destination)
    finally:
        if temp.exists(): shutil.rmtree(temp)
    return {r:len(fs) for r,fs in staged.items()}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--paquete',required=True);p.add_argument('--plataforma',required=True);p.add_argument('--admisiones',required=True);p.add_argument('--centro',required=True); p.add_argument('--destino',required=True)
    a=p.parse_args()
    try:
        result=prepare(a.paquete,dict(zip(REPOS,(a.plataforma,a.admisiones,a.centro))),a.destino)
    except (ValueError,KeyError,OSError,zipfile.BadZipFile) as e:
        p.exit(1,f'ERROR: {e}\nNo se autorizó instalación.\n')
    print(json.dumps({'copias':result,'destino':str(Path(a.destino).absolute()),'produccion_modificada':False},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
