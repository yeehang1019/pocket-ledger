CREATE UNIQUE INDEX `commitment_active_invoice_key`
ON `pocket_commitments` (`owner`, `source_key`, `currency`)
WHERE `kind` = 'paylater' AND `status` = 'active' AND `source_key` GLOB 'invoice:*';
