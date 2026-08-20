CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'generate-payment-reminders-daily',
  '30 3 * * *',
  $$SELECT public.generate_payment_reminders();$$
);