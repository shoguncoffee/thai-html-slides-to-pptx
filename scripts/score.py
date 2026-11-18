import sys,glob
from PIL import Image, ImageChops
import numpy as np
name=sys.argv[1]; sl=[int(x) for x in sys.argv[2].split(',')]
tot=0
for i in sl:
    a=Image.open(f'ref/s-{i:02d}.png').convert('L').resize((1920,1080))
    b=Image.open(f'{name}-pg-{i:02d}.png').convert('L').resize((1920,1080))
    d=np.abs(np.asarray(a,dtype=float)-np.asarray(b,dtype=float)).mean()
    tot+=d; print(i,round(d,2),end='; ')
print('mean',round(tot/len(sl),3))
