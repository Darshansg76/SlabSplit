// New application SELECTs over existing objects; no view or trigger is changed.
export const outstandingBalancesSql=`
  SELECT b.*,b.allocated-b.paid AS original_balance,
    COALESCE(outgoing.amount,0) AS settled_outgoing,COALESCE(incoming.amount,0) AS settled_incoming,
    b.allocated-b.paid-COALESCE(outgoing.amount,0)+COALESCE(incoming.amount,0) AS outstanding
  FROM v_cycle_member_balance b
  LEFT JOIN (SELECT payer_occupant_id,SUM(amount) AS amount FROM settlement
    WHERE cycle_id=$1 AND status='settled' GROUP BY payer_occupant_id) outgoing ON outgoing.payer_occupant_id=b.occupant_id
  LEFT JOIN (SELECT payee_occupant_id,SUM(amount) AS amount FROM settlement
    WHERE cycle_id=$1 AND status='settled' GROUP BY payee_occupant_id) incoming ON incoming.payee_occupant_id=b.occupant_id
  WHERE b.cycle_id=$1 ORDER BY b.name`;

export const auditHistorySql=`
  WITH events AS (
    SELECT a.*,COALESCE(NULLIF(details->'new','null'::JSONB),NULLIF(details->'old','null'::JSONB),'{}'::JSONB) AS record
    FROM audit_log a WHERE entity_name IN ('bill','expense','payment','settlement')
  ), bill_context AS (
    SELECT bill_id,cycle_id FROM bill
    UNION ALL
    SELECT DISTINCT ON (entity_id) entity_id,(record->>'cycle_id')::BIGINT FROM events e
      WHERE entity_name='bill' AND NOT EXISTS(SELECT 1 FROM bill b WHERE b.bill_id=e.entity_id)
      ORDER BY 1
  ), expense_context AS (
    SELECT expense_id,household_id,cycle_id FROM expense
    UNION ALL
    SELECT DISTINCT ON (entity_id) entity_id,(record->>'household_id')::BIGINT,(record->>'cycle_id')::BIGINT FROM events e
      WHERE entity_name='expense' AND NOT EXISTS(SELECT 1 FROM expense x WHERE x.expense_id=e.entity_id)
      ORDER BY 1
  ), contextual AS (
    SELECT e.*,
      CASE WHEN entity_name='expense' THEN (record->>'household_id')::BIGINT
        ELSE COALESCE(c.household_id,ec.household_id) END AS household_id,
      COALESCE((record->>'cycle_id')::BIGINT,bc.cycle_id,ec.cycle_id) AS cycle_id
    FROM events e
    LEFT JOIN bill_context bc ON e.entity_name='payment' AND bc.bill_id=(record->>'bill_id')::BIGINT
    LEFT JOIN expense_context ec ON e.entity_name='payment' AND ec.expense_id=(record->>'expense_id')::BIGINT
    LEFT JOIN bill_cycle c ON c.cycle_id=COALESCE((record->>'cycle_id')::BIGINT,bc.cycle_id)
  ) SELECT a.log_id,a.app_user_id,a.entity_name,a.entity_id,a.action,a.details,a.changed_at,u.username AS actor
    FROM contextual a LEFT JOIN app_user u ON u.user_id=a.app_user_id
    WHERE a.household_id=$1 AND ($2::BIGINT IS NULL OR a.cycle_id=$2)
    ORDER BY a.changed_at DESC,a.log_id DESC LIMIT 100`;
