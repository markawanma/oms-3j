-- 0059_clip_brief_type_guard.sql
-- Two gaps the code review found between the approved design and what 0057/0058
-- actually shipped.
--
-- 1. design §2.2 specified a CHECK tying clip_brief to clip-type artifacts;
--    0057 shipped only the jsonb-shape CHECK, so a shooting brief could be
--    written onto (say) a broadcast script. lib/marketing/clip-brief.ts already
--    documents this rule as if the DB enforced it — make that true rather than
--    downgrading the comment, since the app only ever mounts the brief editor
--    for clip artifacts anyway.
-- 2. 0058 added campaign_step.origin defaulting to 'template' and asserted
--    existing rows "are template" — true on this database (verified: the only
--    pre-existing steps are the 9.9 campaign's), but not guaranteed on any
--    environment where a manual task was created in the window between 0057
--    and 0058. Backfill is idempotent and a no-op here.

update analytics.campaign_step cs
set origin = 'manual'
from analytics.campaign cp
where cp.id = cs.campaign_id
  and cp.trigger_kind = 'manual'
  and cs.origin = 'template';

alter table analytics.step_artifact drop constraint if exists step_artifact_clip_brief_type_check;
alter table analytics.step_artifact add constraint step_artifact_clip_brief_type_check
  check (clip_brief is null or artifact_type in ('short_form_clip', 'live_highlight_clip'));

notify pgrst, 'reload schema';
