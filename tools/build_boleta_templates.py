"""Compila variantes 0-10 materias, 1-10 docentes y 1-6 departamentos.
Sólo se ejecuta en desarrollo: Vercel usa assets PDF + pdf-lib, sin Chromium.
"""
import base64, io, json
from copy import deepcopy
from pathlib import Path
from bs4 import BeautifulSoup, NavigableString
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
soup=BeautifulSoup((ROOT/'assets/Boleta-Jaguar-Propuesta-Visual-15.html').read_text(), 'html.parser')
main=soup.select_one('main')
original=main.select('section.sheet')
assert len(original)==3

# Reutilizar el logo transparente ya incluido en el proyecto, no se genera ninguno nuevo.
logo=Image.open(ROOT/'assets/ithla-logo.png').convert('RGBA')
logo.thumbnail((230,230),Image.Resampling.LANCZOS)
stream=io.BytesIO();logo.save(stream,format='PNG',optimize=True)
logo_uri='data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode('ascii')
for sheet in original:
    crest=sheet.select_one('.crest')
    crest.clear()
    im=soup.new_tag('img',alt='Escudo institucional')
    im['src']=logo_uri
    crest.append(im)

style=soup.select_one('style')
style.append(NavigableString('''
/* Ajustes solicitados: logo real, folio completo, firmas académicas sin Subdirección. */
.crest{background:none;border:0;clip-path:none;overflow:visible}
.crest:after{display:none}
.crest img{display:block;width:70px;height:70px;object-fit:contain;max-width:none}
.folio{min-width:206px}
.folio strong{font-size:9px;letter-spacing:0;white-space:nowrap}
.sheet.jaguar-teachers .compact-validation .sign-block.direction-centred{grid-column:1/-1;width:calc((100% - 42px)/2);justify-self:center}
.sheet.jaguar-departments .department-grid .department:last-child:nth-child(odd){grid-column:1/-1;width:calc((100% - 30px)/2);justify-self:center}
.sheet.jaguar-teachers .sign-grid{row-gap:30px}
@media print{
  .sheet.jaguar-teachers .sign-grid{margin-top:18px;gap:30px 40px}
  .sheet.jaguar-teachers .compact-validation .sign-block{padding-top:30px;min-height:62px}
  .sheet.jaguar-departments .department-grid{row-gap:20px;margin-top:16px}
  .sheet.jaguar-departments .department{min-height:142px;padding-top:10px}
  .sheet.jaguar-departments .department .dept-sign{margin-top:59px}
}
'''))

def mark(el,key):
    assert el is not None,key
    el['data-jaguar-field']=key
    el.clear();el.append(NavigableString('\u00a0'))

for pagei,sheet in enumerate(original):
    pre=str(pagei+1)
    for sel,k in [('.institution h1','institution'),('.institution .motto','motto'),('.doc-tag .cycle b','cycle'),('.folio strong','folio'),('.footer span:first-child','footer'),('.footer .page-num','page')]:
        mark(sheet.select_one(sel),f'{pre}.{k}')

first,second,third=original
# Sustitución exclusiva del bloque de Dirección de la primera hoja por sello:
# conservar el espacio de la firma, sin mover ningún elemento ni alterar columnas.
first['class'].append('jaguar-main')
first.select('.sign-area .sign-block')[1]['class'].append('seal-site')
style.append(NavigableString('''
.sheet.jaguar-main .sign-area .sign-block.seal-site .sign-rule{border-top-color:transparent;color:transparent}
.sheet.jaguar-main .sign-area .sign-block.seal-site .sign-sub{visibility:hidden}
'''))
mark(first.select_one('.subtitle'),'1.subtitle')
for i,el in enumerate(first.select('.student-line .value')):mark(el,f'1.student.{i}')
for i,el in enumerate(first.select('thead th')[1:-1]):mark(el,f'1.period.{i}')
for r,tr in enumerate(first.select('tbody tr')):
    for c,cell in enumerate(tr.select('td')):mark(cell,f'1.grade.{r}.{c}')
for i,el in enumerate(first.select('.summary .value')):mark(el,f'1.summary.{i}')
mark(first.select_one('.notes'),'1.notes')
for i,el in enumerate(first.select('.sign-area .sign-sub')):mark(el,f'1.signlabel.{i}')
first.select_one('.qr-box').clear()

second['class'].append('jaguar-teachers')
second.select_one('.title-row .subtitle').string='Validación de las asignaturas del grupo'
second.select_one('.page-intro').string='Los docentes responsables de las asignaturas del grupo validan la evaluación registrada. El taller se consigna como formación complementaria, sin calificación numérica.'
second.select_one('.note-small').string='Se incluyen únicamente docentes vinculados a las asignaturas de este grupo. Las firmas digitales disponibles proceden de Jaguar; los demás espacios permiten firma autógrafa.'
for r,tr in enumerate(second.select('.teacher-table tbody tr')):
    for c,td in enumerate(tr.select('td')[:3]):mark(td,f'2.teacher.{r}.{c}')
# Quitar Subdirección, y centrar el bloque de Dirección en la segunda fila.
validation=second.select_one('.compact-validation')
blocks=validation.select('.sign-block')
assert len(blocks)==4
blocks[2].decompose()
blocks[3]['class'].append('direction-centred')
for i,block in enumerate(validation.select('.sign-block')):mark(block.select_one('.sign-sub'),f'2.signlabel.{i}')

third['class'].append('jaguar-departments')
third.select_one('.page-intro').string='Se muestran únicamente las áreas existentes y sus responsables registrados en Jaguar. Cada bloque admite firma digital o manuscrita.'
third.select_one('.notes').string='Control de validación: Las firmas de estas áreas complementan las validaciones del alumno, docentes y Dirección.'
for i,dept in enumerate(third.select('.department')):
    for sel,k in [('h3','name'),('.dept-note','description'),('.dept-sign','sign'),('.dept-role','role')]:
        mark(dept.select_one(sel),f'3.department.{i}.{k}')
for txt in main.find_all(string=True):
    if 'sello' in str(txt).lower():txt.replace_with(str(txt).replace('Nombre, firma y sello','Nombre y firma').replace('sello institucional','firma institucional').replace('sello si corresponde','firma según corresponda'))

# Variantes sin tablas vacías. Cada página corresponde a una sola cantidad real.
main.clear()
variants={};index=0
for group,template,min_count,max_count,rows_selector in [
    ('main',first,0,10,'.table-wrap tbody tr'),
    ('teacher',second,1,10,'.teacher-table tbody tr'),
    ('department',third,1,6,'.department-grid .department'),
]:
    for count in range(min_count,max_count+1):
        s=deepcopy(template)
        s['data-jaguar-template']=f'{group}:{count}'
        for item in s.select(rows_selector)[count:]:item.decompose()
        main.append(s)
        variants[f'{group}:{count}']=index;index+=1

html=str(soup)
(ROOT/'assets/boleta-visual15-plantilla.html').write_text(html)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':816,'height':1056},device_scale_factor=1)
    page.set_content(html,wait_until='load')
    page.emulate_media(media='print')
    positions=page.evaluate('''() => {
      const result={};
      for(const s of document.querySelectorAll('main .sheet')){
        const name=s.dataset.jaguarTemplate, sr=s.getBoundingClientRect(),fields={};
        const pos=(r)=>({x:r.x-sr.x,top:r.y-sr.y,w:r.width,h:r.height});
        for(const el of s.querySelectorAll('[data-jaguar-field]')){
          let rect=el.getBoundingClientRect();const css=getComputedStyle(el);
          if(el.matches('.folio strong')){const r=el.closest('.folio').getBoundingClientRect();rect={x:r.x,y:rect.y,width:r.width,height:rect.height};}
          if(el.matches('.cycle b')){const r=el.closest('.cycle').getBoundingClientRect();rect={x:r.x,y:rect.y,width:r.width,height:rect.height};}
          if(el.matches('.summary .value')){const r=el.closest('.summary').getBoundingClientRect();rect={x:r.x+8,y:rect.y,width:r.width-16,height:rect.height};}
          if(el.matches('.footer span:first-child')){const r=el.closest('.footer').getBoundingClientRect();rect={x:r.x,y:rect.y,width:r.width*.67,height:rect.height};}
          if(el.matches('.footer .page-num')){const r=el.closest('.footer').getBoundingClientRect();rect={x:r.x+r.width*.76,y:rect.y,width:r.width*.24,height:rect.height};}
          fields[el.dataset.jaguarField]={...pos(rect),font:parseFloat(css.fontSize),family:css.fontFamily,weight:css.fontWeight,italic:css.fontStyle==='italic',align:css.textAlign,transform:css.textTransform,color:css.color,lineHeight:parseFloat(css.lineHeight)||parseFloat(css.fontSize)*1.2};
        }
        const qr=s.querySelector('.qr-box');if(qr)fields['1.qr']=pos(qr.getBoundingClientRect());
        for(const [j,el] of [...s.querySelectorAll('.teacher-table .signcell')].entries())fields[`2.signature.${j}`]=pos(el.getBoundingClientRect());
        for(const [j,el] of [...s.querySelectorAll('.compact-validation .sign-block')].entries())fields[`2.signbox.${j}`]=pos(el.getBoundingClientRect());
        for(const [j,el] of [...s.querySelectorAll('.department')].entries())fields[`3.signbox.${j}`]=pos(el.getBoundingClientRect());
        for(const [j,el] of [...s.querySelectorAll('.sign-area .sign-block')].entries())fields[`1.signbox.${j}`]=pos(el.getBoundingClientRect());
        fields['meta.bottom']=pos(s.querySelector('.footer').getBoundingClientRect());
        result[name]=fields;
      }
      return result;
    }''')
    pdf_path=ROOT/'assets/boleta-visual15-base.pdf'
    page.pdf(path=str(pdf_path),format='Letter',print_background=True,prefer_css_page_size=True)
    browser.close()
assert len(positions)==len(variants),(len(positions),len(variants))
(ROOT/'assets/boleta-visual15-campos.json').write_text(json.dumps({'pages':variants,'variants':positions},ensure_ascii=False,indent=2))
print('Boletas precompiladas:',len(variants),'páginas; tamaño',round(pdf_path.stat().st_size/1024),'KB')
