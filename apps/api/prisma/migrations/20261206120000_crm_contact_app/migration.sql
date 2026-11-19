-- A contact made through the customer app's chat. Additive.
ALTER TYPE "CrmContactChannel" ADD VALUE IF NOT EXISTS 'APP';
