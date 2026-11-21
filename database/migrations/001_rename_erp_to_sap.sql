-- Renomeia a outbox de ERP simulado para SAP simulado.
-- Aplicar uma vez em volumes criados antes desta mudança.
-- Em instalações novas, database/schema.sql já cria sap_outbox diretamente.

ALTER TABLE IF EXISTS erp_outbox RENAME TO sap_outbox;
ALTER INDEX IF EXISTS idx_erp_outbox_order RENAME TO idx_sap_outbox_order;

-- Mantém os eventos antigos legíveis pelo novo código.
UPDATE sap_outbox
SET external_id = 'SAP-' || substring(external_id from 5)
WHERE external_id LIKE 'ERP-%';

UPDATE sap_outbox
SET payload = (payload - 'erpOrderId') || jsonb_build_object('sapOrderId', payload -> 'erpOrderId')
WHERE payload ? 'erpOrderId';
