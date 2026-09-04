import requests, json
from PIL import Image
import io

# Test 1: index page
r = requests.get('http://127.0.0.1:5000/')
print(f'GET /          -> {r.status_code}')

# Test 2: health
r = requests.get('http://127.0.0.1:5000/health')
d = r.json()
print(f'GET /health    -> {r.status_code} | model={d.get("model")} | status={d.get("status")}')

# Test 3: analyze
img = Image.new('RGB', (512, 512), color=(40, 20, 15))
buf = io.BytesIO()
img.save(buf, format='JPEG')
buf.seek(0)
r = requests.post('http://127.0.0.1:5000/analyze',
                  files={'image': ('fundus.jpg', buf, 'image/jpeg')})
d = r.json()
print(f'POST /analyze  -> {r.status_code} | success={d.get("success")}')
if d.get('success'):
    p = d['prediction']
    q = d['quality']
    print(f'  Grade       : {p["grade"]} (class_index={p["class_index"]})')
    print(f'  Confidence  : {p["confidence"]:.4f}')
    print(f'  Probs       : {[round(x,3) for x in p["probabilities"]]}')
    print(f'  Quality     : {q["status"]} (score={q["score"]:.2f})')
    print(f'  Flags       : {q["flags"]}')
    print(f'  GradCAM     : available={d["gradcam"]["available"]}')
    print(f'  Architecture: {d["model"]["architecture"]} | {d["model"]["name"]}')
    print(f'  Preproc     : rgb={d["preprocessing"]["rgb"]} resize={d["preprocessing"]["resize"]}')
else:
    print(f'  ERROR: {d.get("error")}')

print()
print('Static assets:')
for path in ['/static/css/style.css', '/static/js/app.js', '/static/favicon.svg']:
    sr = requests.get(f'http://127.0.0.1:5000{path}')
    print(f'  {sr.status_code}  {path}')
