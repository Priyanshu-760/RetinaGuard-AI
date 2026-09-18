"""RetinaGuard clinical screening report (vector PDF, light clinical style).

Presentation layer only: renders whatever the backend pipeline produced.
No medical facts are invented here — every value comes from `analysis_data`
or is explicitly marked as unavailable. Inference logic lives in app.py.
"""
import io
import os
import base64
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    Image as RLImage, HRFlowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

ACCENT = colors.HexColor('#B42318')      # restrained clinical crimson
ACCENT_SOFT = colors.HexColor('#FDECEA')
INK = colors.HexColor('#101828')
MUTED = colors.HexColor('#475467')
LINE = colors.HexColor('#D0D5DD')
PANEL = colors.HexColor('#F9FAFB')

CLASS_LABELS = ["No DR", "Mild", "Moderate", "Severe", "Proliferative"]


def b64_to_rl_image(b64_str, width=1.7 * inch, height=1.7 * inch):
    if not b64_str:
        return None
    try:
        return RLImage(io.BytesIO(base64.b64decode(b64_str)), width=width, height=height)
    except Exception:
        return None


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(36, 28, 'RetinaGuard · Screening support only — not a medical diagnosis.')
    canvas.drawRightString(A4[0] - 36, 28, 'Page %d' % doc.page)
    canvas.restoreState()


def generate_pdf_report_bytes(analysis_data, original_img_path=None):
    data = analysis_data or {}
    pred = data.get('prediction', {}) or {}
    ref = data.get('referable', {}) or {}
    quality = data.get('quality', {}) or {}
    exp = data.get('explainability', {}) or {}
    gradcam = data.get('gradcam', {}) or {}
    structures = data.get('structures', {}) or {}
    lesions = data.get('lesions', {}) or {}
    model = data.get('model', {}) or {}
    pre = data.get('preprocessing', {}) or {}

    grade = pred.get('grade', 'Unknown')
    class_idx = pred.get('class_index', 0)
    try:
        class_idx = int(class_idx)
    except Exception:
        class_idx = 0
    conf = float(pred.get('confidence', 0.0) or 0.0)
    probs = list(pred.get('probabilities', []) or [])
    while len(probs) < 5:
        probs.append(0.0)
    probs = [float(p or 0.0) for p in probs[:5]]

    referable = ref.get('referable', None)
    score_raw = ref.get('score_raw', None)
    score_cal = ref.get('score_calibrated', None)
    threshold = ref.get('threshold', 0.40)

    q_status = str(quality.get('status', 'unknown'))
    q_score = quality.get('score', None)
    flags = quality.get('flags', []) or []
    q_action = quality.get('action', '—')

    case_id = exp.get('case_id', '—')
    elapsed = exp.get('elapsed_sec', None)

    # ---- interpretation + recommendation (strictly from backend values) ----
    ref_word = ('referable' if referable is True
                else 'non-referable' if referable is False
                else 'not assessed')
    interpretation = (
        'The AI screening system classified the submitted retinal image as %s '
        'with a model confidence of %.1f%%. '
        'The screening assessment is %s. '
        'Image quality was assessed as %s.'
        % (grade, conf * 100.0, ref_word, q_status)
    )
    if q_status == 'ungradable':
        recommendation = ('Repeat retinal image acquisition is recommended because '
                          'the submitted image did not meet the system\'s quality criteria.')
    elif referable is True:
        recommendation = ('Referral for review by a qualified eye-care professional '
                          'is recommended based on the screening result.')
    elif referable is False:
        recommendation = ('Routine clinical follow-up should be determined by the '
                          'patient\'s healthcare provider. A non-referable screening '
                          'result does not establish absence of disease.')
    else:
        recommendation = ('Clinical follow-up should be determined by the patient\'s '
                          'healthcare provider.')

    # ---- document ----
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4,
                            leftMargin=40, rightMargin=40, topMargin=40, bottomMargin=48)
    styles = getSampleStyleSheet()
    title = ParagraphStyle('Title2', parent=styles['Heading1'], fontName='Helvetica-Bold',
                           fontSize=19, leading=23, textColor=INK)
    subtitle = ParagraphStyle('Sub2', parent=styles['Normal'], fontName='Helvetica',
                              fontSize=9.5, leading=13, textColor=MUTED)
    h2 = ParagraphStyle('H2', parent=styles['Heading2'], fontName='Helvetica-Bold',
                        fontSize=12, leading=15, textColor=INK, spaceBefore=14, spaceAfter=6)
    body = ParagraphStyle('Body2', parent=styles['Normal'], fontName='Helvetica',
                          fontSize=9, leading=12.5, textColor=colors.HexColor('#344054'))
    bold = ParagraphStyle('Bold2', parent=body, fontName='Helvetica-Bold', textColor=INK)
    small = ParagraphStyle('Small2', parent=body, fontSize=8, leading=11, textColor=MUTED)
    disclaim = ParagraphStyle('Disc2', parent=body, fontName='Helvetica-Oblique',
                              fontSize=8, leading=11, textColor=MUTED)

    story = []
    story.append(Paragraph('DIABETIC RETINOPATHY SCREENING REPORT', title))
    story.append(Paragraph('AI-assisted retinal image screening · Decision support document', subtitle))
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width='100%', thickness=2, color=ACCENT, spaceAfter=10))

    def panel(rows, widths=None):
        t = Table(rows, colWidths=widths, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), PANEL),
            ('BOX', (0, 0), (-1, -1), 0.8, LINE),
            ('INNERGRID', (0, 0), (-1, -1), 0.4, LINE),
            ('PADDING', (0, 0), (-1, -1), 7),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        return t

    def P(text, style=body):
        return Paragraph(text, style)

    # 1. Examination Summary
    story.append(Paragraph('1. Examination Summary', h2))
    story.append(panel([
        [P('<b>Case ID:</b> ' + str(case_id)),
         P('<b>Analysis time:</b> ' + ('%.2f s' % float(elapsed) if elapsed is not None else '—'))],
        [P('<b>Model:</b> ' + str(model.get('name', 'B0_CLASSWEIGHTED_FINETUNED_224'))),
         P('<b>Input:</b> ' + str(model.get('input_size', '224x224')) + ' · ' +
           str(model.get('architecture', 'EfficientNetB0')))],
    ], widths=[3.65 * inch, 3.65 * inch]))
    story.append(Spacer(1, 4))
    story.append(P('This report was generated by automated analysis of the submitted retinal '
                   'fundus image. No patient history, symptoms, laboratory values, or prior '
                   'examinations were available to, or used by, the system.', small))

    # 2. AI Screening Result
    story.append(Paragraph('2. AI Screening Result', h2))
    story.append(panel([
        [P('<b>Predicted grade:</b> <font color="#B42318"><b>' + str(grade) + '</b></font>'),
         P('<b>Model confidence:</b> %.1f%%' % (conf * 100.0))],
    ], widths=[3.65 * inch, 3.65 * inch]))
    story.append(Spacer(1, 4))
    story.append(P('Confidence reflects the strength of the model output for the predicted '
                   'class. It is not a clinical probability of disease.', small))

    # 3. Referable Screening Status
    story.append(Paragraph('3. Referable Screening Status', h2))
    ref_text = ('REFERABLE — review by an eye-care professional is advised'
                if referable is True else
                'NON-REFERABLE — routine follow-up per provider judgment'
                if referable is False else 'NOT ASSESSED')
    story.append(panel([
        [P('<b>Status:</b> <b>' + ref_text + '</b>'),
         P('<b>Referable score:</b> ' + ('%.3f' % float(score_raw) if score_raw is not None else '—') +
           ' · <b>Threshold:</b> ≥ %.2f' % float(threshold))],
    ], widths=[3.65 * inch, 3.65 * inch]))
    if score_cal is not None:
        story.append(Spacer(1, 4))
        story.append(P('Calibrated display score: %.3f (calibration is display-only; '
                       'the referral decision uses the uncalibrated score).' % float(score_cal), small))

    # 4. Image Quality Assessment
    story.append(Paragraph('4. Image Quality Assessment', h2))
    q_rows = [
        [P('<b>Status:</b> ' + q_status.upper()),
         P('<b>Quality score:</b> ' + ('%.0f%%' % (float(q_score) * 100.0) if q_score is not None else '—'))],
        [P('<b>Brightness:</b> %.2f' % float(quality.get('brightness', 0.0) or 0.0)),
         P('<b>Contrast:</b> %.2f' % float(quality.get('contrast', 0.0) or 0.0))],
        [P('<b>Field of view:</b> ' + ('%.0f%%' % (float(quality.get('fov_fraction', 0.0) or 0.0) * 100.0)
           if quality.get('fov_fraction') is not None else '—')),
         P('<b>Blur variance:</b> ' + ('%.1f' % float(quality.get('blur_variance', 0.0) or 0.0)
           if quality.get('blur_variance') is not None else '—'))],
        [P('<b>Image dimensions:</b> ' + ('%s × %s px' % (quality.get('width'), quality.get('height'))
           if quality.get('width') and quality.get('height') else '—')),
         P('<b>Black background:</b> ' + ('%.1f%%' % (float(quality.get('black_background_fraction', 0.0) or 0.0) * 100.0)
           if quality.get('black_background_fraction') is not None else '—'))],
        [P('<b>Quality flags:</b> ' + (', '.join(str(f).replace('_', ' ') for f in flags) if flags else 'None recorded')),
         P('<b>System action:</b> ' + str(q_action))],
    ]
    story.append(panel(q_rows, widths=[3.65 * inch, 3.65 * inch]))
    story.append(Spacer(1, 4))
    story.append(P('Image-quality assessment is advisory. It evaluates technical suitability '
                   'for automated analysis and is not a clinical validation of the image.', small))

    # 5. Probability Distribution
    story.append(Paragraph('5. AI Classification Probability Distribution', h2))
    hdr = [P('<b>%s</b>' % c) for c in CLASS_LABELS]
    vals = [P(('<b>%.1f%%</b>' % (probs[i] * 100.0)) if i == class_idx else ('%.1f%%' % (probs[i] * 100.0)),
              bold if i == class_idx else body) for i in range(5)]
    pt = Table([hdr, vals], colWidths=[1.46 * inch] * 5, hAlign='LEFT')
    style_cmds = [('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#F2F4F7')),
                  ('GRID', (0, 0), (-1, -1), 0.5, LINE),
                  ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                  ('PADDING', (0, 0), (-1, -1), 6)]
    if 0 <= class_idx < 5:
        style_cmds.append(('BACKGROUND', (class_idx, 0), (class_idx, 1), ACCENT_SOFT))
    pt.setStyle(TableStyle(style_cmds))
    story.append(pt)
    story.append(Spacer(1, 4))
    story.append(P('Predicted class is highlighted. Class order is fixed: No DR, Mild, '
                   'Moderate, Severe, Proliferative.', small))

    # 6. Visual Evidence
    story.append(Paragraph('6. Retinal Image / Visual Evidence', h2))
    orig = None
    if original_img_path and os.path.exists(str(original_img_path)):
        try:
            orig = RLImage(str(original_img_path), width=1.7 * inch, height=1.7 * inch)
        except Exception:
            orig = None
    hm = b64_to_rl_image(gradcam.get('heatmap_png_base64') or gradcam.get('overlay_png_base64'))
    ves = b64_to_rl_image(structures.get('vessel_png_base64'))
    les = b64_to_rl_image(lesions.get('exudate_png_base64'))
    story.append(Table(
        [[orig or P('Input fundus<br/>(unavailable)'),
          hm or P('Grad-CAM<br/>(unavailable)'),
          ves or P('Vessels<br/>(unavailable)'),
          les or P('Exudates<br/>(unavailable)')],
         [P('<b>Input fundus</b>'), P('<b>AI attention</b>'),
          P('<b>Vessels</b>'), P('<b>Exudates</b>')]],
        colWidths=[1.82 * inch] * 4, hAlign='LEFT',
        style=TableStyle([('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                          ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                          ('GRID', (0, 0), (-1, -1), 0.5, LINE),
                          ('BACKGROUND', (0, 1), (-1, 1), PANEL),
                          ('PADDING', (0, 0), (-1, -1), 4)])))
    story.append(Spacer(1, 4))
    story.append(P('Only visualizations produced by the analysis pipeline are shown. Panels '
                   'marked unavailable were not produced for this case; no image is substituted.', small))

    # 7. Explainability
    story.append(Paragraph('7. Explainability', h2))
    story.append(P('<b>Method:</b> %s · <b>Target layer:</b> %s'
                   % (gradcam.get('method', 'Grad-CAM'),
                      gradcam.get('target_layer', 'efficientnetb0/top_conv'))))
    if gradcam.get('note'):
        story.append(P(str(gradcam.get('note')), small))
    corr = exp.get('lesion_grade_correlation')
    if corr:
        story.append(Spacer(1, 4))
        story.append(P('<b>Lesion / grade correlation:</b> ' + str(corr)))
    checklist = exp.get('validation_checklist_30s') or []
    if checklist:
        story.append(Spacer(1, 4))
        story.append(P('<b>Validation checklist:</b>', bold))
        for item in checklist:
            story.append(P('☐&nbsp;&nbsp;' + str(item)))
    story.append(Spacer(1, 4))
    story.append(P('Explainability visualizations represent model attention and supporting '
                   'image analysis. They are not standalone clinical evidence and do not '
                   'confirm the presence or absence of any lesion.', small))

    # 8. Technical Model Information
    story.append(Paragraph('8. Technical Model Information', h2))
    tech_rows = []
    if model.get('name'):
        tech_rows.append([P('<b>Model:</b> ' + str(model.get('name'))),
                          P('<b>Architecture:</b> ' + str(model.get('architecture', '—')))])
    if pre:
        tech_rows.append([P('<b>Preprocessing:</b> crop thr %s · pad %s · %s · %s'
                             % (pre.get('crop_threshold', '—'), pre.get('crop_padding', '—'),
                                pre.get('resize', '—'), pre.get('normalization', '—'))),
                          P('<b>Enhancement applied:</b> ' + ('Yes' if pre.get('enhancement_applied') else 'No'))])
    vmethod = structures.get('vessel_method')
    lmethod = lesions.get('lesion_method')
    if vmethod or lmethod:
        tech_rows.append([P('<b>Vessel method:</b> ' + str(vmethod or '—')),
                          P('<b>Lesion method:</b> ' + str(lmethod or '—'))])
    if tech_rows:
        story.append(panel(tech_rows, widths=[3.65 * inch, 3.65 * inch]))
    if structures.get('dataset') or lesions.get('dataset'):
        story.append(Spacer(1, 4))
        story.append(P('Segmentation sources: vessels — %s; lesions — %s. Classical-proxy '
                       'outputs are approximations, not validated measurements.'
                       % (structures.get('dataset', '—'), lesions.get('dataset', '—')), small))

    # 9. Screening Interpretation
    story.append(Paragraph('9. Screening Interpretation', h2))
    story.append(P(interpretation))

    # 10. Recommended Next Step
    story.append(Paragraph('10. Recommended Next Step', h2))
    story.append(P(recommendation))
    story.append(Spacer(1, 4))
    story.append(P('No treatment is prescribed by this system. All decisions regarding '
                   'referral urgency, follow-up intervals, and management remain with the '
                   'responsible healthcare provider.', small))

    # 11. Safety Notice
    story.append(Paragraph('11. Safety Notice', h2))
    story.append(Paragraph(
        '<b>SCREENING SUPPORT ONLY.</b> This document does not provide a medical diagnosis. '
        'Results should be reviewed by a qualified healthcare professional. Image-quality '
        'assessment is advisory and is not clinically validated.',
        ParagraphStyle('SafetyBox', parent=body, fontName='Helvetica-Bold', fontSize=9,
                       leading=12.5, textColor=colors.HexColor('#7A2E0E'),
                       backColor=colors.HexColor('#FFF7ED'), borderPadding=8)))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    buffer.seek(0)
    return buffer.getvalue()
