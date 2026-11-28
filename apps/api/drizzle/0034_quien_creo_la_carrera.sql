ALTER TABLE "rides" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rides_created_by_idx" ON "rides" USING btree ("created_by","created_at") WHERE "rides"."created_by" is not null;--> statement-breakpoint
-- Las carreras que la oficina ya había registrado: su primer paso en el
-- historial dice qué usuario la creó. Las de WhatsApp quedan en nulo.
UPDATE "rides" r
   SET "created_by" = h."actor_id"
  FROM "ride_status_history" h
  JOIN "users" u ON u."id" = h."actor_id"
 WHERE h."ride_id" = r."id"
   AND h."from_status" IS NULL
   AND h."actor" = 'operator'
   AND r."created_by" IS NULL;
