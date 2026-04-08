UPDATE channels
SET file_ref = jsonb_set(file_ref, '{storageBackend}', '"s3"')
WHERE file_ref IS NOT NULL
  AND file_ref ->> 'storageBackend' = 'minio';
