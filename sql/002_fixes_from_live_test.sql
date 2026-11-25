-- Applied 2026-11-25 after the live end-to-end test.
-- 1) Proof uploads: senior-media only allowed image/jpeg among images.
update storage.buckets set allowed_mime_types = (select array_agg(distinct t) from unnest(allowed_mime_types || array['image/png','image/webp','image/heic','image/heif','application/pdf']) t) where id = 'senior-media';
-- 2) admin_hub_draft_road: senior_roads.display_name is a generated column; stop inserting it.
--    (Full function body as applied lives in migration seniors_hub_draft_road_fix.)
