-- Size limits on fields the app fills in.
--
-- Anonymous sign-in means anyone with the page can write rows. Without limits, one insert
-- could store a 10 MB string or a number with 100,000 digits, and about 50 of those fill
-- the free plan's 500 MB. With these limits a row stays a few hundred bytes.
--
-- The values are generous next to what form.js produces (angles to 0.1°, ratios to 0.001).
-- scale() caps digits after the decimal point; the upper bounds cap digits before it.

alter table public.workouts
  add constraint workouts_app_version_length check (char_length(app_version) <= 40),
  add constraint workouts_rules_version_length check (char_length(rules_version) <= 40);

alter table public.sets
  add constraint sets_set_number_max check (set_number <= 100),
  add constraint sets_counted_reps_max check (counted_reps <= 1000),
  add constraint sets_actual_reps_max check (actual_reps <= 1000),
  add constraint sets_avg_fps_size check (avg_fps <= 1000 and scale(avg_fps) <= 3),
  add constraint sets_visible_frame_ratio_size check (scale(visible_frame_ratio) <= 6);

alter table public.reps
  add constraint reps_rep_number_max check (rep_number <= 1000),
  add constraint reps_duration_max check (duration_ms <= 600000), -- 10 minutes
  add constraint reps_min_knee_angle_size check (scale(min_knee_angle) <= 3),
  add constraint reps_max_torso_lean_size check (scale(max_torso_lean) <= 3),
  add constraint reps_max_heel_lift_size check (max_heel_lift <= 10 and scale(max_heel_lift) <= 6);
