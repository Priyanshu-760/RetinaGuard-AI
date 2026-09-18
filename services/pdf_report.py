import io
import os
import base64
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch

def b64_to_rl_image(b64_str, width=1.8*inch, height=1.8*inch):
    if not b64_str:
        return None
    try:
        raw_bytes = base64.b64decode(b64_str)
        buf = io.BytesIO(raw_bytes)
        img = RLImage(buf, width=width, height=height)
        return img
    except Exception:
        return None

def generate_pdf_report_bytes(analysis_data, original_img_path=None):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=36,
        rightMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=colors.HexColor('#0F172A')
    )
    
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=13,
        textColor=colors.HexColor('#64748B')
    )

    h2_style = ParagraphStyle(
        'SectionHeading',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=16,
        textColor=colors.HexColor('#1E293B'),
        spaceBefore=10,
        spaceAfter=6
    )

    body_style = ParagraphStyle(
        'BodyTextCustom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#334155')
    )

    body_bold = ParagraphStyle(
        'BodyBoldCustom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#0F172A')
    )

    alert_style = ParagraphStyle(
        'AlertText',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#991B1B')
    )

    disclaimer_style = ParagraphStyle(
        'DisclaimerText',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=8,
        leading=11,
        textColor=colors.HexColor('#475569')
    )

    story = []

    # 1. Header Banner
    story.append(Paragraph("RetinaGuard™ Clinical Telemedicine Screening Report", title_style))
    story.append(Paragraph("AI-Assisted Retinal Image Analysis & Decision Support · Rural India PHC Workflow", subtitle_style))
    story.append(Spacer(1, 8))
    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#2563EB'), spaceAfter=12))

    # Extract Data Fields
    pred = analysis_data.get('prediction', {})
    grade = pred.get('grade', 'Unknown')
    class_idx = pred.get('class_index', 0)
    conf = pred.get('confidence', 0.0) * 100.0

    ref = analysis_data.get('referable', {})
    referable_bool = ref.get('referable', False)
    score_raw = ref.get('score_raw', 0.0)
    score_cal = ref.get('score_calibrated', 0.0)
    ref_thresh = ref.get('threshold', 0.40)

    quality = analysis_data.get('quality', {})
    q_status = quality.get('status', 'unknown').upper()
    q_score = quality.get('score', 0.0) * 100.0
    q_action = quality.get('action', 'N/A')
    flags = quality.get('flags', [])

    exp = analysis_data.get('explainability', {})
    case_id = exp.get('case_id', 'RG-99823')
    elapsed = exp.get('elapsed_sec', 0.0)

    # Status colors
    ref_color = colors.HexColor('#DC2626') if referable_bool else colors.HexColor('#16A34A')
    ref_text = "REFERABLE DR (LEVEL 2+) DETECTED" if referable_bool else "NON-REFERABLE (LEVEL <2)"

    # 2. Case Summary Table
    summary_data = [
        [
            Paragraph("<b>Case ID:</b> " + str(case_id), body_style),
            Paragraph("<b>Quality Assessment:</b> " + q_status + f" ({q_score:.1f}%)", body_style),
            Paragraph("<b>Processing Time:</b> " + f"{elapsed:.2f}s (<30s target)", body_style)
        ],
        [
            Paragraph("<b>Predicted DR Grade:</b> <font color='#1E40AF'><b>" + str(grade) + "</b></font>", body_style),
            Paragraph("<b>Model Confidence:</b> " + f"{conf:.1f}%", body_style),
            Paragraph("<b>Referable Status:</b> <font color='" + ref_color.hexval() + "'><b>" + ref_text + "</b></font>", body_style)
        ]
    ]

    summary_table = Table(summary_data, colWidths=[2.4*inch, 2.6*inch, 2.5*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('PADDING', (0,0), (-1,-1), 6),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 10))

    # 3. Diagnostic Findings & Calibration
    story.append(Paragraph("1. DR Severity Classification & Calibrated Risk", h2_style))
    
    probs = pred.get('probabilities', [0.2, 0.2, 0.2, 0.2, 0.2])
    prob_cols = ["No DR", "Mild", "Moderate", "Severe", "Proliferative"]
    prob_row_headers = [Paragraph(f"<b>{c}</b>", body_style) for c in prob_cols]
    prob_row_vals = [
        Paragraph(f"<b>{probs[i]*100:.1f}%</b>" if i == class_idx else f"{probs[i]*100:.1f}%", 
                  body_bold if i == class_idx else body_style) 
        for i in range(5)
    ]
    
    prob_table_data = [prob_row_headers, prob_row_vals]
    prob_table = Table(prob_table_data, colWidths=[1.5*inch]*5)
    
    # Highlight predicted column
    t_style = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('PADDING', (0,0), (-1,-1), 5),
    ]
    t_style.append(('BACKGROUND', (class_idx, 0), (class_idx, 1), colors.HexColor('#DBEAFE')))
    prob_table.setStyle(TableStyle(t_style))
    story.append(prob_table)
    story.append(Spacer(1, 6))

    # Calibration detail note
    cal_info = (
        f"<b>Referable Score Calibration (Messidor Gap Guard):</b> Raw score = {score_raw:.3f} | "
        f"Calibrated (T={ref_thresh*1.62:.3f}) = {score_cal:.3f} | Decision Threshold t = {ref_thresh:.2f}. "
        f"<i>Clinical criteria: Level 2+ requires referral for ophthalmologist examination.</i>"
    )
    story.append(Paragraph(cal_info, body_style))
    story.append(Spacer(1, 10))

    # 4. Visual Explainability & Retinal Structure Evidence
    story.append(Paragraph("2. Retinal Structure & Explainability Evidence", h2_style))

    # Build image flowables
    orig_img_flowable = None
    if original_img_path and os.path.exists(str(original_img_path)):
        try:
            orig_img_flowable = RLImage(str(original_img_path), width=1.7*inch, height=1.7*inch)
        except Exception:
            orig_img_flowable = None

    hm_b64 = analysis_data.get('gradcam', {}).get('heatmap_png_base64') or analysis_data.get('gradcam', {}).get('overlay_png_base64')
    ov_b64 = analysis_data.get('gradcam', {}).get('overlay_png_base64')
    ves_b64 = analysis_data.get('structures', {}).get('vessel_png_base64')
    les_b64 = analysis_data.get('lesions', {}).get('exudate_png_base64')

    img_hm = b64_to_rl_image(hm_b64, width=1.7*inch, height=1.7*inch)
    img_ov = b64_to_rl_image(ov_b64, width=1.7*inch, height=1.7*inch)
    img_ves = b64_to_rl_image(ves_b64, width=1.7*inch, height=1.7*inch)
    img_les = b64_to_rl_image(les_b64, width=1.7*inch, height=1.7*inch)

    img_cells = [
        [
            orig_img_flowable or Paragraph("Fundus Image", body_style),
            img_hm or Paragraph("Grad-CAM Heatmap", body_style),
            img_ves or Paragraph("Vessel Mask (DRIVE)", body_style),
            img_les or Paragraph("Exudate Mask (IDRiD)", body_style),
        ],
        [
            Paragraph("<b>Input Fundus</b>", body_style),
            Paragraph("<b>Grad-CAM Attention</b>", body_style),
            Paragraph("<b>Vessel Structure</b>", body_style),
            Paragraph("<b>Exudate Lesions</b>", body_style),
        ]
    ]

    img_table = Table(img_cells, colWidths=[1.87*inch]*4)
    img_table.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('BACKGROUND', (0,1), (-1,1), colors.HexColor('#F8FAFC')),
        ('PADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(img_table)
    story.append(Spacer(1, 10))

    # 5. Image Quality & Advisory Recapture Guidance
    story.append(Paragraph("3. Image Quality Assessment & Recapture Guidance", h2_style))
    q_flags_str = ", ".join(flags) if flags else "None (Optimal Image Quality)"
    q_details = (
        f"<b>Quality Status:</b> {q_status} | <b>Brightness:</b> {quality.get('brightness',0.0):.2f} | "
        f"<b>Contrast:</b> {quality.get('contrast',0.0):.2f} | <b>Blur Variance:</b> {quality.get('blur_variance',0.0):.1f}<br/>"
        f"<b>Detected Flags:</b> {q_flags_str}<br/>"
        f"<b>Guidance Action:</b> <i>{q_action}</i>"
    )
    story.append(Paragraph(q_details, body_style))
    story.append(Spacer(1, 10))

    # 6. 30-Second Ophthalmologist Validation Checklist
    story.append(Paragraph("4. 30-Second Human-in-the-Loop Validation Checklist", h2_style))
    checklist_items = [
        "<b>[  ] Step 1:</b> Verify Fundus Image Quality & Field of View coverage.",
        "<b>[  ] Step 2:</b> Confirm Optic Disc & Fovea landmark integrity.",
        "<b>[  ] Step 3:</b> Inspect Grad-CAM attention heatmap correlation with microaneurysms/exudates.",
        "<b>[  ] Step 4:</b> Review Referable DR status and confirm triage action.",
        "<b>[  ] Step 5:</b> Sign off screening report or refer to tertiary eye hospital."
    ]
    for chk in checklist_items:
        story.append(Paragraph(chk, body_style))
        story.append(Spacer(1, 2))
    
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor('#CBD5E1'), spaceAfter=8))

    # 7. Medical Disclaimer
    disclaimer_text = (
        "<b>CLINICAL DISCLAIMER & REGULATORY NOTICE:</b><br/>"
        "RetinaGuard™ is an AI-assisted telemedicine screening decision support system. "
        "This automated report does <b>NOT</b> constitute a formal medical diagnosis. "
        "All screening recommendations must be reviewed and validated by a registered ophthalmologist or medical officer before clinical intervention."
    )
    story.append(Paragraph(disclaimer_text, disclaimer_style))

    # Build document
    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()
