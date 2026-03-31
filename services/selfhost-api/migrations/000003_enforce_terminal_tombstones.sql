CREATE OR REPLACE FUNCTION prevent_tombstoned_channel_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM terminal_tombstones
    WHERE channel_id = NEW.uuid
  ) THEN
    RAISE EXCEPTION 'channel % is terminally tombstoned', NEW.uuid
      USING ERRCODE = '23000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channels_prevent_tombstone_write ON channels;

CREATE TRIGGER channels_prevent_tombstone_write
BEFORE INSERT OR UPDATE ON channels
FOR EACH ROW
EXECUTE FUNCTION prevent_tombstoned_channel_write();
