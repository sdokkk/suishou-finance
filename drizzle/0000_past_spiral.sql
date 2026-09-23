CREATE TABLE `finance_ledgers` (
	`owner` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`document` text NOT NULL,
	`updated_at` text NOT NULL
);
