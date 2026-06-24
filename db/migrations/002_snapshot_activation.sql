CREATE OR REPLACE FUNCTION activate_snapshot(target_public_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  target_snapshot data_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO target_snapshot
  FROM data_snapshots
  WHERE public_id = target_public_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapshot % not found', target_public_id;
  END IF;

  IF target_snapshot.status NOT IN ('metrics_ready', 'routing_ready', 'imported', 'normalized') THEN
    RAISE EXCEPTION 'snapshot % cannot be activated from status %', target_public_id, target_snapshot.status;
  END IF;

  UPDATE data_snapshots
  SET is_active = false,
      status = CASE WHEN status = 'active' THEN 'archived'::snapshot_status ELSE status END
  WHERE is_active = true;

  UPDATE data_snapshots
  SET is_active = true,
      status = 'active',
      activated_at = now()
  WHERE public_id = target_public_id;
END;
$$;
