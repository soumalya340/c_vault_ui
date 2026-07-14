-- Allow localhost as a network tag alongside mainnet (devnet remains in the
-- enum for any historical rows; the UI no longer writes or selects it).
do $$ begin
  alter type network_type add value if not exists 'localhost';
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
