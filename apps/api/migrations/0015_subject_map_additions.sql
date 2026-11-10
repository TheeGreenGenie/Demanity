-- Draft subject map additions after the first live check (2026-11-10).
-- Example fixed: "Studenttransfer; tribalcolleges" mapped to Native Americans
-- because no education keyword matched. REVIEW BEFORE RELEASE.
INSERT INTO subject_category_map (keyword, category_slug) VALUES
  ('student', 'education'),
  ('college', 'education'),
  ('universit', 'education'),
  ('electric', 'energy')
ON CONFLICT (keyword) DO NOTHING;
