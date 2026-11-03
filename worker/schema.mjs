// PostgreSQL schema. Runtime bootstrap is idempotent; no destructive reset/drop.
export const schema=[
`CREATE TABLE IF NOT EXISTS cb_facility_profiles (scope_id uuid NOT NULL,facility text NOT NULL,body jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(scope_id,facility))`,
`CREATE TABLE IF NOT EXISTS cb_patient_registers (
 id uuid PRIMARY KEY, access_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
)`,
`CREATE TABLE IF NOT EXISTS cb_patients (
 id uuid PRIMARY KEY, register_id uuid NOT NULL REFERENCES cb_patient_registers(id),
 number text NOT NULL, name text NOT NULL, age_group text NOT NULL, contact text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(register_id,number)
)`,
`CREATE TABLE IF NOT EXISTS cb_cases (
 id uuid PRIMARY KEY, state jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid, lease_until timestamptz,
 CHECK (revision >= 0), CHECK ((state->>'version')::int = 1)
)`,
`CREATE TABLE IF NOT EXISTS cb_access (
 case_id uuid NOT NULL REFERENCES cb_cases(id), token_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('hospital','patient','facility')),
 facility text NOT NULL DEFAULT '', PRIMARY KEY(case_id,token_hash),
 CHECK ((role='facility' AND facility IN ('saebom','solbit','daon','bom','haeon')) OR (role!='facility' AND facility=''))
)`,
`CREATE TABLE IF NOT EXISTS cb_events (
 case_id uuid NOT NULL REFERENCES cb_cases(id), revision integer NOT NULL,
 event_index integer NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(case_id,revision,event_index)
)`,
`CREATE TABLE IF NOT EXISTS cb_inquiries (
 case_id uuid NOT NULL REFERENCES cb_cases(id), round integer NOT NULL,
 facility text NOT NULL, status text NOT NULL, response jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(case_id,round,facility)
)`,
`CREATE TABLE IF NOT EXISTS cb_consents (
 case_id uuid NOT NULL REFERENCES cb_cases(id), revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('inquiry','selected-facility')), granted boolean NOT NULL,
 facility text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(case_id,revision,kind)
)`,
`CREATE TABLE IF NOT EXISTS cb_requests (
 case_id uuid NOT NULL REFERENCES cb_cases(id), request_id uuid NOT NULL,
 revision integer NOT NULL, PRIMARY KEY(case_id,request_id)
)`,
`ALTER TABLE cb_cases ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES cb_patient_registers(id)`,
`ALTER TABLE cb_cases ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES cb_patients(id)`,
`CREATE INDEX IF NOT EXISTS cb_patients_register_idx ON cb_patients(register_id)`,
`CREATE INDEX IF NOT EXISTS cb_cases_patient_idx ON cb_cases(register_id,patient_id)`
];
