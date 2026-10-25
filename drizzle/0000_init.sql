CREATE TYPE "public"."generation_job_status" AS ENUM('queued', 'generating', 'generated', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."generation_run_status" AS ENUM('queued', 'running', 'completed', 'cancelled', 'stopped_cap', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lesson_standard_kind" AS ENUM('focus', 'supporting', 'media', 'eld');--> statement-breakpoint
CREATE TYPE "public"."lesson_status" AS ENUM('generating', 'draft', 'in_review', 'changes_requested', 'approved', 'failed');--> statement-breakpoint
CREATE TYPE "public"."standard_framework" AS ENUM('CCSS_ELA', 'CA_ELD', 'CA_SCHOOL_LIBRARY');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('author', 'reviewer', 'approver', 'admin');--> statement-breakpoint
CREATE TABLE "arcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"status" "generation_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"model" text NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"cap_usd" numeric(12, 6) NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"status" "generation_run_status" DEFAULT 'queued' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lesson_standards" (
	"lesson_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "lesson_standard_kind" NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "lesson_standards_lesson_id_kind_code_pk" PRIMARY KEY("lesson_id","kind","code")
);
--> statement-breakpoint
CREATE TABLE "lesson_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"content" jsonb NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"arc_id" uuid,
	"position" integer NOT NULL,
	"filename" text DEFAULT '' NOT NULL,
	"lesson_number" integer,
	"lesson_type" text DEFAULT '' NOT NULL,
	"days" numeric(4, 1) DEFAULT 1 NOT NULL,
	"text_dependent_question" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"text_set" text DEFAULT '' NOT NULL,
	"homework" text DEFAULT '' NOT NULL,
	"focus_standards" text DEFAULT '' NOT NULL,
	"supporting_standards" text DEFAULT '' NOT NULL,
	"media_literacy_standards" text DEFAULT '' NOT NULL,
	"performance_task_skill" text DEFAULT '' NOT NULL,
	"foundational_skills" text DEFAULT '' NOT NULL,
	"vocabulary" text DEFAULT '' NOT NULL,
	"eld_standards" text DEFAULT '' NOT NULL,
	"raw_row" jsonb NOT NULL,
	"is_flex" boolean DEFAULT false NOT NULL,
	"status" "lesson_status" DEFAULT 'draft' NOT NULL,
	"assignee_id" uuid,
	"content" jsonb,
	"last_edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standards" (
	"code" text PRIMARY KEY NOT NULL,
	"framework" "standard_framework" NOT NULL,
	"grade" integer NOT NULL,
	"strand" text NOT NULL,
	"text" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade" integer NOT NULL,
	"unit_number" integer NOT NULL,
	"anchor_text_title" text NOT NULL,
	"isbn" text,
	"banner" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"from_status" "lesson_status",
	"to_status" "lesson_status" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yjs_documents" (
	"name" text PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcs" ADD CONSTRAINT "arcs_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_run_id_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."generation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_standards" ADD CONSTRAINT "lesson_standards_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_arc_id_arcs_id_fk" FOREIGN KEY ("arc_id") REFERENCES "public"."arcs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arcs_unit_position_idx" ON "arcs" USING btree ("unit_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_run_lesson_idx" ON "generation_jobs" USING btree ("run_id","lesson_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_lesson_idx" ON "generation_jobs" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "generation_runs_unit_idx" ON "generation_runs" USING btree ("unit_id","created_at");--> statement-breakpoint
CREATE INDEX "lesson_standards_code_idx" ON "lesson_standards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "lesson_versions_lesson_idx" ON "lesson_versions" USING btree ("lesson_id","created_at");--> statement-breakpoint
CREATE INDEX "lessons_unit_position_idx" ON "lessons" USING btree ("unit_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_unit_number_idx" ON "lessons" USING btree ("unit_id","lesson_number") WHERE "lessons"."lesson_number" is not null;--> statement-breakpoint
CREATE INDEX "lessons_assignee_idx" ON "lessons" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_unit_version_idx" ON "prompt_versions" USING btree ("unit_id","version");--> statement-breakpoint
CREATE INDEX "workflow_events_lesson_idx" ON "workflow_events" USING btree ("lesson_id","at");