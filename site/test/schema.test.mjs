// Row level security and size limits, with two real users and real rows.
// Applies supabase/migrations to an in-memory Postgres (PGlite) with Supabase's auth pieces
// stubbed: the anon and authenticated roles, auth.users and auth.uid().
// Run: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const db = new PGlite();
let workoutA, setA, repA;

/** Runs sql as a role, signed in as uid (or signed out). Returns the result or the error. */
async function as(role, uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try {
    return await db.query(sql);
  } catch (err) {
    return { error: err.message };
  } finally {
    await db.exec("reset role");
  }
}
const asA = (sql) => as("authenticated", A, sql);
const asB = (sql) => as("authenticated", B, sql);

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  for (const file of readdirSync(MIGRATIONS).sort()) await db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);

  workoutA = (await asA(`insert into workouts (app_version, rules_version) values ('1', 'v1-guess') returning id`)).rows[0].id;
  setA = (await asA(`insert into sets (workout_id, exercise_slug, set_number, counted_reps, avg_fps, visible_frame_ratio)
    values ('${workoutA}', 'squat', 1, 1, 24.5, 0.987) returning id`)).rows[0].id;
  repA = (await asA(`insert into reps (set_id, rep_number, duration_ms, min_knee_angle, max_torso_lean, max_heel_lift, depth_ok, torso_ok, heels_ok)
    values ('${setA}', 1, 1450, 84.3, 38.2, 0.012, true, true, true) returning id`)).rows[0].id;
});

test("a user reads their own rows and stats", async () => {
  assert.equal((await asA(`select * from workouts`)).rows.length, 1);
  assert.equal((await asA(`select * from daily_stats`)).rows[0].reps, 1);
});

test("another user can't read, change or delete them", async () => {
  for (const table of ["workouts", "sets", "reps", "check_metrics", "set_accuracy", "daily_stats"]) {
    assert.equal((await asB(`select * from ${table}`)).rows.length, 0, table);
  }
  assert.equal((await asB(`update reps set depth_ok = false where id = ${repA}`)).affectedRows, 0);
  assert.equal((await asB(`delete from workouts where id = '${workoutA}'`)).affectedRows, 0);
});

test("another user can't attach rows to them or write as them", async () => {
  assert.ok((await asB(`insert into sets (workout_id, exercise_slug, set_number) values ('${workoutA}', 'squat', 2)`)).error);
  assert.ok((await asB(`insert into workouts (user_id, app_version, rules_version) values ('${A}', '1', 'x')`)).error);
  assert.ok((await asB(`insert into rep_labels (rep_id, depth_ok) values (${repA}, false)`)).error);
  await asB(`insert into workouts (app_version, rules_version) values ('1', 'x')`);
  const moved = await asB(`update workouts set user_id = '${A}'`);
  assert.ok(moved.error || moved.affectedRows === 0);
});

test("signed-out visitors see only the exercise catalog, and nobody writes it", async () => {
  assert.equal((await as("anon", null, `select * from workouts`)).rows?.length ?? 0, 0);
  assert.equal((await as("anon", null, `select * from exercises`)).rows.length, 1);
  assert.ok((await asA(`insert into exercises values ('deadlift', 'Deadlift', 'side')`)).error);
});

test("oversized values are refused", async () => {
  const huge = `('1' || repeat('0', 100000))::numeric`;
  const refused = {
    "10 MB rules_version": `insert into workouts (app_version, rules_version) values ('1', repeat('x', 10000000))`,
    "10 MB app_version": `insert into workouts (app_version, rules_version) values (repeat('x', 10000000), 'v')`,
    "100k-digit fps": `insert into sets (workout_id, exercise_slug, set_number, avg_fps) values ('${workoutA}', 'squat', 3, ${huge})`,
    "16k-decimal knee angle": `insert into reps (set_id, rep_number, duration_ms, depth_ok, torso_ok, heels_ok, min_knee_angle)
      values ('${setA}', 3, 900, true, true, true, ('90.' || repeat('1', 16000))::numeric)`,
    "100k-digit heel lift": `insert into reps (set_id, rep_number, duration_ms, depth_ok, torso_ok, heels_ok, max_heel_lift)
      values ('${setA}', 2, 900, true, true, true, ${huge})`,
    "set 2 billion": `insert into sets (workout_id, exercise_slug, set_number) values ('${workoutA}', 'squat', 2000000000)`,
    "rep 2 billion": `insert into reps (set_id, rep_number, duration_ms, depth_ok, torso_ok, heels_ok) values ('${setA}', 2000000000, 900, true, true, true)`,
  };
  for (const [name, sql] of Object.entries(refused)) assert.ok((await asA(sql)).error, name);
});
