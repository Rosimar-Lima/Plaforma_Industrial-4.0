-- Substitui os IDs externos antigos (SAP-<id>-<sufixo>) pelo número de controle
-- fixo de 7 dígitos de cada componente. A atualização é idempotente.
BEGIN;

WITH controles (component_code, sap_number) AS (
    VALUES
        ('conveyor-bearing', '1001011'),
        ('conveyor-motor', '1001012'),
        ('fill-valve', '1001013'),
        ('cap-valve', '1001014')
)
UPDATE sap_outbox AS outbox
SET external_id = controle.sap_number,
    payload = jsonb_set(
        jsonb_set(outbox.payload, '{sapOrderId}', to_jsonb(controle.sap_number)),
        '{component,sapControlNumber}',
        to_jsonb(controle.sap_number),
        true
    )
FROM maintenance_orders AS ordem
JOIN controles AS controle ON controle.component_code = ordem.component_code
WHERE outbox.order_id = ordem.id;

COMMIT;
