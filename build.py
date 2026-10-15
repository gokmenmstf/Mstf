#!/usr/bin/env python3
"""galeri-defteri.html -> web/public/index.html (+ logo.png, manifest). Kaynak dosyayı değiştirmez."""
import re,base64,json,pathlib
root=pathlib.Path(__file__).resolve().parent
srcf=root/'galeri-defteri.html'
if not srcf.exists(): srcf=root.parent/'galeri-defteri.html'
src=srcf.read_text(encoding='utf-8')
pub=root/'public';pub.mkdir(exist_ok=True)
m=re.search(r"const LOGO='data:image/png;base64,([A-Za-z0-9+/=]+)'",src)
logo=base64.b64decode(m.group(1));(pub/'logo.png').write_bytes(logo)
# kare simge (PWA): logoyu mor zemine ortala
try:
    from PIL import Image
    im=Image.open(pub/'logo.png').convert('RGBA')
    for n in (192,512):
        c=Image.new('RGBA',(n,n),(37,38,74,255));k=n*0.78/max(im.size);r=im.resize((int(im.width*k),int(im.height*k)),Image.LANCZOS)
        c.paste(r,((n-r.width)//2,(n-r.height)//2),r);c.convert('RGB').save(pub/f'icon-{n}.png')
except Exception as e: print('simge üretilemedi',e)
(pub/'manifest.webmanifest').write_text(json.dumps({"name":"Vefa Auto","short_name":"Vefa Auto","start_url":"/","display":"standalone","background_color":"#1b1a38","theme_color":"#25264a","lang":"tr","icons":[{"src":"/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any maskable"}]},ensure_ascii=False))
s=src
i=s.index('<script>\n(function(){')
s=s[:i]+'<script>\nwindow.__launch=function(){'+s[i+len('<script>\n(function(){'):]
j=s.rindex('})();\n</script>')
s=s[:j]+'};\n</script>\n<script src="/sync.js"></script>'+s[j+len('})();\n</script>'):]
meta=('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#25264a">\n'
 '<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Vefa Auto">\n'
 '<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" type="image/png" href="/icon-192.png">\n<link rel="apple-touch-icon" href="/icon-192.png">\n')
k=s.index('<datalist')
s='<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n'+meta+'<style>body{margin:0}[hidden]{display:none!important}</style>\n'+s[:k]+'</head>\n<body>\n'+s[k:]+'\n</body>\n</html>\n'
(pub/'index.html').write_text(s,encoding='utf-8')
print('index.html',len(s),'bayt')
