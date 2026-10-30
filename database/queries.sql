-- JOIN and GROUP BY: total bill, paid amount, and balance per cycle.
SELECT c.cycle_id,c.cycle_start,c.cycle_end,
       SUM(b.total_amount) AS billed,
       SUM(v.amount_paid) AS paid,
       SUM(v.amount_due) AS due
FROM bill_cycle c
JOIN bill b USING(cycle_id)
JOIN v_bill_summary v USING(bill_id)
GROUP BY c.cycle_id,c.cycle_start,c.cycle_end
ORDER BY c.cycle_start DESC;

-- HAVING: households with at least two occupants during a cycle.
SELECT h.name,c.cycle_id,COUNT(DISTINCT oc.occupant_id) AS active_occupants
FROM household h JOIN bill_cycle c USING(household_id)
JOIN occupancy oc ON oc.household_id=h.household_id
  AND occupancy_days(oc,c.cycle_start,c.cycle_end)>0
GROUP BY h.name,c.cycle_id
HAVING COUNT(DISTINCT oc.occupant_id)>=2
ORDER BY active_occupants DESC;

-- Subquery and aggregate: expenses above their household average.
SELECT e.expense_id,e.description,e.amount
FROM expense e
WHERE e.amount>(SELECT AVG(x.amount) FROM expense x WHERE x.household_id=e.household_id)
ORDER BY e.amount DESC;

-- Full-text search; change the example phrase as needed.
SELECT expense_id,description,ts_rank(description_tsv,plainto_tsquery('english','water repair')) AS rank
FROM expense
WHERE description_tsv @@ plainto_tsquery('english','water repair')
ORDER BY rank DESC;

-- Vector similarity, after indexing documents through the web UI.
-- Replace the placeholder vector with a 384-dimensional MiniLM query embedding.
-- SELECT source_type,source_id,content,1-(embedding <=> '[...]'::vector) AS similarity
-- FROM doc_embedding ORDER BY embedding <=> '[...]'::vector LIMIT 10;
