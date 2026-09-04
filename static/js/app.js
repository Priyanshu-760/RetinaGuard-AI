document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const previewArea = document.getElementById('previewArea');
    const imagePreview = document.getElementById('imagePreview');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resetBtn = document.getElementById('resetBtn');

    const uploadSection = document.getElementById('uploadSection');
    const loadingState = document.getElementById('loadingState');
    const scanningImage = document.getElementById('scanningImage');
    const resultsDashboard = document.getElementById('resultsDashboard');

    let currentFile = null;

    // --- Drag and Drop Logic --- //
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    }, false);

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', function () {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        if (files.length > 0) {
            const file = files[0];
            const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];

            if (!validTypes.includes(file.type)) {
                alert('Please upload a valid JPEG or PNG image.');
                return;
            }

            currentFile = file;

            // Show preview
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
                scanningImage.src = e.target.result; // For scanner
                dropZone.classList.add('hidden');
                previewArea.classList.remove('hidden');
            }
            reader.readAsDataURL(file);
        }
    }

    resetBtn.addEventListener('click', () => {
        currentFile = null;
        fileInput.value = '';
        previewArea.classList.add('hidden');
        dropZone.classList.remove('hidden');
    });

    // --- Analysis Logic --- //
    analyzeBtn.addEventListener('click', async () => {
        if (!currentFile) return;

        // UI state change to loading
        uploadSection.classList.add('hidden');
        loadingState.classList.remove('hidden');

        const formData = new FormData();
        formData.append('image', currentFile);

        try {
            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to analyze image');
            }

            renderResults(data);

        } catch (error) {
            alert('Error: ' + error.message);
            // Revert state on error
            loadingState.classList.add('hidden');
            uploadSection.classList.remove('hidden');
        }
    });

    function renderResults(data) {
        loadingState.classList.add('hidden');
        resultsDashboard.classList.remove('hidden');

        // 1. Result Main Banner
        const { grade, confidence, probabilities } = data.prediction;
        const gradeBadge = document.getElementById('gradeBadge');
        gradeBadge.textContent = grade;
        // Strip out spaces/special chars for class mapping
        const safeGradeClass = grade.replace(' ', '');
        gradeBadge.className = `grade-badge grade-${safeGradeClass}`;

        document.getElementById('confidenceValue').textContent = `${(confidence * 100).toFixed(1)}%`;

        // Set circular gradient dynamically based on confidence
        const confCircle = document.getElementById('confidenceCircle');
        const deg = (confidence * 360).toFixed(0);
        confCircle.style.background = `conic-gradient(var(--primary) ${deg}deg, rgba(255,255,255,0.1) ${deg}deg)`;

        // 2. Probability Bars
        const classNames = data.model.classes || ['No DR', 'Mild', 'Moderate', 'Severe', 'Proliferative'];
        const probContainer = document.getElementById('probabilityBars');
        probContainer.innerHTML = '';

        probabilities.forEach((prob, idx) => {
            const pct = (prob * 100).toFixed(1);

            const item = document.createElement('div');
            item.className = 'prob-item';
            item.innerHTML = `
                <div class="prob-header">
                    <span>${classNames[idx]}</span>
                    <span>${pct}%</span>
                </div>
                <div class="prob-track">
                    <div class="prob-fill" style="width: 0%"></div>
                </div>
            `;
            probContainer.appendChild(item);

            // Animate width
            setTimeout(() => {
                item.querySelector('.prob-fill').style.width = `${pct}%`;
                // Color scale for risk
                const hue = 200 - (classNames.indexOf(classNames[idx]) * 50);
                item.querySelector('.prob-fill').style.backgroundColor = `hsl(${Math.max(0, hue)}, 90%, 50%)`;
            }, 100);
        });

        // 3. Quality Metrics
        const q = data.quality;
        const qBadge = document.getElementById('qualityStatus');
        qBadge.textContent = q.status.charAt(0).toUpperCase() + q.status.slice(1);
        qBadge.className = `status-badge status-${q.status}`;

        document.getElementById('qualityScoreVal').textContent = `${(q.score * 100).toFixed(0)}%`;
        document.getElementById('qualityScoreFill').style.width = `${q.score * 100}%`;

        document.getElementById('brightnessVal').textContent = q.brightness.toFixed(2);
        document.getElementById('brightnessFill').style.width = `${Math.min(q.brightness * 100, 100)}%`;

        document.getElementById('contrastVal').textContent = q.contrast.toFixed(2);
        document.getElementById('contrastFill').style.width = `${Math.min(q.contrast * 100, 100)}%`;

        // Quality Flags
        const flagsCont = document.getElementById('qualityFlags');
        flagsCont.innerHTML = '';
        if (q.flags && q.flags.length > 0) {
            q.flags.forEach(flag => {
                const f = document.createElement('span');
                f.className = 'flag-tag';
                f.textContent = flag.replace(/_/g, ' ');
                flagsCont.appendChild(f);
            });
        }
    }
});
