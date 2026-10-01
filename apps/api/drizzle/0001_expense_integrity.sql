-- Cross-row rules for expenses, checked at COMMIT (deferred) so a transaction can
-- insert/replace an expense and its payers/splits in any order:
--   * payers sum to the expense total, and there is at least one payer
--   * splits (owed_minor) sum to the expense total, and there is at least one split
--   * every payer and split member belongs to the expense's group
-- The application validates the same rules first (packages/shared); this is the safety net.

CREATE FUNCTION check_expense_integrity(p_expense_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_total bigint;
  v_group uuid;
  v_paid bigint;
  v_owed bigint;
BEGIN
  SELECT amount_minor, group_id INTO v_total, v_group FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT sum(paid_minor) INTO v_paid FROM expense_payers WHERE expense_id = p_expense_id;
  IF v_paid IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'expense %: payers sum to %, expected %', p_expense_id, coalesce(v_paid, 0), v_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'expense_payers_sum';
  END IF;

  SELECT sum(owed_minor) INTO v_owed FROM expense_splits WHERE expense_id = p_expense_id;
  IF v_owed IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'expense %: splits sum to %, expected %', p_expense_id, coalesce(v_owed, 0), v_total
      USING ERRCODE = 'check_violation', CONSTRAINT = 'expense_splits_sum';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT member_id FROM expense_payers WHERE expense_id = p_expense_id
      UNION ALL
      SELECT member_id FROM expense_splits WHERE expense_id = p_expense_id
    ) m
    JOIN group_members gm ON gm.id = m.member_id
    WHERE gm.group_id <> v_group
  ) THEN
    RAISE EXCEPTION 'expense %: payer or split member is not in the expense''s group', p_expense_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'expense_members_in_group';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION trg_expense_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    PERFORM check_expense_integrity(NEW.id);
  ELSE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      PERFORM check_expense_integrity(NEW.expense_id);
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM check_expense_integrity(OLD.expense_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER expenses_integrity
  AFTER INSERT OR UPDATE OF amount_minor, group_id ON expenses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_expense_integrity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER expense_payers_integrity
  AFTER INSERT OR UPDATE OR DELETE ON expense_payers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_expense_integrity();
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER expense_splits_integrity
  AFTER INSERT OR UPDATE OR DELETE ON expense_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_expense_integrity();
