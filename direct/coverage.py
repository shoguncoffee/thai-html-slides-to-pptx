import re,sys
from docx import Document
from pptx import Presentation
def norm(t): return re.sub(r'\s+','',t)
doc=Document(sys.argv[1]);P=Presentation(sys.argv[2])
buf=[]
for s in P.slides:
    for sh in s.shapes:
        if sh.has_text_frame: buf.append(sh.text_frame.text)
        if sh.has_table:
            for r in sh.table.rows:
                for c in r.cells: buf.append(c.text_frame.text)
big=norm(' '.join(buf))
miss=[]
seen=set()
def chk(t,where):
    t=t.strip()
    if len(t)<4 or '[ระบุ' in t or '[ตรวจสอบ' in t or t in seen: return
    seen.add(t)
    for part in [p for p in t.split('\n') if len(p.strip())>=4]:
        if norm(part) not in big: miss.append((where,part[:110]))
for i,p in enumerate(doc.paragraphs): chk(p.text,'p%d'%i)
for ti,t in enumerate(doc.tables):
    for r in t.rows:
        for c in r.cells:
            for p in c.paragraphs: chk(p.text,'t%d'%ti)
print(len(miss))
for m in miss: print(m)
