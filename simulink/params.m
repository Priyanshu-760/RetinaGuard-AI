% RetinaGuard district screening parameters (frozen from Colab J1-J3).
% Annual target 100k patients; AI 3s/image; full review 30s; recapture 25%.
annual = 100000; camp_days = [100 300]; work_hrs = 8;
ai_sec = 3; review_sec = 30; rework = 1.25;
reviewers = [1 2 3]; bandwidth_mbps = [2 5 20]; img_MB = 2;
% Bottleneck result: 100 camps R1 util 1.30 FAIL, R2 0.65 PASS, 300 camps R1 0.43 PASS.
