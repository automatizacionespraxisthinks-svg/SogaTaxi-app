CREATE TABLE "fleet_rules" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"bloquear_por_documentos" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
