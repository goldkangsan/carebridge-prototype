-- PostgreSQL schema generated from worker/schema.mjs. All statements are non-destructive.

CREATE TABLE IF NOT EXISTS cb_cases (
 id uuid PRIMARY KEY, state jsonb NOT NULL, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid, lease_until timestamptz,
 CHECK (revision >= 0), CHECK ((state->>'version')::int = 1)
);

CREATE TABLE IF NOT EXISTS cb_access (
 case_id uuid NOT NULL REFERENCES cb_cases(id), token_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('hospital','patient','facility')),
 facility text NOT NULL DEFAULT '', PRIMARY KEY(case_id,token_hash),
 CHECK ((role='facility' AND facility IN ('saebom','solbit','daon','bom','haeon')) OR (role!='facility' AND facility=''))
);

CREATE TABLE IF NOT EXISTS cb_events (
 case_id uuid NOT NULL REFERENCES cb_cases(id), revision integer NOT NULL,
 event_index integer NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(case_id,revision,event_index)
);

CREATE TABLE IF NOT EXISTS cb_inquiries (
 case_id uuid NOT NULL REFERENCES cb_cases(id), round integer NOT NULL,
 facility text NOT NULL, status text NOT NULL, response jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(case_id,round,facility)
);

CREATE TABLE IF NOT EXISTS cb_consents (
 case_id uuid NOT NULL REFERENCES cb_cases(id), revision integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('inquiry','selected-facility')), granted boolean NOT NULL,
 facility text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(case_id,revision,kind)
);

CREATE TABLE IF NOT EXISTS cb_requests (
 case_id uuid NOT NULL REFERENCES cb_cases(id), request_id uuid NOT NULL,
 revision integer NOT NULL, PRIMARY KEY(case_id,request_id)
);
