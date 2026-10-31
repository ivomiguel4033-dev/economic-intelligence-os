CREATE OR REPLACE FUNCTION enforce_execution_run_state_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  IF (OLD.state = 'pending' AND NEW.state = 'running')
     OR (OLD.state = 'running' AND NEW.state IN ('succeeded','failed','uncertain'))
     OR (OLD.state = 'uncertain' AND NEW.state IN ('succeeded','failed'))
     OR (OLD.state = 'failed' AND NEW.state = 'dead_lettered') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid execution state transition: % -> %', OLD.state, NEW.state
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS execution_run_state_transition_guard ON execution_runs;
CREATE TRIGGER execution_run_state_transition_guard
BEFORE UPDATE OF state ON execution_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_execution_run_state_transition();
