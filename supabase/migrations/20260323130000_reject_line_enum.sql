-- Add rejected line-approval status (must commit before use)
do $$ begin
  alter type public.shamsy_line_approval add value if not exists 'rejected';
exception
  when duplicate_object then null;
  when others then
    begin
      alter type public.shamsy_line_approval add value 'rejected';
    exception when duplicate_object then null;
    end;
end $$;
