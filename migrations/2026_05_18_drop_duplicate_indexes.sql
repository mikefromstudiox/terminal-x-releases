-- Last-batch followup — drop 4 duplicate unique indexes/constraints.
-- Same column lists, different names. Wasted write amplification.
ALTER TABLE cuadre_caja   DROP CONSTRAINT IF EXISTS uq_cuadre_caja_sid;
ALTER TABLE ncf_sequences DROP CONSTRAINT IF EXISTS uq_ncf_sequences_sid;
DROP INDEX IF EXISTS ncf_sequences_business_id_type_uniq;
DROP INDEX IF EXISTS idx_ncf_seq_local;
