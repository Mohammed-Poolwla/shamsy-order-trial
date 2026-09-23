-- Step A: add draft enum value (must commit before use)
do $$ begin
  alter type public.shamsy_order_status add value if not exists 'draft';
exception
  when duplicate_object then null;
  when others then
    begin
      alter type public.shamsy_order_status add value 'draft';
    exception when duplicate_object then null;
    end;
end $$;
