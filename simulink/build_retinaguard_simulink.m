% Build RetinaGuard telemedicine queue model (requires Simulink; SimEvents optional).
% Blocks: Source -> Queue -> AI server (3s) -> Reviewer pool (30s, R reviewers) -> Sink.
% Run: params; build_retinaguard_simulink; sim('retinaguard_screening');
mdl = 'retinaguard_screening';
if bdIsLoaded(mdl), close_system(mdl, 0); end
if exist([mdl '.slx'], 'file'), delete([mdl '.slx']); end
new_system(mdl); open_system(mdl);
params;
arr_per_hr = annual / 300 / work_hrs;
add_block('simulink/Sources/In1', [mdl '/Arrival']);
add_block('simulink/Discrete/Unit Delay', [mdl '/Queue']);
add_block('simulink/Continuous/Transport Delay', [mdl '/AI_3s']);
add_block('simulink/Continuous/Transport Delay', [mdl '/Review_30s']);
add_block('simulink/Sinks/Out1', [mdl '/Sink']);
add_block('simulink/Sinks/Display', [mdl '/Utilization']);
add_line(mdl, 'Arrival/1', 'Queue/1');
add_line(mdl, 'Queue/1', 'AI_3s/1');
add_line(mdl, 'AI_3s/1', 'Review_30s/1');
add_line(mdl, 'Review_30s/1', 'Sink/1');
set_param([mdl '/AI_3s'], 'TimeDelay', num2str(ai_sec));
set_param([mdl '/Review_30s'], 'TimeDelay', num2str(review_sec));
save_system(mdl); % saves retinaguard_screening.slx
disp(['Built ' mdl '.slx | arrival/hr ' num2str(arr_per_hr) ' | set reviewers via Review_30s replication']);
