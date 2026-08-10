ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'payment_pending';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'payment_submitted';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'payment_verified';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'out_for_delivery';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'completed';

DO $$ BEGIN
  CREATE TYPE public.payment_verification_status AS ENUM ('submitted','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;