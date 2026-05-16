-- Messages table for internal team communication
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  sender_id   uuid not null references profiles(id) on delete cascade,
  receiver_id uuid not null references profiles(id) on delete cascade,
  content     text not null,
  read_at     timestamptz
);

-- Index for fast conversation lookup
create index if not exists messages_sender_id_idx   on messages(sender_id);
create index if not exists messages_receiver_id_idx on messages(receiver_id);
create index if not exists messages_created_at_idx  on messages(created_at);

-- Row Level Security
alter table messages enable row level security;

-- Users can read messages they sent or received
create policy "users can read own messages"
  on messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- Users can only send messages as themselves
create policy "users can send messages"
  on messages for insert
  with check (auth.uid() = sender_id);

-- Users can mark received messages as read
create policy "users can mark messages read"
  on messages for update
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

-- Enable Realtime for this table
alter publication supabase_realtime add table messages;
