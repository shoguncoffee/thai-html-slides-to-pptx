import sys,os
from PIL import Image, ImageFilter
import numpy as np
name=sys.argv[1]; ref=os.environ.get('REFDIR','ref'); N=int(sys.argv[2])
res=[]
for i in range(1,N+1):
    a=Image.open(f'{ref}/s-{i:02d}.png').convert('RGB').resize((960,540)).filter(ImageFilter.GaussianBlur(5))
    b=Image.open(f'{name}-pg-{i:02d}.png').convert('RGB').resize((960,540)).filter(ImageFilter.GaussianBlur(5))
    d=np.abs(np.asarray(a,dtype=float)-np.asarray(b,dtype=float)).max(axis=2)
    res.append((d.mean(),(d>40).sum(),i))
res.sort(reverse=True)
print(' '.join(f'{i}:{m:.2f}/{c}' for m,c,i in res[:16]))
