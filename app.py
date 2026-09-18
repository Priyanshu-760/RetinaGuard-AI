import base64
import csv
import io
import math
import os
import time
import uuid
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
import tensorflow as tf
from PIL import Image

from flask import Flask, jsonify, render_template, request


APP_ROOT = Path(__file__).resolve().parent

MODEL_PATH = APP_ROOT / 'model' / 'best_model.keras'
VESSEL_PATH = APP_ROOT / 'model' / 'vessel_unet.keras'
LESION_PATH = APP_ROOT / 'model' / 'exudate_unet.keras'
OD_PATH = APP_ROOT / 'model' / 'od_unet.keras'
ADAPT_PATH = APP_ROOT / 'model' / 'messi_adapt_head.keras'

IMAGE_SIZE = 224
CROP_THRESHOLD = 10
CROP_PADDING = 10
MAX_FILE_SIZE = 10 * 1024 * 1024

CLASS_NAMES = [
    'No DR',
    'Mild',
    'Moderate',
    'Severe',
    'Proliferative',
]

ALLOWED_EXTENSIONS = {
    '.png',
    '.jpg',
    '.jpeg',
}

TARGET_LAYER = 'top_conv'
REF_THRESHOLD = 0.40
TEMP_T = 0.648051452123312


app = Flask(
    __name__,
    template_folder=str(APP_ROOT / 'templates'),
)

app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE


model = tf.keras.models.load_model(
    MODEL_PATH,
    compile=False,
)

# Frozen SIH inference helpers (Phase B/C/G): inner top_conv, T=0.648, t=0.40.
try:
    vessel_model = tf.keras.models.load_model(VESSEL_PATH, compile=False)
except Exception:
    vessel_model = None
try:
    lesion_model = tf.keras.models.load_model(LESION_PATH, compile=False)
except Exception:
    lesion_model = None
try:
    od_model = tf.keras.models.load_model(OD_PATH, compile=False)
except Exception:
    od_model = None
try:
    adapt_model = tf.keras.models.load_model(ADAPT_PATH, compile=False)
except Exception:
    adapt_model = None


def seg_overlay_b64(image_path, seg_model, thresh=0.3):
    raw = tf.io.read_file(str(image_path))
    img = tf.io.decode_image(raw, channels=3, expand_animations=False)
    img = tf.image.convert_image_dtype(img, tf.float32)
    small = tf.image.resize(img, [256, 256], method="bilinear")
    pred = seg_model(tf.expand_dims(small, 0), training=False).numpy()[0, ..., 0]
    mask = np.uint8(255 * (pred > thresh).astype(np.uint8))
    buf = io.BytesIO()
    Image.fromarray(mask).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def classical_proxy_b64(image_path, kind='vessel'):
    img = Image.open(str(image_path)).convert('RGB').resize((256, 256))
    arr = np.asarray(img).astype(np.float32)
    if kind == 'vessel':
        g = arr[..., 1]
        t = np.percentile(g, 12)
        mask = np.uint8(255 * (g < t))
    else:
        gray = arr.mean(axis=2)
        mask = np.uint8(255 * (gray > 200))
    buf = io.BytesIO()
    Image.fromarray(mask).save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def disc_fovea_estimate(image_path):
    img = Image.open(str(image_path)).convert('RGB').resize((256, 256))
    arr = np.asarray(img).astype(np.float32)
    gray = arr.mean(axis=2)
    dy, dx = np.unravel_index(np.argmax(gray), gray.shape)
    dark = gray.copy()
    dark[:, :128] = 255
    fy, fx = np.unravel_index(np.argmin(dark), dark.shape)
    return {'disc_xy_256': [int(dx), int(dy)], 'fovea_xy_256': [int(fx), int(fy)],
            'method': 'classical_brightness_proxy'}


def od_mask_overlay_b64(image_path, od_model, thresh=0.3):
    raw = tf.io.read_file(str(image_path))
    img = tf.io.decode_image(raw, channels=3, expand_animations=False)
    img = tf.image.convert_image_dtype(img, tf.float32)
    small = tf.image.resize(img, [256, 256], method='bilinear')
    pred = od_model(tf.expand_dims(small, 0), training=False).numpy()[0, ..., 0]
    mask = (pred > thresh).astype(np.uint8)
    ys, xs = np.where(mask > 0)
    cx, cy = (int(xs.mean()), int(ys.mean())) if len(xs) else (128, 128)
    buf = io.BytesIO()
    Image.fromarray(np.uint8(255 * mask)).save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode(), [cx, cy]


_rescaling = model.get_layer("efficientnet_input_rescaling")
_inner = model.get_layer("efficientnetb0")
_conv_model = tf.keras.Model(
    _inner.inputs,
    _inner.get_layer("top_conv").output,
)
_top_bn = _inner.get_layer("top_bn")
_top_act = _inner.get_layer("top_activation")
_gap = model.get_layer("global_average_pooling")
_drop = model.get_layer("dropout")
_clf = model.get_layer("dr_classifier")


def calibrate_score(score):
    p = min(max(float(score), 1e-6), 1 - 1e-6)
    logit = math.log(p / (1 - p))
    return float(1 / (1 + math.exp(-logit / TEMP_T)))


def gradcam_overlay(pre_img_tensor, class_idx):
    inp = tf.expand_dims(pre_img_tensor, 0)
    conv_out = _conv_model(_rescaling(inp), training=False)
    with tf.GradientTape() as tape:
        tape.watch(conv_out)
        y = _top_act(_top_bn(conv_out, training=False))
        y = _drop(_gap(y), training=False)
        preds = _clf(y)
        loss = preds[:, class_idx]
    grads = tape.gradient(loss, conv_out)
    weights = tf.reduce_mean(grads, axis=(0, 1, 2))
    cam = tf.reduce_sum(conv_out[0] * weights, axis=-1).numpy()
    cam = np.maximum(cam, 0)
    if cam.max() > 0:
        cam = cam / cam.max()
    cam_u8 = np.uint8(255 * cam)
    heat_img = Image.fromarray(cam_u8).resize((224, 224))
    buf_hm = io.BytesIO()
    heat_img.save(buf_hm, format="PNG")
    base = Image.fromarray(
        np.uint8(255 * np.clip(pre_img_tensor.numpy(), 0, 1))
    ).resize((224, 224)).convert("RGB")
    red = np.zeros((224, 224, 3), dtype=np.uint8)
    red[..., 0] = np.array(heat_img.convert("L"))
    overlay = Image.blend(base, Image.fromarray(red), 0.45)
    buf_ov = io.BytesIO()
    overlay.save(buf_ov, format="PNG")
    return (
        base64.b64encode(buf_hm.getvalue()).decode(),
        base64.b64encode(buf_ov.getvalue()).decode(),
    )


def preprocess_image(image_path):

    image_bytes = tf.io.read_file(str(image_path))

    image = tf.io.decode_image(
        image_bytes,
        channels=3,
        expand_animations=False,
    )

    image = tf.image.convert_image_dtype(
        image,
        tf.float32,
    )

    gray = tf.reduce_mean(image, axis=-1)

    mask = gray > tf.cast(
        CROP_THRESHOLD / 255.0,
        tf.float32,
    )

    coords = tf.where(mask)

    def crop_image():

        y_min = tf.cast(
            tf.reduce_min(coords[:, 0]),
            tf.int32,
        )

        y_max = tf.cast(
            tf.reduce_max(coords[:, 0]),
            tf.int32,
        )

        x_min = tf.cast(
            tf.reduce_min(coords[:, 1]),
            tf.int32,
        )

        x_max = tf.cast(
            tf.reduce_max(coords[:, 1]),
            tf.int32,
        )

        h = tf.cast(
            tf.shape(image)[0],
            tf.int32,
        )

        w = tf.cast(
            tf.shape(image)[1],
            tf.int32,
        )

        y_min = tf.maximum(
            y_min - CROP_PADDING,
            0,
        )

        x_min = tf.maximum(
            x_min - CROP_PADDING,
            0,
        )

        y_max = tf.minimum(
            y_max + CROP_PADDING + 1,
            h,
        )

        x_max = tf.minimum(
            x_max + CROP_PADDING + 1,
            w,
        )

        return image[y_min:y_max, x_min:x_max]

    image = tf.cond(
        tf.size(coords) > 0,
        crop_image,
        lambda: image,
    )

    image = tf.image.resize(
        image,
        [IMAGE_SIZE, IMAGE_SIZE],
        method='bilinear',
    )

    image = tf.clip_by_value(
        image,
        0.0,
        1.0,
    )

    return image


def blur_variance(image_path):
    from PIL import ImageFilter
    img = Image.open(str(image_path)).convert('L').resize((256, 256))
    px = np.asarray(img, dtype=np.float32)
    lap = (
        np.roll(px, 1, 0) + np.roll(px, -1, 0)
        + np.roll(px, 1, 1) + np.roll(px, -1, 1)
        - 4 * px
    )[1:-1, 1:-1]
    return float(lap.var())


def enhance_borderline_file(src_path, dst_path):
    from PIL import ImageFilter, ImageOps
    img = Image.open(str(src_path)).convert('RGB')
    bg = img.resize((64, 64)).filter(ImageFilter.GaussianBlur(8)).resize(img.size)
    arr = np.asarray(img, dtype=np.float32)
    bg_arr = np.asarray(bg, dtype=np.float32)
    flat = np.clip(arr - (bg_arr - bg_arr.mean()) * 0.6, 0, 255).astype(np.uint8)
    out = Image.fromarray(flat)
    out = ImageOps.autocontrast(out, cutoff=0.5)
    out.save(str(dst_path))


def assess_quality(image_path):

    image = tf.io.decode_image(
        tf.io.read_file(str(image_path)),
        channels=3,
        expand_animations=False,
    )

    image = tf.image.convert_image_dtype(
        image,
        tf.float32,
    )

    arr = image.numpy()

    h, w = arr.shape[:2]

    gray = np.mean(arr, axis=2)

    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    black_fraction = float(np.mean(gray < 0.04))

    non_black = gray >= 0.04

    if np.any(non_black):

        ys, xs = np.where(non_black)

        y_range = float(ys.max() - ys.min() + 1) / max(h, 1)
        x_range = float(xs.max() - xs.min() + 1) / max(w, 1)

        fov_fraction = float(y_range * x_range)

    else:

        fov_fraction = 0.0

    flags = []

    if h < 100 or w < 100:
        flags.append('very_small_image')

    if brightness < 0.05:
        flags.append('very_dark')

    if brightness > 0.95:
        flags.append('very_bright')

    if contrast < 0.05:
        flags.append('very_low_contrast')

    if black_fraction > 0.85:
        flags.append('extreme_black_background')

    elif black_fraction > 0.70:
        flags.append('large_black_background')

    if fov_fraction < 0.15:
        flags.append('small_visible_fov')

    try:
        blur = blur_variance(image_path)
    except Exception:
        blur = 0.0
    if blur < 10:
        flags.append('likely_blurry_recapture')
    elif blur < 25:
        flags.append('borderline_focus_enhance')

    score = 1.0

    penalties = {
        'very_small_image': 0.40,
        'very_dark': 0.15,
        'very_bright': 0.15,
        'very_low_contrast': 0.20,
        'extreme_black_background': 0.15,
        'large_black_background': 0.08,
        'small_visible_fov': 0.15,
        'likely_blurry_recapture': 0.35,
        'borderline_focus_enhance': 0.10,
    }

    for flag in flags:
        score -= penalties.get(flag, 0.0)

    score = float(np.clip(score, 0.0, 1.0))

    if score >= 0.70:
        status = 'acceptable'
    elif score >= 0.40:
        status = 'review'
    else:
        status = 'ungradable'

    return {
        'status': status,
        'acceptable': status == 'acceptable',
        'score': score,
        'brightness': brightness,
        'contrast': contrast,
        'black_background_fraction': black_fraction,
        'fov_fraction': fov_fraction,
        'blur_variance': blur,
        'width': int(w),
        'height': int(h),
        'flags': flags,
        'advisory_only': False,
        'action': (
            'recapture: clean lens, fix focus/illumination, re-acquire'
            if status == 'ungradable' or blur < 10
            else 'enhance_then_grade' if ('borderline_focus_enhance' in flags or status == 'review')
            else 'grade_direct'
        ),
    }


def predict_image(image_path):
    """
    Run the frozen champion model on an already-resolved image path.

    The saved champion model already contains a final
    Dense(5, activation="softmax") layer, so the model output
    is already a probability vector.
    """

    image = preprocess_image(image_path)

    tensor = tf.expand_dims(
        image,
        axis=0,
    )

    # IMPORTANT:
    # The model already returns probabilities.
    # Do NOT apply another softmax here.
    probabilities = model(
        tensor,
        training=False,
    ).numpy()[0]

    probabilities = np.asarray(
        probabilities,
        dtype=np.float64,
    )

    if probabilities.shape != (5,):
        raise ValueError(
            f"Expected five probabilities, "
            f"got shape {probabilities.shape}"
        )

    if not np.all(
        np.isfinite(probabilities)
    ):
        raise ValueError(
            "Invalid model probabilities."
        )

    if not np.isclose(
        probabilities.sum(),
        1.0,
        atol=1e-5,
    ):
        raise ValueError(
            "Model probabilities do not sum to one."
        )

    predicted_index = int(
        np.argmax(probabilities)
    )

    confidence = float(
        probabilities[predicted_index]
    )

    return {
        'class_index': predicted_index,
        'grade': CLASS_NAMES[predicted_index],
        'confidence': confidence,
        'probabilities': [
            float(x)
            for x in probabilities
        ],
    }



@app.route("/")
def index():
    return render_template("index.html")

@app.route('/health')
def health():
    return jsonify({
        'status': 'healthy',
        'service': 'RetinaGuard',
        'model': 'B0_CLASSWEIGHTED_FINETUNED_224',
        'input_size': '224x224',
        'classes': 5,
    })


@app.route('/analyze', methods=['POST'])
def analyze():

    if 'image' not in request.files:
        return jsonify({
            'success': False,
            'error': 'No image uploaded.',
        }), 400

    uploaded = request.files['image']

    filename = (
        uploaded.filename or ''
    ).strip()

    if not filename:
        return jsonify({
            'success': False,
            'error': 'Empty filename.',
        }), 400

    extension = Path(filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({
            'success': False,
            'error': 'Unsupported image format. Use PNG or JPEG.',
        }), 400

    temp_path = None

    t0 = time.time()

    try:

        with NamedTemporaryFile(
            suffix=extension,
            delete=False,
        ) as temp_file:

            temp_path = Path(temp_file.name)
            uploaded.save(str(temp_path))

        quality = assess_quality(temp_path)

        force = request.args.get('force', '') == '1'
        if (quality['status'] == 'ungradable' or quality.get('blur_variance', 99) < 10) and not force:
            return jsonify({
                'success': False,
                'rejected': True,
                'quality': quality,
                'recapture_feedback': quality['action'],
                'hint': 'Re-acquire with fix, or retry with ?force=1 for demo only.',
            }), 422

        grade_path = temp_path
        enhanced_tmp = None
        enhancement_applied = False
        if quality.get('action') == 'enhance_then_grade':
            try:
                with NamedTemporaryFile(suffix=extension, delete=False) as ef:
                    enhanced_tmp = Path(ef.name)
                enhance_borderline_file(temp_path, enhanced_tmp)
                grade_path = enhanced_tmp
                enhancement_applied = True
            except Exception:
                grade_path = temp_path

        prediction = predict_image(grade_path)

        probs = prediction['probabilities']
        raw_score = float(probs[2] + probs[3] + probs[4])
        cal_score = calibrate_score(raw_score)
        referable = bool(raw_score >= REF_THRESHOLD)
        adapt_score = None
        if adapt_model is not None:
            try:
                aimg = preprocess_image(grade_path)
                ap = adapt_model(tf.expand_dims(aimg, 0), training=False).numpy()[0]
                adapt_score = float(ap[2] + ap[3] + ap[4])
            except Exception:
                adapt_score = None

        try:
            pre_t = preprocess_image(grade_path)
            hm_b64, ov_b64 = gradcam_overlay(
                pre_t,
                prediction['class_index'],
            )
            gradcam_available = True
        except Exception:
            hm_b64, ov_b64 = None, None
            gradcam_available = False

        try:
            if od_model is not None:
                od_b64, od_xy = od_mask_overlay_b64(grade_path, od_model, 0.3)
            else:
                od_b64, od_xy = None, None
        except Exception:
            od_b64, od_xy = None, None

        return jsonify({
            'success': True,
            'model': {
                'name': 'B0_CLASSWEIGHTED_FINETUNED_224',
                'architecture': 'EfficientNetB0',
                'input_size': '224x224',
                'classes': CLASS_NAMES,
                'frozen': True,
            },
            'prediction': prediction,
            'quality': quality,
            'referable': {
                'score_raw': raw_score,
                'score_calibrated': cal_score,
                'threshold': REF_THRESHOLD,
                'referable': referable,
                'definition': 'Level 2+ threshold frozen on train 2929',
                'adapt_score_messidor': adapt_score,
                'adapt_available': adapt_model is not None,
            },
            'gradcam': {
                'available': gradcam_available,
                'target_layer': 'efficientnetb0/top_conv',
                'method': 'Grad-CAM',
                'heatmap_png_base64': hm_b64,
                'overlay_png_base64': ov_b64,
                'note': 'Attention map only. Not a lesion detector. Not clinical evidence.',
            },
            'structures': {
                'vessel_png_base64': seg_overlay_b64(grade_path, vessel_model, 0.1) if vessel_model is not None else classical_proxy_b64(grade_path, 'vessel'),
                'vessel_available': True,
                'vessel_method': 'unet_v4_dice0.298_t0.1' if vessel_model is not None else 'classical_proxy',
                'dataset': 'DRIVE (v4 Dice 0.298)' if vessel_model is not None else 'DRIVE (classical proxy, UNet weights not installed)',
                'disc_fovea': disc_fovea_estimate(grade_path),
                'od_unet_available': od_model is not None,
                'od_mask_png_base64': od_b64,
                'od_centroid_xy_256': od_xy,
                'od_dataset': 'IDRiD (v4 OD Dice 0.772 @t0.3)',
            },
            'lesions': {
                'exudate_png_base64': seg_overlay_b64(grade_path, lesion_model, 0.1) if lesion_model is not None else classical_proxy_b64(grade_path, 'exudate'),
                'lesion_available': True,
                'lesion_method': 'unet_v4_dice0.283_t0.1' if lesion_model is not None else 'classical_proxy',
                'dataset': 'IDRiD (v4 exudate Dice 0.283)' if lesion_model is not None else 'IDRiD (classical proxy, UNet weights not installed)',
                'note': 'Lesion evidence correlated with grade. Grad-CAM is separate attention. MA/hemorrhage/neovascularization: classical proxy, UNet training pending.',
            },
            'preprocessing': {
                'rgb': True,
                'crop_threshold': CROP_THRESHOLD,
                'crop_padding': CROP_PADDING,
                'resize': '224x224',
                'normalization': '[0,1]',
                'augmentation': False,
                'enhancement_applied': enhancement_applied,
                'enhancement': 'illumination-flatten + autocontrast for borderline; reject ungradable with recapture',
            },
            'safety': {
                'screening_support_only': True,
                'not_a_medical_diagnosis': True,
                'requires_healthcare_professional_review': True,
            },
            'explainability': {
                'case_id': uuid.uuid4().hex[:12],
                'elapsed_sec': round(time.time() - t0, 2),
                'target_30s': True,
                'lesion_grade_correlation': (
                    'Referable score and 5-class grade agree. '
                    if referable == (prediction['class_index'] >= 2)
                    else 'Discordant: 5-class grade says '
                    + prediction['grade']
                    + ' but referable score says '
                    + ('referable' if referable else 'non-referable')
                    + '. Safety-first: referable overrides grade. Flag for human review. '
                )
                + 'Grad-CAM is attention only; vessel/exudate overlays are lesion evidence.',
                'validation_checklist_30s': [
                    '1. Quality: ' + quality['status'],
                    '2. Grade: ' + prediction['grade'],
                    '3. Referable L2+: ' + str(referable),
                    '4. Heatmap + lesion overlays inspected',
                    '5. Safety: screening only, needs professional review',
                ],
            },
        })

    except Exception as exc:

        return jsonify({
            'success': False,
            'error': str(exc),
        }), 500

    finally:

        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
        try:
            if 'enhanced_tmp' in locals() and enhanced_tmp is not None:
                enhanced_tmp.unlink(missing_ok=True)
        except Exception:
            pass


@app.route('/validation')
def validation():
    return jsonify({
        'aptos_val_733': {'roc': 0.973, 'sens': 0.9228, 'spec': 0.9149, 't': 0.40, 'status': 'PASS'},
        'messidor2_frozen_1744': {'roc': 0.734, 'sens': 0.3829, 'spec': 0.9052, 't': 0.40, 'status': 'FAIL sens'},
        'messidor2_adapted_val_524': {'roc': 0.779, 'sens': 0.4891, 'spec': 0.8992, 't': 0.40, 'status': 'improved, NOT YET'},
        'drive_vessel': {'dice': 0.298, 'thresh': 0.1, 'status': 'v4 production'},
        'idrid_exudate': {'dice': 0.283, 'thresh': 0.1, 'status': 'v4 production'},
        'idrid_od': {'dice': 0.772, 'thresh': 0.3, 'status': 'v4 production'},
        'idrid_he_ma': {'status': 'classical proxy, UNet pending'},
        'integrated_vs_single': 'integrated grade+vessel+lesion+quality+GradCAM deployed; single-technique CLAHE blanket fails spec',
    })


@app.route('/feedback', methods=['POST'])
def feedback():
    data = request.get_json(force=True, silent=True) or {}
    rating = str(data.get('rating', '')).strip()
    case_id = str(data.get('case_id', '')).strip()
    comment = str(data.get('comment', ''))[:500]
    if rating not in {'useful', 'not_useful', 'unsure'}:
        return jsonify({'success': False, 'error': "rating must be useful/not_useful/unsure."}), 400
    fb_path = APP_ROOT / 'feedback.csv'
    new_file = not fb_path.exists()
    with open(fb_path, 'a', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(['timestamp', 'case_id', 'rating', 'comment'])
        w.writerow([time.strftime('%Y-%m-%dT%H:%M:%S'), case_id, rating, comment])
    return jsonify({'success': True})


@app.route('/report', methods=['POST'])
def report():
    # Printable annotated report reusing /analyze pipeline (HTML, print-to-PDF in <30s).
    if 'image' not in request.files:
        return 'No image uploaded.', 400
    uploaded = request.files['image']
    filename = (uploaded.filename or '').strip()
    if not filename:
        return 'Empty filename.', 400
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        return 'Unsupported image format. Use PNG or JPEG.', 400
    temp_path = None
    try:
        with NamedTemporaryFile(suffix=extension, delete=False) as tf_:
            temp_path = Path(tf_.name)
            uploaded.save(str(temp_path))
        quality = assess_quality(temp_path)
        prediction = predict_image(temp_path)
        probs = prediction['probabilities']
        raw_score = float(probs[2] + probs[3] + probs[4])
        cal_score = calibrate_score(raw_score)
        referable = bool(raw_score >= REF_THRESHOLD)
        try:
            hm_b64, ov_b64 = gradcam_overlay(preprocess_image(temp_path), prediction['class_index'])
        except Exception:
            hm_b64, ov_b64 = None, None
        ves_b64 = seg_overlay_b64(temp_path, vessel_model, 0.2) if vessel_model is not None else None
        les_b64 = seg_overlay_b64(temp_path, lesion_model, 0.3) if lesion_model is not None else None
        def img_tag(b64, label):
            if not b64:
                return f'<p>{label}: unavailable</p>'
            return f'<p>{label}:<br><img src="data:image/png;base64,{b64}" style="max-width:320px"></p>'
        return (
            f'<html><body style="font-family:sans-serif;max-width:800px">'
            f'<h2>RetinaGuard Screening Report (support only, not a diagnosis)</h2>'
            f'<p>Grade: <b>{prediction["grade"]}</b> | Referable L2+: <b>{referable}</b> '
            f'(raw {raw_score:.3f}, cal {cal_score:.3f}, t={REF_THRESHOLD}) | '
            f'Quality: {quality["status"]} | Safety: needs professional review</p>'
            + img_tag(hm_b64, 'Grad-CAM attention (not lesion evidence)')
            + img_tag(ov_b64, 'Grad-CAM overlay')
            + img_tag(ves_b64, 'Vessel overlay (DRIVE prototype)')
            + img_tag(les_b64, 'Exudate overlay (IDRiD prototype)')
            + f'</body></html>'
        )
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


if __name__ == '__main__':
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=False,
    )
