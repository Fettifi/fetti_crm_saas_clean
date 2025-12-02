-- 6. Secure Portal Access
alter table leads 
add column if not exists access_code text,
add column if not exists access_code_expires_at timestamp with time zone;
