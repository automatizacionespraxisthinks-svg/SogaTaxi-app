CREATE TABLE "campos_extra" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entidad" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text DEFAULT 'texto' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "extra" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "extra" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "campos_extra_nombre_key" ON "campos_extra" USING btree ("entidad","nombre");