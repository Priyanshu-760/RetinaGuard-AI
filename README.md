# RetinaGuard — Explainable Diabetic Retinopathy Screening (SIH 2026)

Screening-support prototype for primary healthcare centres. Not a medical device.

## Pipeline

Image Upload
-> Quality Gate (brightness/contrast/FOV + blur; ungradable rejected with recapture feedback, borderline enhanced)
-> DR Prediction (5-class) + Referable L2+ score
-> Grad-CAM attention + Vessel / Exudate / Optic-disc overlays
-> Annotated report + 30-second validation checklist
-> Screening Result (professional review required)

## Models (`model/`)

| File | Task | Source |
|---|---|---|
| `best_model.keras` | Grading EfficientNetB0 224x224, 5-class (No DR/Mild/Moderate/Severe/Proliferative) | APTOS |
| `messi_adapt_head.keras` | Domain-adapted grading head (optional) | Messidor-2 adapt |
| `vessel_unet.keras` | Vessel segmentation, v4 Dice 0.298 @t0.1 | DRIVE |
| `exudate_unet.keras` | Exudate segmentation, v4 Dice 0.283 @t0.1 | IDRiD |
| `od_unet.keras` | Optic-disc segmentation, v4 Dice 0.772 @t0.3 | IDRiD |

Frozen operating point: referable = P(Level 2+) >= 0.40 (locked on APTOS train 2929);
calibration T=0.648 is display-only. MA/haemorrhage/neovascularization: classical
proxy; UNet training pending.

## Validation (frozen, see `GET /validation`)

- APTOS val 733: sens 0.9228 / spec 0.9149 — PASS
- Messidor-2 1744 frozen: sens 0.3829 / spec 0.9052 — FAIL sens (domain gap)
- Messidor-2 adapted val 524: ROC 0.779, sens 0.4891 / spec 0.8992 — improved, NOT YET
- Simulink resource model: 100 camps R1 FAIL util 1.30, R2 PASS 0.65 (`simulink/`)

## API

- `GET /` web UI, `GET /health` service check
- `POST /analyze` multipart `image` -> grade, referable, quality, Grad-CAM,
  structures, lesions, explainability checklist, timing (`?force=1` demo bypass)
- `POST /report` same upload -> printable annotated HTML report
- `POST /feedback` JSON `{rating: useful/not_useful/unsure, case_id, comment}`
- `GET /validation` frozen benchmark board

Custom UI: `POST /analyze`, render grade + referable + quality action +
base64 overlays + checklist; handle HTTP 422 as recapture screen.

## Setup

```
pip install -r requirements.txt
python app.py
curl -F image=@test_fundus.png http://localhost:5000/analyze
```

## Safety

Screening support only. Not a medical diagnosis. Clinical assessment by a
qualified healthcare professional is required. The image-quality gate is
enforced in-app but is not clinically validated.
