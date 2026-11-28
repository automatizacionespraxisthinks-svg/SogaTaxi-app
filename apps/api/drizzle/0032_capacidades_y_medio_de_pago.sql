ALTER TABLE "drivers" ADD COLUMN "capacidades" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "medio_pago" text DEFAULT 'efectivo' NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "servicio" text;--> statement-breakpoint
-- Las carreras de antes solo decían «pago electrónico»: quedan con el medio sin especificar.
UPDATE "rides" SET "medio_pago" = 'electronico' WHERE "pago_electronico";
