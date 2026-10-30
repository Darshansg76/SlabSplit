CREATE EXTENSION IF NOT EXISTS vector;
CREATE TYPE utility_type_t AS ENUM ('electricity','water','gas','internet','maintenance');
CREATE TYPE cycle_status_t AS ENUM ('open','billed','closed');
CREATE TYPE payment_mode_t AS ENUM ('upi','cash','bank_transfer','card');
CREATE TYPE settlement_status_t AS ENUM ('pending','settled','cancelled');
CREATE TYPE expense_category_t AS ENUM ('utility','rent','internet','maintenance','groceries','repair','other');
CREATE TYPE doc_source_t AS ENUM ('expense','receipt','settlement_note');

CREATE TABLE household (
  household_id BIGSERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NOT NULL, city VARCHAR(80) NOT NULL,
  total_rooms SMALLINT NOT NULL DEFAULT 1 CHECK (total_rooms BETWEEN 1 AND 50),
  currency CHAR(3) NOT NULL DEFAULT 'INR', created_on DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE occupant (
  occupant_id BIGSERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL,
  phone VARCHAR(20), email VARCHAR(160) UNIQUE, upi_id VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_occupant_email CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT chk_occupant_phone CHECK (phone IS NULL OR phone ~ '^[0-9+][0-9 \-]{6,19}$')
);
CREATE TABLE occupancy (
  occupancy_id BIGSERIAL PRIMARY KEY,
  household_id BIGINT NOT NULL REFERENCES household ON UPDATE CASCADE ON DELETE CASCADE,
  occupant_id BIGINT NOT NULL REFERENCES occupant ON UPDATE CASCADE ON DELETE CASCADE,
  move_in_date DATE NOT NULL, move_out_date DATE,
  rent_weight NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (rent_weight > 0), room_no VARCHAR(20),
  CONSTRAINT chk_occupancy_dates CHECK (move_out_date IS NULL OR move_out_date >= move_in_date),
  CONSTRAINT uq_occupancy UNIQUE (household_id, occupant_id, move_in_date)
);
CREATE TABLE bill_cycle (
  cycle_id BIGSERIAL PRIMARY KEY,
  household_id BIGINT NOT NULL REFERENCES household ON UPDATE CASCADE ON DELETE CASCADE,
  cycle_start DATE NOT NULL, cycle_end DATE NOT NULL,
  total_days INT GENERATED ALWAYS AS ((cycle_end - cycle_start) + 1) STORED,
  due_date DATE, status cycle_status_t NOT NULL DEFAULT 'open',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cycle_range CHECK (cycle_end >= cycle_start),
  CONSTRAINT uq_cycle UNIQUE (household_id, cycle_start, cycle_end)
);
CREATE TABLE slab_rate (
  slab_rate_id BIGSERIAL PRIMARY KEY,
  household_id BIGINT NOT NULL REFERENCES household ON UPDATE CASCADE ON DELETE CASCADE,
  utility_type utility_type_t NOT NULL, unit_from NUMERIC(10,2) NOT NULL CHECK (unit_from >= 0),
  unit_to NUMERIC(10,2), rate_per_unit NUMERIC(10,4) NOT NULL CHECK (rate_per_unit >= 0),
  fixed_charge NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (fixed_charge >= 0),
  effective_from DATE NOT NULL, effective_to DATE,
  CONSTRAINT chk_slab_bounds CHECK (unit_to IS NULL OR unit_to > unit_from),
  CONSTRAINT chk_slab_eff_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT uq_slab_start UNIQUE (household_id, utility_type, effective_from, unit_from)
);
CREATE TABLE bill (
  bill_id BIGSERIAL PRIMARY KEY, cycle_id BIGINT NOT NULL REFERENCES bill_cycle ON UPDATE CASCADE ON DELETE CASCADE,
  utility_type utility_type_t NOT NULL,
  prev_reading NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (prev_reading >= 0),
  curr_reading NUMERIC(12,2) NOT NULL CHECK (curr_reading >= prev_reading),
  units_consumed NUMERIC(12,2) GENERATED ALWAYS AS (curr_reading - prev_reading) STORED,
  energy_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (energy_charge >= 0),
  fixed_charge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fixed_charge >= 0),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  generated_on DATE NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT uq_bill UNIQUE (cycle_id, utility_type)
);
CREATE TABLE bill_slab_breakdown (
  breakdown_id BIGSERIAL PRIMARY KEY, bill_id BIGINT NOT NULL REFERENCES bill ON UPDATE CASCADE ON DELETE CASCADE,
  slab_rate_id BIGINT NOT NULL REFERENCES slab_rate ON UPDATE CASCADE ON DELETE RESTRICT,
  units_in_slab NUMERIC(12,2) NOT NULL CHECK (units_in_slab >= 0), amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  CONSTRAINT uq_bill_slab UNIQUE (bill_id, slab_rate_id)
);
-- Bill shares make the PDF's day-weighted utility split persistent and queryable.
CREATE TABLE bill_share (
  bill_id BIGINT NOT NULL REFERENCES bill ON DELETE CASCADE,
  occupant_id BIGINT NOT NULL REFERENCES occupant ON DELETE RESTRICT,
  days_applicable INT NOT NULL CHECK (days_applicable > 0),
  weight NUMERIC(12,2) NOT NULL CHECK (weight > 0),
  share_amount NUMERIC(12,2) NOT NULL CHECK (share_amount >= 0),
  PRIMARY KEY (bill_id, occupant_id)
);
CREATE TABLE expense (
  expense_id BIGSERIAL PRIMARY KEY,
  household_id BIGINT NOT NULL REFERENCES household ON UPDATE CASCADE ON DELETE CASCADE,
  cycle_id BIGINT REFERENCES bill_cycle ON UPDATE CASCADE ON DELETE SET NULL,
  paid_by_occupant_id BIGINT NOT NULL REFERENCES occupant ON UPDATE CASCADE ON DELETE RESTRICT,
  category expense_category_t NOT NULL DEFAULT 'other', description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE, is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(description,''))) STORED
);
CREATE TABLE expense_share (
  share_id BIGSERIAL PRIMARY KEY, expense_id BIGINT NOT NULL REFERENCES expense ON UPDATE CASCADE ON DELETE CASCADE,
  occupant_id BIGINT NOT NULL REFERENCES occupant ON UPDATE CASCADE ON DELETE CASCADE,
  share_weight NUMERIC(6,3) NOT NULL DEFAULT 1 CHECK (share_weight >= 0),
  share_amount NUMERIC(12,2) NOT NULL CHECK (share_amount >= 0),
  days_applicable INT NOT NULL DEFAULT 0 CHECK (days_applicable >= 0),
  CONSTRAINT uq_expense_share UNIQUE (expense_id, occupant_id)
);
CREATE TABLE payment (
  payment_id BIGSERIAL PRIMARY KEY,
  bill_id BIGINT REFERENCES bill ON UPDATE CASCADE ON DELETE SET NULL,
  expense_id BIGINT REFERENCES expense ON UPDATE CASCADE ON DELETE SET NULL,
  occupant_id BIGINT NOT NULL REFERENCES occupant ON UPDATE CASCADE ON DELETE RESTRICT,
  amount_paid NUMERIC(12,2) NOT NULL CHECK (amount_paid > 0),
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  mode payment_mode_t NOT NULL DEFAULT 'upi', reference_no VARCHAR(80),
  CONSTRAINT chk_payment_target CHECK (bill_id IS NOT NULL OR expense_id IS NOT NULL),
  CONSTRAINT chk_payment_one_target CHECK (NOT (bill_id IS NOT NULL AND expense_id IS NOT NULL))
);
CREATE TABLE settlement (
  settlement_id BIGSERIAL PRIMARY KEY, cycle_id BIGINT NOT NULL REFERENCES bill_cycle ON UPDATE CASCADE ON DELETE CASCADE,
  payer_occupant_id BIGINT NOT NULL REFERENCES occupant ON UPDATE CASCADE ON DELETE RESTRICT,
  payee_occupant_id BIGINT NOT NULL REFERENCES occupant ON UPDATE CASCADE ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status settlement_status_t NOT NULL DEFAULT 'pending', settled_on DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_settle_distinct CHECK (payer_occupant_id <> payee_occupant_id)
);
CREATE TABLE role (
  role_id SMALLSERIAL PRIMARY KEY, name VARCHAR(30) NOT NULL UNIQUE, description VARCHAR(160)
);
CREATE TABLE app_user (
  user_id BIGSERIAL PRIMARY KEY, occupant_id BIGINT UNIQUE REFERENCES occupant ON UPDATE CASCADE ON DELETE SET NULL,
  role_id SMALLINT NOT NULL REFERENCES role ON UPDATE CASCADE ON DELETE RESTRICT,
  username VARCHAR(60) NOT NULL UNIQUE, email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_user_hash_not_plain CHECK (char_length(password_hash) >= 20)
);
CREATE TABLE receipt (
  receipt_id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT REFERENCES expense ON UPDATE CASCADE ON DELETE CASCADE,
  bill_id BIGINT REFERENCES bill ON UPDATE CASCADE ON DELETE CASCADE,
  uploaded_by BIGINT REFERENCES app_user ON UPDATE CASCADE ON DELETE SET NULL,
  file_url VARCHAR(500) NOT NULL, ocr_text TEXT,
  uploaded_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_receipt_target CHECK (expense_id IS NOT NULL OR bill_id IS NOT NULL)
);
CREATE TABLE doc_embedding (
  embedding_id BIGSERIAL PRIMARY KEY, source_type doc_source_t NOT NULL,
  source_id BIGINT NOT NULL, content TEXT NOT NULL, embedding VECTOR(384) NOT NULL,
  model VARCHAR(60) NOT NULL DEFAULT 'all-MiniLM-L6-v2',
  created_on TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_doc_source UNIQUE (source_type, source_id)
);
CREATE TABLE audit_log (
  log_id BIGSERIAL PRIMARY KEY, app_user_id BIGINT REFERENCES app_user ON UPDATE CASCADE ON DELETE SET NULL,
  entity_name VARCHAR(40) NOT NULL, entity_id BIGINT,
  action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  details JSONB, changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_occupancy_dates ON occupancy(household_id, move_in_date, move_out_date);
CREATE INDEX idx_cycle_household ON bill_cycle(household_id, cycle_start DESC);
CREATE INDEX idx_slab_lookup ON slab_rate(household_id, utility_type, effective_from DESC, unit_from);
CREATE INDEX idx_expense_cycle ON expense(cycle_id, expense_date DESC);
CREATE INDEX idx_expense_search ON expense USING GIN(description_tsv);
CREATE INDEX idx_payment_bill ON payment(bill_id);
CREATE INDEX idx_settlement_cycle ON settlement(cycle_id, status);
CREATE INDEX idx_embedding_cosine ON doc_embedding USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION occupancy_days(p_occupancy occupancy, p_start DATE, p_end DATE)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(0, LEAST(COALESCE((p_occupancy).move_out_date,p_end),p_end) - GREATEST((p_occupancy).move_in_date,p_start) + 1)
$$;

CREATE OR REPLACE FUNCTION reject_occupancy_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM occupancy o WHERE o.household_id=NEW.household_id AND o.occupant_id=NEW.occupant_id
    AND o.occupancy_id<>COALESCE(NEW.occupancy_id,-1)
    AND daterange(o.move_in_date,COALESCE(o.move_out_date,'infinity'::date),'[]') &&
        daterange(NEW.move_in_date,COALESCE(NEW.move_out_date,'infinity'::date),'[]')) THEN
    RAISE EXCEPTION 'Occupancy periods overlap for this occupant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER occupancy_no_overlap BEFORE INSERT OR UPDATE ON occupancy
FOR EACH ROW EXECUTE FUNCTION reject_occupancy_overlap();

CREATE OR REPLACE FUNCTION audit_changes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_id BIGINT;
BEGIN
  changed_id := COALESCE((to_jsonb(NEW)->>TG_ARGV[0])::BIGINT,(to_jsonb(OLD)->>TG_ARGV[0])::BIGINT);
  INSERT INTO audit_log(app_user_id,entity_name,entity_id,action,details)
  VALUES (NULLIF(current_setting('app.user_id',true),'')::BIGINT,TG_TABLE_NAME,changed_id,TG_OP,
          jsonb_build_object('old',to_jsonb(OLD),'new',to_jsonb(NEW)));
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER audit_expense AFTER INSERT OR UPDATE OR DELETE ON expense FOR EACH ROW EXECUTE FUNCTION audit_changes('expense_id');
CREATE TRIGGER audit_payment AFTER INSERT OR UPDATE OR DELETE ON payment FOR EACH ROW EXECUTE FUNCTION audit_changes('payment_id');
CREATE TRIGGER audit_settlement AFTER INSERT OR UPDATE OR DELETE ON settlement FOR EACH ROW EXECUTE FUNCTION audit_changes('settlement_id');
CREATE TRIGGER audit_bill AFTER INSERT OR UPDATE OR DELETE ON bill FOR EACH ROW EXECUTE FUNCTION audit_changes('bill_id');

CREATE VIEW v_bill_summary AS
SELECT b.bill_id,b.cycle_id,b.utility_type,b.units_consumed,b.energy_charge,b.fixed_charge,b.total_amount,
  COALESCE((SELECT SUM(p.amount_paid) FROM payment p WHERE p.bill_id=b.bill_id),0) AS amount_paid,
  b.total_amount-COALESCE((SELECT SUM(p.amount_paid) FROM payment p WHERE p.bill_id=b.bill_id),0) AS amount_due
FROM bill b;
CREATE VIEW v_cycle_member_balance AS
SELECT c.cycle_id,o.occupant_id,o.name,
  COALESCE((SELECT SUM(bs.share_amount) FROM bill_share bs JOIN bill b ON b.bill_id=bs.bill_id WHERE b.cycle_id=c.cycle_id AND bs.occupant_id=o.occupant_id),0) +
  COALESCE((SELECT SUM(es.share_amount) FROM expense_share es JOIN expense e ON e.expense_id=es.expense_id WHERE e.cycle_id=c.cycle_id AND es.occupant_id=o.occupant_id),0) AS allocated,
  COALESCE((SELECT SUM(p.amount_paid) FROM payment p JOIN bill b ON b.bill_id=p.bill_id WHERE b.cycle_id=c.cycle_id AND p.occupant_id=o.occupant_id),0) +
  COALESCE((SELECT SUM(e.amount) FROM expense e WHERE e.cycle_id=c.cycle_id AND e.paid_by_occupant_id=o.occupant_id),0) +
  COALESCE((SELECT SUM(p.amount_paid) FROM payment p JOIN expense e ON e.expense_id=p.expense_id WHERE e.cycle_id=c.cycle_id AND p.occupant_id=o.occupant_id),0) -
  COALESCE((SELECT SUM(p.amount_paid) FROM payment p JOIN expense e ON e.expense_id=p.expense_id WHERE e.cycle_id=c.cycle_id AND e.paid_by_occupant_id=o.occupant_id),0) AS paid
FROM bill_cycle c JOIN occupancy oc ON oc.household_id=c.household_id
  AND occupancy_days(oc,c.cycle_start,c.cycle_end)>0
JOIN occupant o ON o.occupant_id=oc.occupant_id
GROUP BY c.cycle_id,o.occupant_id,o.name;

INSERT INTO role(name,description) VALUES
  ('admin','Manages households, bills and settlement generation'),
  ('member','Can view household records and record own bill payments');
