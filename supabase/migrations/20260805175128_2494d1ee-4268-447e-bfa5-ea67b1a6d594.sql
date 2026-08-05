ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'pending_client';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'client_approved';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'client_rejected';