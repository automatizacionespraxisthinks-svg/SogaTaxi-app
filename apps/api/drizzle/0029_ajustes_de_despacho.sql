CREATE TABLE "dispatch_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"rondas" jsonb NOT NULL,
	"lejanos_candidatos" integer NOT NULL,
	"lejanos_km" double precision NOT NULL,
	"lejanos_margen_km" double precision DEFAULT 1 NOT NULL,
	"posicion_maxima_min" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
