ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status IN (
    'new', 'contacted', 'in_progress', 'published', 'not_relevant',
    'no_show', 'arrived', 'quote_sent', 'quote_followup', 'closed', 'lost'
  )
);
